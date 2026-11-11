// GitHub, for a system map drawn from repos there (issue #363): each person links their own GitHub account through
// the Anur Living Map GitHub App's device flow, which needs only the app's public client ID, so no secret ships with
// the map. Their token then sees only the repos they can see, where the app is installed: what the map draws follows
// what GitHub lets them read. Tokens stay on this Mac (one file per person, readable by this account only) and never
// reach a page. A repo is downloaded at one commit into a folder of its own, where the fact readers read it like any
// other folder; nothing in it is run.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { DATA } from './data-dir.js';

const API = 'https://api.github.com', WEB = 'https://github.com';
export const CLIENT_ID = process.env.LIVING_MAP_GITHUB_CLIENT_ID || 'Iv23liMEm7ceGhQD6lTI';

/** @typedef {{ access: string, refresh?: string, expires?: number, refreshExpires?: number, login: string }} Token */
/** @typedef {{ code: string, uri: string, until: number }} Pending */

/**
 * @param {{ dir: string, http?: typeof fetch, now?: () => number, run?: (cmd: string, args: string[]) => Promise<void>, second?: number }} deps
 *   `dir` holds the tokens and the downloaded repos; `http`, `run` and `second` stand in for the network, tar and the clock in tests
 */
export function github({ dir, http = fetch, now = Date.now, run = untar, second = 1000 }) {
  const TOKENS = path.join(dir, 'github'), REPOS = path.join(dir, 'repos');
  /** @type {Map<string, Pending>} the codes people are typing on github.com, by who */
  const pending = new Map();
  const file = (/** @type {string} */ who) => path.join(TOKENS, `${encodeURIComponent(who)}.json`);
  /** @returns {Token | null} */
  const saved = (/** @type {string} */ who) => {
    try { return JSON.parse(fs.readFileSync(file(who), 'utf8')); }
    catch { return null; } // never linked, or unlinked
  };
  const save = (/** @type {string} */ who, /** @type {Token} */ t) => {
    fs.mkdirSync(TOKENS, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file(who), JSON.stringify(t), { mode: 0o600 });
  };
  /** @param {string} url @param {Record<string, string>} form */
  const post = async (url, form) => (await http(url, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(form), signal: AbortSignal.timeout(20_000) })).json();
  /** @param {any} got @param {string} login */
  const tokenOf = (got, login) => ({ access: got.access_token, login,
    ...(got.refresh_token ? { refresh: got.refresh_token } : {}),
    ...(got.expires_in ? { expires: now() + got.expires_in * 1000 } : {}),
    ...(got.refresh_token_expires_in ? { refreshExpires: now() + got.refresh_token_expires_in * 1000 } : {}) });

  /** A person's token, refreshed when it is about to run out; null when they must link again. @param {string} who */
  async function token(who) {
    const t = saved(who);
    if (!t) return null;
    if (!t.expires || t.expires - 60_000 > now()) return t.access;
    if (!t.refresh || (t.refreshExpires && t.refreshExpires < now())) { unlink(who); return null; }
    const got = await post(`${WEB}/login/oauth/access_token`, { client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: t.refresh });
    if (!got.access_token) { unlink(who); return null; }
    save(who, tokenOf(got, t.login));
    return got.access_token;
  }
  /** @param {string} who @param {string} route */
  async function api(who, route, accept = 'application/vnd.github+json') {
    const access = await token(who);
    if (!access) throw Object.assign(new Error('Link your GitHub account first.'), { status: 401 });
    const r = await http(`${API}${route}`, { headers: { accept, authorization: `Bearer ${access}`, 'x-github-api-version': '2022-11-28' }, signal: AbortSignal.timeout(60_000) });
    if (r.status === 401) { unlink(who); throw Object.assign(new Error('GitHub no longer accepts your link. Link your GitHub account again.'), { status: 401 }); }
    if (!r.ok) throw Object.assign(new Error(`GitHub said ${r.status} for ${route.split('?')[0]}.`), { status: 502 });
    return r;
  }

  /**
   * Starts linking: GitHub gives a code to type at github.com/login/device, and the map waits for it in the
   * background. Resolves with what the person needs to see.
   * @param {string} who
   */
  async function link(who) {
    const got = await post(`${WEB}/login/device/code`, { client_id: CLIENT_ID });
    if (!got.device_code) throw Object.assign(new Error('GitHub did not start the link. Try again.'), { status: 502 });
    const until = now() + (got.expires_in || 900) * 1000;
    pending.set(who, { code: got.user_code, uri: got.verification_uri, until });
    (async () => {
      let wait = (got.interval || 5) * second;
      while (pending.get(who)?.code === got.user_code && now() < until) {
        await new Promise((r) => setTimeout(r, wait));
        /** @type {any} */ let t = {};
        try { t = await post(`${WEB}/login/oauth/access_token`, { client_id: CLIENT_ID, device_code: got.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }); }
        catch { continue; } // the network blinked: ask again at the next interval
        if (t.error === 'slow_down') wait += 5 * second;
        if (t.error && !['authorization_pending', 'slow_down'].includes(t.error)) break;
        if (!t.access_token) continue;
        const me = await (await http(`${API}/user`, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${t.access_token}` } })).json();
        save(who, tokenOf(t, String(me.login || '')));
        break;
      }
      if (pending.get(who)?.code === got.user_code) pending.delete(who);
    })().catch((e) => { console.error('[map] github link', e); pending.delete(who); });
    return { code: got.user_code, uri: got.verification_uri, until };
  }
  /** @param {string} who */
  function unlink(who) { pending.delete(who); fs.rmSync(file(who), { force: true }); }
  /** Who someone is on GitHub, or the code they are typing, or neither. @param {string} who */
  function status(who) {
    const t = saved(who), p = pending.get(who);
    return { linked: t ? t.login : null, pending: p && p.until > now() ? p : null };
  }

  /** Every repo the person can read where the app is installed, by account, but archived ones. @param {string} who */
  async function repos(who) {
    const { installations } = await (await api(who, '/user/installations?per_page=100')).json();
    /** @type {{ owner: string, name: string, private: boolean, branch: string }[]} */
    const out = [];
    for (const inst of installations || []) {
      for (let page = 1; page <= 10; page++) {
        const r = await (await api(who, `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`)).json();
        // an archived repo is no longer part of the running system
        for (const x of r.repositories || []) if (!x.archived && !x.disabled) out.push({ owner: x.owner.login, name: x.name, private: !!x.private, branch: x.default_branch });
        if ((r.repositories || []).length < 100) break;
      }
    }
    return { installed: (installations || []).map((/** @type {any} */ i) => i.account.login), repos: out };
  }

  /**
   * Downloads a repo at its default branch's newest commit into a folder of its own, named after the repo, and
   * returns that folder and the commit; a commit already downloaded is reused.
   * @param {string} who @param {{ owner: string, name: string }} repo
   */
  async function fetchRepo(who, { owner, name }) {
    if (![owner, name].every((x) => /^[\w.-]+$/.test(x) && !x.startsWith('.'))) throw Object.assign(new Error('Not a GitHub repo name.'), { status: 400 });
    const info = await (await api(who, `/repos/${owner}/${name}`)).json();
    const branch = info.default_branch;
    const { sha } = await (await api(who, `/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`, 'application/vnd.github.sha')).text().then((s) => ({ sha: s.trim() }));
    if (!/^[0-9a-f]{40}$/.test(sha)) throw Object.assign(new Error(`GitHub gave no commit for ${owner}/${name}.`), { status: 502 });
    const folder = path.join(REPOS, owner, sha.slice(0, 12), name);
    if (fs.existsSync(path.join(folder, '.living-map-head.json'))) return { folder, commit: sha, branch };
    const tarball = Buffer.from(await (await api(who, `/repos/${owner}/${name}/tarball/${sha}`)).arrayBuffer());
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    const archive = `${folder}.tar.gz`;
    fs.writeFileSync(archive, tarball);
    try { await run('tar', ['-xzf', archive, '-C', folder, '--strip-components=1', '--no-same-owner', '--no-same-permissions']); }
    finally { fs.rmSync(archive, { force: true }); }
    dropLinks(folder);
    fs.writeFileSync(path.join(folder, '.living-map-head.json'), JSON.stringify({ commit: sha, branch, repo: `${owner}/${name}` }));
    return { folder, commit: sha, branch };
  }
  return { link, unlink, status, token, repos, fetchRepo };
}

/** @type {ReturnType<typeof github> | null} */
let one = null;
/** This Mac's GitHub links and downloads, in the team map's data folder. */
export const sharedGithub = () => (one ||= github({ dir: DATA }));

/** Takes every symbolic link out of a downloaded repo, so reading it never follows one off to the rest of this Mac. @param {string} dir */
export function dropLinks(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) fs.rmSync(p, { force: true });
    else if (e.isDirectory()) dropLinks(p);
  }
}

/** @param {string} cmd @param {string[]} args @returns {Promise<void>} */
function untar(cmd, args) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout: 120_000 }, (e) => (e ? reject(e) : resolve())));
}
