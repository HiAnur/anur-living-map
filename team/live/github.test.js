import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { CLIENT_ID, github } from './github.js';

// Linking a GitHub account with the device flow, keeping its token fresh, and reading repos through it, with a
// stand-in for GitHub and for tar.

const dirs = /** @type {string[]} */ ([]);
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-gh-')); dirs.push(d); return d; };
const until = async (/** @type {() => boolean} */ ok) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); expect(ok()).toBe(true); };

/** A stand-in GitHub: each answer by method and path, and every call kept. @param {Record<string, (body: any, headers: any) => any>} routes */
function fakeGitHub(routes) {
  /** @type {{ key: string, body: any, headers: any }[]} */
  const calls = [];
  const http = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ o = {}) => {
    const u = new URL(url), key = `${o.method || 'GET'} ${u.pathname}${u.search}`;
    const body = o.body ? JSON.parse(o.body) : undefined;
    calls.push({ key, body, headers: o.headers });
    const route = Object.keys(routes).find((k) => key.startsWith(k));
    const got = route ? routes[route](body, o.headers) : { status: 404 };
    const status = got?.status || 200;
    return { status, ok: status < 300, json: async () => got, text: async () => String(got?.text ?? ''), arrayBuffer: async () => new ArrayBuffer(8) };
  });
  return { http, calls };
}

