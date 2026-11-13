import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

// every test here runs users.js or the server as real node processes, each many times: far longer than
// the default limit on a busy machine (the pre-commit hook runs every test file at once)
const SPAWNS = 60_000;

/** @type {(() => Promise<void> | void)[]} */
const cleanup = [];
afterEach(async () => { while (cleanup.length) await /** @type {() => any} */ (cleanup.pop())(); });

// A copy of the team map with a users file of its own and a repo, so nothing here reaches this Mac's real map.
function install() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-accounts-'));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), repo = path.join(root, 'shop');
  fs.mkdirSync(app); fs.mkdirSync(repo);
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !name.includes('.test.') && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(app, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(app, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(app, 'projects.json'), '[]');
  const users = path.join(root, 'users.db');
  const env = { ...process.env, LIVING_MAP_USERS: users, LIVING_MAP_LOGIN_URL: '', LIVING_MAP_CLOUD_CONFIG: path.join(root, 'no-cloud.json'), LIVING_MAP_MAIL_CONFIG: path.join(root, 'no-mail.json'), RESEND_API_KEY: '' };
  /** a script against this copy's users file @param {string} code */
  const run = (code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: app, env, encoding: 'utf8' }).trim();
  /** `node users.js …`, as a script or Claude would run it: no terminal @param {string[]} args @param {string} [input] */
  const cli = (args, input = '') => spawnSync(process.execPath, ['users.js', ...args], { cwd: app, env, input, encoding: 'utf8', timeout: 30_000 });
  return { root, app, repo, users, env, run, cli };
}

