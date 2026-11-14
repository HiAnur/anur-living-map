import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

// You on this Mac: no account and no sign-in. A page of the map in a browser here is you, an Admin of every map;
// another site open in that browser, or an address that only reaches this Mac, is never you. Google is optional.

// every test here runs the server as a real node process, many times over: far longer than the default limit on a
// busy machine (the pre-commit hook runs every test file at once)
const SPAWNS = 60_000;

/** @type {(() => Promise<void> | void)[]} */
const cleanup = [];
afterEach(async () => { while (cleanup.length) await /** @type {() => any} */ (cleanup.pop())(); });

// A copy of the team map with a users file of its own and a repo, so nothing here reaches this Mac's real map.
// `login`: the address of a stand-in for Living Map login, to sign in through Google; none turns Google off.
function install(login = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-you-'));
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), repo = path.join(root, 'shop');
  fs.mkdirSync(app); fs.mkdirSync(repo);
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !name.includes('.test.') && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(app, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(app, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(app, 'projects.json'), '[]');
  const users = path.join(root, 'users.db');
  const env = { ...process.env, HOME: path.join(root, 'home'), ANUR_LIVING_MAP_MAPS: app, LIVING_MAP_USERS: users, LIVING_MAP_LOGIN_URL: login, LIVING_MAP_CLOUD_CONFIG: path.join(root, 'no-cloud.json'), ANUR_LIVING_MAP_NO_UPDATE: '1' };
  /** a script against this copy's users file @param {string} code */
  const run = (code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: app, env, encoding: 'utf8' }).trim();
  /** `node users.js …` @param {string[]} args */
  const cli = (args) => spawnSync(process.execPath, ['users.js', ...args], { cwd: app, env, encoding: 'utf8', timeout: 30_000 });
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
  /** a page of this map reading, as a browser on this Mac sends it @param {string} route @param {Record<string, string>} [headers] */
  const get = (route, headers = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }) => fetch(origin + route, { redirect: 'manual', headers });
  /** a page posting, from this map (or from `from`, another site) @param {string} route @param {any} data */
  const post = (route, data, from = origin) => fetch(origin + route, { method: 'POST', redirect: 'manual', headers: { origin: from, 'sec-fetch-site': from === origin ? 'same-origin' : 'cross-site', 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const me = async () => /** @type {any} */ (await (await get('/api/me')).json());
  /** opens a map as a window on this Mac, which joins its people, and gives the state that window first gets @param {string} href */
  const open = async (href) => {
    const r = await get(href + 'api/events');
    const reader = /** @type {any} */ (r.body).getReader();
    let text = '';
    while (!text.includes('event: state\ndata: ') || !text.split('event: state\ndata: ')[1].includes('\n')) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    return JSON.parse(text.split('event: state\ndata: ')[1].split('\n')[0]);
  };
  /** a read with headers Node's fetch would not send as given (its own Host, a navigation): its status @param {string} route @param {Record<string, string>} headers */
  const raw = (route, headers) => new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, headers: { host: `localhost:${port}`, ...headers } }, (res) => { res.resume(); ok(res.statusCode); });
    req.on('error', fail); req.end();
  });
  /** a request that reaches this Mac under another address, as a site rebinding its name to this Mac sends it @param {string} route */
  const elsewhereHost = (route) => raw(route, { host: `rebound.example:${port}`, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' });
  /** a link from another site followed to `route` @param {string} route */
  const linkFromElsewhere = (route) => raw(route, { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' });
  /** signs in through Google, as the person the stand-in login gives for `code`; where it lands @param {string} code */
  const google = async (code) => {
    const start = await get('/auth/google?next=/settings', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' });
    const state = new URL(/** @type {string} */ (start.headers.get('location'))).searchParams.get('state');
    const done = await fetch(`${origin}/auth/done?state=${state}&code=${code}`, { redirect: 'manual', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } });
    return done.headers.get('location');
  };
  return { origin, get, post, me, open, elsewhereHost, linkFromElsewhere, google };
}

/**
 * A stand-in for Living Map login: each code it is handed back is a person Google vouched for.
 * @param {Record<string, { name: string, email: string, listed?: boolean, picture?: string }>} people
 */
async function login(people) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const who = req.url === '/exchange' ? people[JSON.parse(body || '{}').code] : null;
      res.writeHead(who ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(who || { error: 'Not known.' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  cleanup.push(() => new Promise((r) => server.close(() => r(undefined))));
  return `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
}
const PICTURE = 'https://lh3.googleusercontent.com/a/ACg8ocJ-x_Y=s96-c';
const GOOGLE = {
  alex: { name: 'Alex Smith', email: 'alex@example.com', picture: PICTURE },
  work: { name: 'Alex at Work', email: 'alex@work.example', picture: 'https://example.com/a.png"><script>' },
  listed: { name: 'Priyanka', email: 'p@example.com', listed: true },
};

/** A chat in a Claude Code transcript, where the app keeps them. @param {string} root @param {string} session */
function chatFile(root, session) {
  const file = path.join(root, '.claude', 'projects', 'shop', `${session}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', origin: { kind: 'human' }, timestamp: new Date(0).toISOString(), message: { role: 'user', content: 'Hello' } })}\n`);
  return file;
}

it('opens a new install straight onto your maps, with no form, as the Mac\'s own person and the Admin of every map', async () => {
  const at = install(), map = await serve(at);
  // the address typed into the browser
  const home = await map.get('/', { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' });
  expect(home.status).toBe(200);
  const page = await home.text();
  expect(page).toContain('Or pick a map you have');
  expect(page).not.toMatch(/type="password"|Create your account/);
  const you = await map.me();
  expect(you).toEqual({ name: expect.any(String), role: 'Owner', googleEmail: '', google: false, picture: '' });
  expect(you.name).toMatch(/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u);
  expect(page).toContain(`<meta name="lm-user" content="${you.name}">`);
  // the old sign-in page sends you on to Settings, and Settings and the repo's map open
  expect((await map.get('/login?next=%2F')).headers.get('location')).toBe('/settings');
  expect((await map.get('/settings')).status).toBe(200);
  expect((await map.open('/shop/')).people).toContainEqual(expect.objectContaining({ id: you.name, role: 'Admin' }));
  // a map you make is yours
  const made = /** @type {any} */ (await (await map.post('/api/newmap', { blank: true })).json());
  expect((await map.open(made.href)).people).toContainEqual(expect.objectContaining({ id: you.name, role: 'Admin' }));
  expect(Object.fromEntries((/** @type {any[]} */ (await (await map.get('/api/maps')).json())).map((m) => [m.name, m.deletable]))).toEqual({ shop: true, [made.name]: true });
  // you change the name you go by in Settings
  expect((await map.post('/api/me', { name: '<b>' })).status).toBe(400);
  expect((await map.post('/api/me', { name: 'Claude' })).status).toBe(400);
  expect(/** @type {any} */ (await (await map.post('/api/me', { name: '  Sam  Lee ' })).json())).toEqual({ name: 'Sam Lee' });
  expect((await map.me()).name).toBe('Sam Lee');
  expect(at.cli(['list']).stdout).toContain('Sam Lee  (you, on this Mac)');
  // under the new name you are still the Admin of the maps you made under the old one
  expect((await map.open(made.href)).people).toContainEqual(expect.objectContaining({ id: 'Sam Lee', role: 'Admin' }));
}, SPAWNS);

it('never lets another site in the browser, or another address, read or drive your maps', async () => {
  const at = install(), map = await serve(at);
  const elsewhere = 'https://elsewhere.example';
  const before = (await map.me()).name;
  // another site's reads, as fetch sends them from its page
  for (const route of ['/api/me', '/api/maps', '/shop/api/state', '/shop/api/events', '/settings'])
    expect((await map.get(route, { origin: elsewhere, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' })).status, route).toBe(403);
  // nor does the map ever let another site read an answer
  expect((await map.get('/shop/api/state')).headers.get('access-control-allow-origin')).toBeNull();
  // its posts: a change to your name, Google sign-out, an act on a map, a new map
  expect((await map.post('/api/me', { name: 'Mallory' }, elsewhere)).status).toBe(403);
  expect((await map.post('/api/google/signout', {}, elsewhere)).status).toBe(403);
  expect((await map.post('/shop/api/act', { type: 'add', label: 'Planted', x: 0, y: 0 }, elsewhere)).status).toBe(403);
  expect((await map.post('/api/newmap', { blank: true }, elsewhere)).status).toBe(403);
  const form = await fetch(map.origin + '/shop/api/act', { method: 'POST', headers: { origin: elsewhere, 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' }, body: JSON.stringify({ type: 'add', label: 'Planted' }) });
  expect(form.status).toBe(403);
  // a link from it may open a page, as a link from anywhere may, but never sign you in to Google
  expect(await map.linkFromElsewhere('/shop/')).toBe(200);
  expect(await map.linkFromElsewhere('/auth/google')).toBe(403);
  expect(await map.linkFromElsewhere('/shop/api/state')).toBe(403);
  // an address that is not this Mac's, though it reaches it
  for (const route of ['/', '/api/me', '/api/maps', '/shop/', '/shop/api/state', '/settings', '/auth/done']) expect(await map.elsewhereHost(route), route).toBe(403);
  expect((await map.me()).name).toBe(before);
  expect((await map.open('/shop/')).nodes.some((/** @type {any} */ n) => n.label === 'Planted')).toBe(false);
}, SPAWNS);

it('answers none of the old account routes', async () => {
  const at = install(), map = await serve(at);
  for (const route of ['/api/first', '/api/login', '/api/logout', '/api/invite', '/api/invite/check', '/api/join',
    '/api/recovery/email', '/api/recovery/forgot', '/api/recovery/verify', '/api/recovery/reset'])
    expect((await map.post(route, { name: 'Alex', password: 'a long password' })).status, route).toBe(404);
  expect((await map.get('/api/signin')).status).toBe(404);
  expect((await map.get('/login.html')).headers.get('location')).toBe('/settings');
  expect(at.cli(['reset', 'Alex']).status).toBe(1);
  expect(at.cli(['set', 'Alex']).status).toBe(1);
}, SPAWNS);

it('keeps an install with a password owner as it was: their name, their maps\' Admin rights and the users file', async () => {
  const at = install();
  // users.db as an earlier install left it: two accounts with passwords, Harshit the owner, a session for each
  at.run(`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(at.users)});
    db.exec("CREATE TABLE users (name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, set_at TEXT NOT NULL DEFAULT (datetime('now')))");
    db.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL, email TEXT)");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec("CREATE TABLE invites (hash TEXT PRIMARY KEY, name TEXT NOT NULL, by TEXT NOT NULL, expires INTEGER NOT NULL)");
    db.prepare('INSERT INTO users (name, salt, hash) VALUES (?, ?, ?)').run('Harshit', 'salt', 'hash');
    db.prepare('INSERT INTO users (name, salt, hash) VALUES (?, ?, ?)').run('Priyanka', 'salt', 'hash');
    db.prepare("INSERT INTO settings VALUES ('owner', 'Harshit')").run();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, NULL)').run('a', 'Harshit', Date.now());`);
  // maps from before: one Harshit made, one from before maps recorded who made them, where Priyanka is a member
  const kept = (/** @type {string} */ name, /** @type {any} */ more) => {
    fs.mkdirSync(path.join(at.app, 'maps', name), { recursive: true });
    fs.writeFileSync(path.join(at.app, 'maps', name, 'state.json'), JSON.stringify({ title: name, nodes: [{ id: 'a', label: 'A', x: 0, y: 0, owner: 'Priyanka' }], edges: [], calls: [], prs: [], log: [], threads: {}, ...more }));
  };
  kept('mine', { admins: ['Harshit'], people: [{ id: 'Harshit', role: 'Admin', joined: 'before' }, { id: 'Priyanka', role: 'CFO', joined: 'before' }] });
  kept('older', { people: [{ id: 'Duy', role: 'Admin', joined: 'before' }, { id: 'Priyanka', role: 'CFO', joined: 'before' }] });
  const map = await serve(at);
  expect((await map.me()).name).toBe('Harshit');
  for (const name of ['mine', 'older']) {
    const state = await map.open(`/${name}/`);
    expect(state.people).toContainEqual(expect.objectContaining({ id: 'Harshit', role: 'Admin' }));
    expect(state.people).toContainEqual(expect.objectContaining({ id: 'Priyanka', role: 'CFO' }));
    expect(state.nodes[0].owner).toBe('Priyanka');
  }
  expect(JSON.parse(fs.readFileSync(path.join(at.app, 'maps', 'mine', 'state.json'), 'utf8')).admins).toEqual(['Harshit']);
  expect((/** @type {any[]} */ (await (await map.get('/api/maps')).json())).every((m) => m.deletable)).toBe(true);
  // the passwords stay where they were, unused, and the file is never removed
  expect(at.run(`import {DatabaseSync} from 'node:sqlite';console.log(new DatabaseSync(${JSON.stringify(at.users)}).prepare('SELECT count(*) AS n FROM users').get().n)`)).toBe('2');
  // a new name keeps the maps made under the old one
  await map.post('/api/me', { name: 'Harshit Khandelwal' });
  expect((await map.open('/mine/')).people).toContainEqual(expect.objectContaining({ id: 'Harshit Khandelwal', role: 'Admin' }));
  expect((/** @type {any[]} */ (await (await map.get('/api/maps')).json())).every((m) => m.deletable)).toBe(true);
}, SPAWNS);

it('names an install from before owners were kept after its first account, as before', () => {
  const at = install();
  at.run(`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(at.users)});
    db.exec("CREATE TABLE users (name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, set_at TEXT NOT NULL DEFAULT (datetime('now')))");
    db.prepare('INSERT INTO users (name, salt, hash) VALUES (?, ?, ?)').run('Harshit', 's', 'h');
    db.prepare('INSERT INTO users (name, salt, hash) VALUES (?, ?, ?)').run('Duy', 's', 'h');`);
  // the story's Admin, Duy, had a password here, so Duy is who used this Mac
  expect(at.run(`import {users} from './users.js';console.log(users.me())`)).toBe('Duy');
}, SPAWNS);

it('takes your name, email and picture from Google when you sign in, and forgets the email when you sign out', async () => {
  const at = install(await login(GOOGLE)), map = await serve(at);
  expect((await map.me()).google).toBe(true);
  expect(await map.google('alex')).toBe('/settings');
  expect(await map.me()).toEqual({ name: 'Alex Smith', role: 'Owner', googleEmail: 'alex@example.com', google: true, picture: PICTURE });
  for (const page of ['/', '/settings', '/shop/']) expect(await (await map.get(page)).text()).toContain(`<meta name="lm-picture" content="${PICTURE}">`);
  expect((await map.open('/shop/')).people).toContainEqual(expect.objectContaining({ id: 'Alex Smith', role: 'Admin', picture: PICTURE }));
  // another Google account later: its email and picture, but the name you already have stays (a picture not on
  // Google's own host is dropped)
  await map.google('work');
  expect(await map.me()).toMatchObject({ name: 'Alex Smith', googleEmail: 'alex@work.example', picture: '' });
  expect(await (await map.get('/')).text()).not.toContain('<meta name="lm-picture"');
  // signing out of Google keeps you in, as yourself
  expect((await map.post('/api/google/signout', {})).status).toBe(200);
  expect(await map.me()).toMatchObject({ name: 'Alex Smith', googleEmail: '', picture: '' });
  expect((await map.get('/api/maps')).status).toBe(200);
  // a sign-in that does not finish says why, in Settings
  const failed = await fetch(`${map.origin}/auth/done?state=nope&code=alex`, { redirect: 'manual' });
  expect(failed.headers.get('location')).toMatch(/^\/settings\?error=/);
}, SPAWNS);

it('names you after the login\'s list for a listed Google address, and never renames a name you already have', async () => {
  const at = install(await login(GOOGLE));
  at.run(`import {users} from './users.js';users.rename('Harshit')`);
  const map = await serve(at);
  await map.google('listed');
  expect(await map.me()).toMatchObject({ name: 'Harshit', googleEmail: 'p@example.com' });
  const fresh = install(await login(GOOGLE)), other = await serve(fresh);
  await other.google('listed');
  expect((await other.me()).name).toBe('Priyanka');
}, SPAWNS);

it('links a chat opened on this Mac to you, whatever name the script sends', async () => {
  const at = install(), map = await serve(at);
  at.run(`import {users} from './users.js';users.rename('Alex Smith')`);
  // as open-map.sh sends it: a program on this Mac, under the first word of the account's name
  const link = (/** @type {string} */ session) => fetch(map.origin + '/shop/api/act', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'link', by: 'Alex', session, file: chatFile(at.root, session) }) });
  expect((await link('chat-0001')).status).toBe(200);
  expect((await map.open('/shop/')).linked.map((/** @type {any} */ l) => l.owner)).toEqual(['Alex Smith']);
}, SPAWNS);