describe('linking GitHub', () => {
  it('links with the device flow: shows the code to type, waits, and keeps the token on this Mac only', async () => {
    const dir = tmp();
    let asked = 0;
    const { http, calls } = fakeGitHub({
      'POST /login/device/code': () => ({ device_code: 'dev', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 }),
      'POST /login/oauth/access_token': () => (++asked < 2 ? { error: 'authorization_pending' } : { access_token: 'ghu_secret', refresh_token: 'ghr_secret', expires_in: 28800, refresh_token_expires_in: 15811200 }),
      'GET /user': () => ({ login: 'octo' }),
    });
    const gh = github({ dir, http, second: 1 });
    expect(await gh.link('Harshit')).toMatchObject({ code: 'ABCD-1234', uri: 'https://github.com/login/device' });
    expect(gh.status('Harshit')).toMatchObject({ linked: null, pending: { code: 'ABCD-1234' } });
    await until(() => gh.status('Harshit').linked === 'octo');
    expect(gh.status('Harshit')).toEqual({ linked: 'octo', pending: null });
    expect(JSON.stringify(gh.status('Harshit'))).not.toContain('secret');
    expect(calls[0].body).toEqual({ client_id: CLIENT_ID });
    const file = path.join(dir, 'github', 'Harshit.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(await gh.token('Harshit')).toBe('ghu_secret');
    gh.unlink('Harshit');
    expect(fs.existsSync(file)).toBe(false);
    expect(gh.status('Harshit').linked).toBeNull();
  });
  it('refreshes a token about to run out with no client secret, and asks to link again once it cannot', async () => {
    const dir = tmp();
    let clock = 1_000_000;
    const { http, calls } = fakeGitHub({ 'POST /login/oauth/access_token': (b) => (b.refresh_token === 'r1' ? { access_token: 'a2', refresh_token: 'r2', expires_in: 100 } : { error: 'bad_refresh_token' }) });
    const gh = github({ dir, http, now: () => clock });
    fs.mkdirSync(path.join(dir, 'github'));
    fs.writeFileSync(path.join(dir, 'github', 'Sam.json'), JSON.stringify({ access: 'a1', refresh: 'r1', expires: clock + 30_000, login: 'sam' }));
    expect(await gh.token('Sam')).toBe('a2');
    expect(calls[0].body).toEqual({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: 'r1' });
    clock += 200_000;
    expect(await gh.token('Sam')).toBeNull();
    expect(gh.status('Sam').linked).toBeNull();
  });
});

describe('reading repos from GitHub', () => {
  /** A linked person and a stand-in GitHub with two installations. @param {Record<string, (b: any, h: any) => any>} more */
  function linked(more = {}) {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'github'));
    fs.writeFileSync(path.join(dir, 'github', 'Harshit.json'), JSON.stringify({ access: 'tok', login: 'octo' }));
    const fake = fakeGitHub({
      'GET /user/installations?': () => ({ installations: [{ id: 1, account: { login: 'Shop' } }, { id: 2, account: { login: 'octo' } }] }),
      'GET /user/installations/1/repositories': () => ({ repositories: [{ owner: { login: 'Shop' }, name: 'api', private: true, default_branch: 'main', language: 'Python', pushed_at: '2026-11-01T00:00:00Z', size: 900 }, { owner: { login: 'Shop' }, name: 'old-api', private: true, archived: true, default_branch: 'main' },
        { owner: { login: 'Shop' }, name: 'some-fork', fork: true, default_branch: 'main' }, { owner: { login: 'Shop' }, name: 'empty', size: 0, default_branch: 'main' }] }),
      'GET /user/installations/2/repositories': () => ({ repositories: [{ owner: { login: 'octo' }, name: 'site', private: false, default_branch: 'trunk' }] }),
      ...more,
    });
    return { dir, ...fake };
  }
  it('lists the repos the person can read where the app is installed, but archived, forked and empty ones, asking as them', async () => {
    const { dir, http, calls } = linked();
    expect(await github({ dir, http }).repos('Harshit')).toEqual({ installed: ['Shop', 'octo'], repos: [
      { owner: 'Shop', name: 'api', private: true, branch: 'main', language: 'Python', pushed: Date.parse('2026-11-01T00:00:00Z'), size: 900 }, { owner: 'octo', name: 'site', private: false, branch: 'trunk' }] });
    expect(calls.every((c) => c.headers.authorization === 'Bearer tok')).toBe(true);
  });
  it('downloads a repo at its newest commit into a folder named after it, with no symlinks, once per commit', async () => {
    const sha = 'a'.repeat(40);
    const { dir, http, calls } = linked({
      'GET /repos/Shop/api/commits/main': () => ({ text: sha }),
      'GET /repos/Shop/api/tarball/': () => ({}),
      'GET /repos/Shop/api': () => ({ default_branch: 'main' }),
    });
    /** tar, standing in: what the archive holds, a symlink out of the repo among it @param {string} _ @param {string[]} args */
    const run = async (_, args) => {
      const to = args[args.indexOf('-C') + 1];
      fs.writeFileSync(path.join(to, 'app.py'), '"""The app."""\n');
      fs.symlinkSync('/etc/hosts', path.join(to, 'hosts'));
    };
    const gh = github({ dir, http, run });
    const got = await gh.fetchRepo('Harshit', { owner: 'Shop', name: 'api' });
    expect(got).toMatchObject({ commit: sha, branch: 'main' });
    expect(path.basename(got.folder)).toBe('api');
    expect(fs.readdirSync(got.folder).sort()).toEqual(['.living-map-head.json', 'app.py']);
    await gh.fetchRepo('Harshit', { owner: 'Shop', name: 'api' });
    expect(calls.filter((c) => c.key.includes('tarball'))).toHaveLength(1);
    await expect(gh.fetchRepo('Harshit', { owner: '..', name: 'x' })).rejects.toThrow('Not a GitHub repo name.');
  });
  it("names the newest commit on a repo's default branch, asking as the person", async () => {
    const { dir, http, calls } = linked({
      'GET /repos/Shop/api/commits/trunk': () => ({ text: `${'b'.repeat(40)}\n` }),
      'GET /repos/Shop/api': () => ({ default_branch: 'trunk' }),
    });
    expect(await github({ dir, http }).headOf('Harshit', 'Shop', 'api')).toBe('b'.repeat(40));
    expect(calls.map((c) => c.key)).toEqual(['GET /repos/Shop/api', 'GET /repos/Shop/api/commits/trunk']);
  });
  it('says whether a person may read a repo, asking GitHub at most every few minutes', async () => {
    let clock = 0;
    const { dir, http, calls } = linked();
    const gh = github({ dir, http, now: () => clock });
    expect(await gh.canRead('Harshit', 'shop', 'API')).toBe(true);
    expect(await gh.canRead('Harshit', 'Shop', 'secret')).toBe(false);
    expect(await gh.canRead('Nobody', 'Shop', 'api')).toBe(false);
    const asked = calls.length;
    clock += 60_000;
    await gh.canRead('Harshit', 'Shop', 'api');
    expect(calls.length).toBe(asked);
    clock += 5 * 60_000;
    await gh.canRead('Harshit', 'Shop', 'api');
    expect(calls.length).toBeGreaterThan(asked);
  });
  it('says whether a person may raise a pull request on a repo, by their own write access on GitHub', async () => {
    const { dir, http } = linked({
      'GET /repos/Shop/api': () => ({ permissions: { pull: true, push: true } }),
      'GET /repos/Shop/web': () => ({ permissions: { pull: true, push: false } }),
    });
    const gh = github({ dir, http });
    expect(await gh.whyNoPush('Harshit', 'Shop', 'api')).toBe('');
    expect(await gh.whyNoPush('Harshit', 'Shop', 'web')).toMatch(/^You can't push to Shop\/web on GitHub/);
    expect(await gh.whyNoPush('Nobody', 'Shop', 'api')).toMatch(/^Connect your GitHub account first/);
  });
  it('asks to link again when GitHub no longer takes the token', async () => {
    const { dir, http } = linked({ 'GET /user/installations?': () => ({ status: 401 }) });
    const gh = github({ dir, http });
    await expect(gh.repos('Harshit')).rejects.toThrow('Link your GitHub account again.');
    expect(gh.status('Harshit').linked).toBeNull();
  });
});
