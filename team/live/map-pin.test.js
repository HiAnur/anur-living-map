import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

import { expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./maps.html', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

it('keeps pinned maps first, then system maps, in either sort order', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`const titleOf = (m) => m.title || m.name;\n${html.slice(html.indexOf('function ordered('), html.indexOf('function list('))}`, ctx);
  const maps = [{ name: 'system', system: 'done', at: 1 }, { name: 'beta', at: 5 }, { name: 'alpha', at: 3, pinned: true }, { name: 'zulu', at: 9 }, { name: 'older', at: 2, pinned: true }];
  expect(ctx.ordered(maps, 'time').map((/** @type {any} */ m) => m.name)).toEqual(['alpha', 'older', 'system', 'zulu', 'beta']);
  expect(ctx.ordered(maps, 'name').map((/** @type {any} */ m) => m.name)).toEqual(['alpha', 'older', 'system', 'beta', 'zulu']);
});

it('offers your own account menu on the list of maps, and lists only people on a map', () => {
  expect(html).toMatch(/id="account-menu"[^]*Recovery email[^]*Sign out/);
  for (const page of [html, index]) expect(page).not.toMatch(/AI agent, draws the plans/);
});

it('pins a map for one person only, and keeps the pin across a restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-pin-'));
  const app = path.join(root, 'app'), primary = path.join(root, 'primary');
  fs.mkdirSync(app);
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !name.includes('.test.') && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(app, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(app, 'agents'), { recursive: true });
  const state = { title: 'A map', nodes: [], edges: [], people: [], calls: [], prs: [], log: [], threads: {} };
  fs.mkdirSync(path.join(primary, '.living-map'), { recursive: true });
  fs.writeFileSync(path.join(primary, '.living-map/state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(app, 'projects.json'), '[]');
  for (const name of ['first', 'second']) { fs.mkdirSync(path.join(app, 'maps', name), { recursive: true }); fs.writeFileSync(path.join(app, 'maps', name, 'state.json'), JSON.stringify(state)); }
  const env = { ...process.env, ANUR_LIVING_MAP_MAPS: app, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '', LIVING_MAP_CLOUD_CONFIG: path.join(root, 'no-cloud.json') };
  const cookie = (/** @type {string} */ name) => execFileSync(process.execPath, ['--input-type=module', '-e', `import {users} from './users.js';console.log(users.start(${JSON.stringify(name)}))`], { cwd: app, env, encoding: 'utf8' }).trim();
  // Duy made this install's first account, and so owns it
  execFileSync(process.execPath, ['--input-type=module', '-e', "import {users} from './users.js';users.create('Duy','a long password')"], { cwd: app, env });
  const duy = cookie('Duy'), priyanka = cookie('Priyanka');
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`; let /** @type {any} */ child;
  const start = async () => {
    child = spawn(process.execPath, ['server.js', String(port), '--project', primary], { cwd: app, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/version')).ok) return; } catch { /* not listening yet: ask again */ } await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('Server did not start');
  };
  const stop = async () => { if (child && child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } };
  const request = (/** @type {string} */ route, /** @type {any} */ { token = duy, data, from = origin } = {}) => fetch(origin + route, { method: data ? 'POST' : 'GET', redirect: 'manual', headers: { cookie: `lm_session=${token}`, 'sec-fetch-site': 'same-origin', ...(data ? { origin: from, 'content-type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const pinned = async (/** @type {string} */ token) => (await (await request('/api/maps', { token })).json()).filter((/** @type {any} */ m) => m.pinned).map((/** @type {any} */ m) => m.name).sort();
  const pin = (/** @type {string} */ name, on = true, options = {}) => request('/api/maps/pin', { ...options, data: { name, pinned: on } });
  try {
    await start();
    expect(await pinned(duy)).toEqual([]);
    expect((await pin('second')).status).toBe(200);
    expect(await (await pin('primary')).json()).toEqual({ name: 'primary', pinned: true });
    expect(await pinned(duy)).toEqual(['primary', 'second']);
    expect(await pinned(priyanka)).toEqual([]);
    expect((await pin('missing')).status).toBe(404);
    expect((await pin('../primary')).status).toBe(404);
    expect((await pin('first', true, { from: 'https://elsewhere.example' })).status).toBe(403);
    expect(await pinned(duy)).toEqual(['primary', 'second']);
    expect((await pin('second', false)).status).toBe(200);
    await stop(); await start();
    expect(await pinned(duy)).toEqual(['primary']);
    expect(await pinned(priyanka)).toEqual([]);
    // the home page carries your role for its account menu: the owner of this install is its Owner
    expect(await (await request('/')).text()).toContain('<meta name="lm-role" content="Owner">');
  } finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
}, 15000);
