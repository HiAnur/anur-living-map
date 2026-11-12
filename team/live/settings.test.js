import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./settings.html', import.meta.url), 'utf8');

it('says what each kind of person can do about their email', () => {
  const ctx = vm.createContext({});
  vm.runInContext(html.slice(html.indexOf('function words('), html.indexOf("fetch('/api/me')")), ctx);
  expect(ctx.words({ role: 'Engineer, runs Claude Code', email: 'h@example.com', emailFrom: 'google', signIn: 'google' })).toMatchObject({ role: 'Engineer', email: 'h@example.com', action: '', signIn: 'Google' });
  expect(ctx.words({ role: 'Admin', email: 'd@example.com', emailFrom: 'recovery', signIn: 'password' })).toMatchObject({ email: 'd@example.com', action: 'Change', signIn: 'A password kept on this Mac' });
  expect(ctx.words({ role: 'Admin', email: '', emailFrom: '', signIn: 'password' })).toMatchObject({ email: 'No email yet', action: 'Add an email' });
  expect(ctx.words({ role: '', email: '', emailFrom: '', signIn: '' })).toMatchObject({ role: '', email: 'No email yet', note: '', action: '', signIn: '' });
});

it('links Settings from the account menu on the list of maps and on a map', () => {
  for (const file of ['maps.html', 'index.html']) expect(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')).toMatch(/href="\/settings">Settings<\/a>/);
});

it('shows a signed-in person their own name, role, email and sign-in, and nobody else', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-settings-'));
  const app = path.join(root, 'app'), primary = path.join(root, 'primary');
  fs.mkdirSync(app);
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !name.includes('.test.') && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(app, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(app, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(primary, '.living-map'), { recursive: true });
  fs.writeFileSync(path.join(primary, '.living-map/state.json'), JSON.stringify({ title: 'A map', nodes: [], edges: [], people: [], calls: [], prs: [], log: [], threads: {} }));
  fs.writeFileSync(path.join(app, 'projects.json'), '[]');
  const users = path.join(root, 'users.db');
  const env = { ...process.env, LIVING_MAP_USERS: users, LIVING_MAP_LOGIN_URL: '', LIVING_MAP_CLOUD_CONFIG: path.join(root, 'no-cloud.json') };
  const run = (/** @type {string} */ code) => execFileSync(process.execPath, ['--input-type=module', '-e', code], { cwd: app, env, encoding: 'utf8' }).trim();
  // a users file from before sessions kept an email gets the column, and its sessions still sign in
  run(`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(users)});db.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL)")`);
  // Duy: a password kept here and a verified recovery email. Priyanka: signed in through Google. Harshit: a password only.
  const duy = run(`import {users} from './users.js';import {DatabaseSync} from 'node:sqlite';users.first('Duy','a long password');new DatabaseSync(${JSON.stringify(users)}).prepare('INSERT INTO recovery_emails VALUES (?, ?)').run('Duy','duy@example.com');console.log(users.start('Duy'))`);
  const priyanka = run(`import {users} from './users.js';console.log(users.start('Priyanka','priyanka@example.com'))`);
  const harshit = run(`import {users} from './users.js';users.first('Harshit','a long password');console.log(users.start('Harshit'))`);
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js', String(port), '--project', primary], { cwd: app, env, stdio: 'ignore' });
  const request = (/** @type {string} */ route, token = '') => fetch(origin + route, { redirect: 'manual', headers: token ? { cookie: `lm_session=${token}` } : {} });
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(origin + '/api/version')).ok) break; } catch { /* not listening yet: ask again */ } if (i > 60) throw new Error('Server did not start'); await new Promise((r) => setTimeout(r, 50)); }
    expect(await (await request('/api/me', duy)).json()).toEqual({ name: 'Duy', role: 'Admin', email: 'duy@example.com', emailFrom: 'recovery', signIn: 'password' });
    expect(await (await request('/api/me', priyanka)).json()).toEqual({ name: 'Priyanka', role: 'CFO', email: 'priyanka@example.com', emailFrom: 'google', signIn: 'google' });
    expect(await (await request('/api/me', harshit)).json()).toMatchObject({ name: 'Harshit', email: '', emailFrom: '', signIn: 'password' });
    expect((await request('/api/me')).status).toBe(401);
    const page = await request('/settings', duy);
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain('duy@example.com');
    const out = await request('/settings');
    expect([out.status, out.headers.get('location')]).toEqual([302, '/login?next=%2Fsettings']);
  } finally { if (child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } fs.rmSync(root, { recursive: true, force: true }); }
}, 15000);
