import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

it('deletes unopened and project maps for the owner, preserves code, and keeps deletions across restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-delete-'));
  const app = path.join(root, 'app'), primary = path.join(root, 'primary'), secondary = path.join(root, 'secondary');
  fs.mkdirSync(app);
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !name.includes('.test.') && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(app, name));
  const state = { title: 'Unopened map', nodes: [], edges: [], people: [], calls: [], prs: [], log: [], threads: {} };
  for (const folder of [primary, secondary]) {
    fs.mkdirSync(path.join(folder, '.living-map'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'README.md'), 'Keep this project source.');
    fs.writeFileSync(path.join(folder, '.living-map/state.json'), JSON.stringify(state));
  }
  fs.writeFileSync(path.join(app, 'projects.json'), JSON.stringify([secondary]));
  const named = path.join(app, 'maps/unopened'); fs.mkdirSync(named, { recursive: true });
  fs.writeFileSync(path.join(named, 'state.json'), JSON.stringify(state));
  const env = { ...process.env, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '', LIVING_MAP_CLOUD_CONFIG: path.join(root, 'no-cloud.json') };
  const cookie = (name) => execFileSync(process.execPath, ['--input-type=module', '-e', `import {users} from './users.js';console.log(users.start(${JSON.stringify(name)}))`], { cwd: app, env, encoding: 'utf8' }).trim();
  const owner = cookie('Duy'), member = cookie('Priyanka');
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', r)); const port = reserve.address().port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`; let child;
  const start = async () => {
    child = spawn(process.execPath, ['server.js', String(port), '--project', primary], { cwd: app, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/version')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('Server did not start');
  };
  const stop = async () => { if (child && child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } };
  const request = (route, { token = owner, data, from = origin } = {}) => fetch(origin + route, { method: data ? 'POST' : 'GET', redirect: 'manual', headers: { cookie: `lm_session=${token}`, 'sec-fetch-site': 'same-origin', ...(data ? { origin: from, 'content-type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const remove = (name, options = {}) => request('/api/maps/delete', { ...options, data: { name } });
  try {
    await start();
    const list = await (await request('/api/maps')).json();
    expect(list.map((m) => [m.name, m.deletable]).sort()).toEqual([['primary', true], ['secondary', true], ['unopened', true]]);
    expect((await (await request('/api/maps', { token: member })).json()).every((m) => !m.deletable)).toBe(true);
    expect((await remove('unopened', { token: member })).status).toBe(403);
    expect((await remove('unopened', { from: 'https://elsewhere.example' })).status).toBe(403);
    expect((await remove('../primary')).status).toBe(404);
    expect((await remove('missing')).status).toBe(404);
    for (const name of ['unopened', 'secondary', 'primary']) {
      expect((await remove(name)).status).toBe(200);
      expect((await request(`/${name}/api/state`)).status).toBe(410);
    }
    expect(await (await request('/api/maps')).json()).toEqual([]);
    expect((await request('/')).status).toBe(200);
    for (const folder of [primary, secondary]) {
      expect(fs.readFileSync(path.join(folder, 'README.md'), 'utf8')).toBe('Keep this project source.');
      expect(fs.existsSync(path.join(folder, '.living-map'))).toBe(false);
    }
    const bin = path.join(app, 'maps/.deleted');
    const archives = fs.readdirSync(bin).filter((n) => n !== 'index.json'); expect(archives).toHaveLength(3);
    for (const archive of archives) expect(JSON.parse(fs.readFileSync(path.join(bin, archive, 'state.json'), 'utf8')).title).toBe(state.title);
    await stop(); await start();
    expect(await (await request('/api/maps')).json()).toEqual([]);
    for (const name of ['unopened', 'secondary', 'primary']) expect((await request(`/${name}/`)).status).toBe(410);
    for (const folder of [primary, secondary]) expect(fs.existsSync(path.join(folder, '.living-map'))).toBe(false);
    expect((await remove('unopened')).status).toBe(404);
    expect(fs.existsSync(path.join(app, 'maps/missing'))).toBe(false);
  } finally { await stop(); fs.rmSync(root, { recursive: true, force: true }); }
}, 15000);