/** @param {ReturnType<typeof install>} at */
async function serve(at) {
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js', String(port), '--project', at.repo], { cwd: at.app, env: at.env, stdio: 'ignore' });
  cleanup.push(async () => { if (child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } });
  for (let i = 0; ; i++) { try { if ((await fetch(origin + '/api/version')).ok) break; } catch { /* not listening yet: ask again */ } if (i > 80) throw new Error('Server did not start'); await new Promise((r) => setTimeout(r, 50)); }
  /** a page of this map posting, as the person whose cookie it carries @param {string} route @param {any} data @param {string} [token] */
  const post = async (route, data, token = '', from = origin) => {
    const r = await fetch(origin + route, { method: 'POST', redirect: 'manual', headers: { origin: from, 'content-type': 'application/json', ...(token ? { cookie: `lm_session=${token}` } : {}) }, body: JSON.stringify(data) });
    const cookie = /lm_session=([0-9a-f]{64})/.exec(r.headers.get('set-cookie') || '')?.[1] || '';
    return { status: r.status, body: await r.json().catch(() => ({})), cookie };
  };
  /** @param {string} route @param {string} [token] */
  const get = async (route, token = '') => {
    const r = await fetch(origin + route, { headers: { 'sec-fetch-site': 'same-origin', ...(token ? { cookie: `lm_session=${token}` } : {}) } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  /** opens a map as a signed-in window, which joins its people, and gives the state that window first gets @param {string} href @param {string} token */
  const open = async (href, token) => {
    const r = await fetch(origin + href + 'api/events', { headers: { 'sec-fetch-site': 'same-origin', cookie: `lm_session=${token}` } });
    const reader = /** @type {any} */ (r.body).getReader();
    let text = '';
    while (!text.includes('event: state\ndata: ') || !text.split('event: state\ndata: ')[1].includes('\n')) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    return JSON.parse(text.split('event: state\ndata: ')[1].split('\n')[0]);
  };
  return { origin, post, get, open };
}

it('makes the first person on a new install its owner, and lets others in only by the owner\'s invite', async () => {
  const at = install(), map = await serve(at);
  expect((await map.get('/api/signin')).body).toMatchObject({ firstRun: true, mail: false });
  // another site the browser has open cannot take the owner's account
  expect((await map.post('/api/first', { name: 'Alex', password: 'a long password' }, '', 'https://elsewhere.example')).status).toBe(403);
  expect((await map.post('/api/first', { name: 'Alex', password: 'short' })).body.error).toContain('at least 8');
  expect((await map.post('/api/first', { name: '<b>', password: 'a long password' })).status).toBe(400);
  const alex = await map.post('/api/first', { name: '  Alex  ', password: 'a long password' });
  expect([alex.status, alex.body.name]).toEqual([200, 'Alex']);
  expect(alex.cookie).toMatch(/^[0-9a-f]{64}$/);
  // after that nobody else creates an account, and a name nobody was invited under is nobody's
  expect((await map.get('/api/signin')).body.firstRun).toBe(false);
  expect((await map.post('/api/first', { name: 'Sam', password: 'a long password' })).status).toBe(400);
  const typed = await map.post('/api/login', { name: 'duy', password: 'any password at all' });
  expect(typed).toMatchObject({ status: 401, body: { error: 'No one called duy here. Ask whoever runs this map to add you.' } });
  expect((await map.post('/api/login', { name: 'alex', password: 'wrong password' })).body.error).toBe('That password is not right.');
  expect((await map.post('/api/login', { name: 'alex', password: 'a long password' })).body.name).toBe('Alex');

  // Alex invites Duy: the name is no way in by itself, only the link is
  expect((await map.post('/api/invite', { name: 'Duy' })).status).toBe(401);
  expect((await map.post('/api/invite', { name: 'alex' }, alex.cookie)).body.error).toContain('already here');
  const invite = await map.post('/api/invite', { name: 'Duy' }, alex.cookie);
  expect(invite.body.link).toMatch(new RegExp(`^${map.origin}/login#invite=[0-9a-f]{64}$`));
  const token = invite.body.link.split('#invite=')[1];
  expect((await map.post('/api/invite/check', { token })).body).toEqual({ name: 'Duy', by: 'Alex' });
  expect((await map.post('/api/join', { token, password: 'short' })).status).toBe(400);
  const duy = await map.post('/api/join', { token, password: 'duys own password' });
  expect([duy.status, duy.body.name]).toEqual([200, 'Duy']);
  expect((await map.post('/api/join', { token, password: 'duys own password' })).body.error).toContain('expired or was already used');
  expect((await map.post('/api/invite/check', { token })).status).toBe(404);
  // only the owner invites
  expect((await map.post('/api/invite', { name: 'Kim' }, duy.cookie)).body.error).toBe('Only the owner of this map can invite someone.');

  // The repo's own map is the owner's; Duy, though the story's Admin, is an ordinary member of it. A map Duy makes
  // is Duy's.
  expect((await map.open('/shop/', alex.cookie)).people).toContainEqual(expect.objectContaining({ id: 'Alex', role: 'Admin' }));
  expect((await map.open('/shop/', duy.cookie)).people.find((/** @type {any} */ p) => p.id === 'Duy').role).toBeUndefined();
  const made = await map.post('/api/newmap', { blank: true }, duy.cookie);
  expect(made.status).toBe(200);
  expect((await map.open(made.body.href, duy.cookie)).people).toContainEqual(expect.objectContaining({ id: 'Duy', role: 'Admin' }));
  const deletable = async (/** @type {string} */ who) => Object.fromEntries((await map.get('/api/maps', who)).body.map((/** @type {any} */ m) => [m.name, m.deletable]));
  expect(await deletable(alex.cookie)).toEqual({ shop: true, [made.body.name]: false });
  expect(await deletable(duy.cookie)).toEqual({ shop: false, [made.body.name]: true });
  // Settings shows the owner, and gives only the owner the invite
  expect((await map.get('/api/me', alex.cookie)).body).toMatchObject({ name: 'Alex', role: 'Owner', owner: true, mail: false });
  expect((await map.get('/api/me', duy.cookie)).body).toMatchObject({ name: 'Duy', role: '', owner: false });
}, SPAWNS);

it('keeps an install from before owners as it was: its passwords, its owner and the Admins of its maps', async () => {
  const at = install();
  // two people with passwords from before, Harshit first, and no owner kept
  at.cli(['set', 'Harshit', '--password-stdin'], 'harshits password\n');
  at.cli(['set', 'Priyanka', '--password-stdin'], 'priyankas password\n');
  at.run(`import {DatabaseSync} from 'node:sqlite';new DatabaseSync(${JSON.stringify(at.users)}).exec('DELETE FROM settings')`);
  const priyanka = at.run(`import {users} from './users.js';console.log(users.start('Priyanka'))`);
  // the story's Admin has no password here, so whoever made the first account owns the install
  expect(at.run(`import {users} from './users.js';console.log(users.owner(), users.check('harshit','harshits password'))`)).toBe('Harshit Harshit');
  // a map from before: Duy joined it as the story's Admin, Priyanka as a member
  const old = path.join(at.app, 'maps', 'launch');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'state.json'), JSON.stringify({ title: 'Launch', nodes: [], edges: [], calls: [], prs: [], log: [], threads: {},
    people: [{ id: 'Duy', role: 'Admin', joined: 'before' }, { id: 'Priyanka', role: 'CFO', joined: 'before' }] }));
  const map = await serve(at);
  const harshit = (await map.post('/api/login', { name: 'Harshit', password: 'harshits password' })).cookie;
  expect(harshit).toMatch(/^[0-9a-f]{64}$/);
  // Duy stays its Admin and the owner becomes one, written down when the map first opens
  const state = await map.open('/launch/', harshit);
  expect(JSON.parse(fs.readFileSync(path.join(old, 'state.json'), 'utf8')).admins).toEqual(['Duy', 'Harshit']);
  expect(state.people).toContainEqual(expect.objectContaining({ id: 'Duy', role: 'Admin' }));
  expect(state.people).toContainEqual(expect.objectContaining({ id: 'Priyanka', role: 'CFO' }));
  expect(state.people).toContainEqual(expect.objectContaining({ id: 'Harshit', role: 'Admin' }));
  const deletable = async (/** @type {string} */ who) => (await map.get('/api/maps', who)).body.find((/** @type {any} */ m) => m.name === 'launch').deletable;
  expect([await deletable(harshit), await deletable(priyanka)]).toEqual([true, false]);
}, SPAWNS);

it('makes the story\'s Admin with a password the owner of an install from before owners', () => {
  const at = install();
  at.cli(['set', 'Harshit', '--password-stdin'], 'harshits password\n');
  at.cli(['set', 'Duy', '--password-stdin'], 'duys password\n');
  at.run(`import {DatabaseSync} from 'node:sqlite';new DatabaseSync(${JSON.stringify(at.users)}).exec('DELETE FROM settings')`);
  expect(at.run(`import {users} from './users.js';console.log(users.owner())`)).toBe('Duy');
}, SPAWNS);

it('prints a one-use reset link for any account, and never waits for a password without a terminal', () => {
  const at = install();
  // set, as Claude or a script runs it: no terminal, so it says so and changes nothing instead of waiting
  const waiting = at.cli(['set', 'Alex']);
  expect([waiting.status, waiting.stdout]).toEqual([1, expect.stringContaining('Run this in a terminal')]);
  expect(at.run(`import {users} from './users.js';console.log(users.firstRun())`)).toBe('true');
  expect(at.cli(['set', 'Alex', '--password-stdin'], 'short\n').status).toBe(1);
  const made = at.cli(['set', 'Alex', '--password-stdin'], 'a long password\n');
  expect([made.status, made.stdout]).toEqual([0, expect.stringContaining('Alex owns this map server')]);
  // the owner cannot be removed while they own it
  expect(at.cli(['remove', 'Alex']).status).toBe(1);

  expect(at.cli(['reset', 'Nobody'])).toMatchObject({ status: 1, stdout: expect.stringContaining('No one called Nobody') });
  const printed = at.cli(['reset', 'alex']);
  expect(printed.status).toBe(0);
  expect(printed.stdout).toMatch(/http:\/\/localhost:4323\/login#reset=[0-9a-f]{64}\n$/);
  expect(printed.stdout).not.toContain('a long password');
  const other = at.cli(['reset', 'Alex', '--port', '4411']).stdout;
  expect(other).toMatch(/http:\/\/localhost:4411\/login#reset=/);
  // a newer link replaces the one before; the link works once, and signs out the browsers before it
  const token = /#reset=([0-9a-f]{64})/.exec(other)?.[1];
  const older = /#reset=([0-9a-f]{64})/.exec(printed.stdout)?.[1];
  expect(at.run(`import {recovery, users} from './users.js';const s=users.start('Alex');console.log(recovery.use(${JSON.stringify(older)},'reset','an older choice'), recovery.use(${JSON.stringify(token)},'reset','a new password'), recovery.use(${JSON.stringify(token)},'reset','again and again'), users.whoIs(s), users.check('Alex','a new password'))`))
    .toBe('false true false null Alex');
}, SPAWNS);
