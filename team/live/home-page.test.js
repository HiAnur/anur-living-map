import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, expect, it } from 'vitest';

// The first screen is your maps, whatever the server was started with; the plan-first story shows only with --demo.
const roots = /** @type {string[]} */ ([]);
afterAll(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

/** A copy of the server on a port of its own, started with `args`; what it serves to someone signed in. @param {string[]} args */
async function serve(args) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-home-')); roots.push(root);
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && name !== 'projects.json' && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(root, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(root, 'agents'), { recursive: true });
  const env = { ...process.env, HOME: path.join(root, 'home'), LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '', LIVING_MAP_CLOUD_CONFIG: path.join(root, 'no-cloud.json'), ANUR_LIVING_MAP_NO_UPDATE: '1' };
  const cookie = execFileSync(process.execPath, ['--input-type=module', '-e', "import {users} from './users.js'; console.log(users.start('Duy'))"], { cwd: root, env, encoding: 'utf8' }).trim();
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js', String(port), ...args], { cwd: root, env, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + '/api/version')).ok) break; } catch { /* not listening yet */ } await new Promise((r) => setTimeout(r, 50)); }
  const get = (/** @type {string} */ p) => fetch(origin + p, { headers: { 'sec-fetch-site': 'same-origin', cookie: `lm_session=${cookie}` }, redirect: 'manual' });
  const post = (/** @type {string} */ p, /** @type {any} */ data) => fetch(origin + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  return { root, get, post, stop: async () => { if (child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } } };
}

it('with no project, shows the list of maps at / and never the story, and lists a code folder added from a chat', async () => {
  const s = await serve([]);
  try {
    const home = await (await s.get('/')).text();
    expect(home).toContain('Or pick a map you have');
    expect(home).not.toMatch(/acme/i);
    expect(await (await s.get('/api/maps')).json()).toEqual([]);
    // the server's own address holds no map
    expect((await s.get('/api/state')).status).toBe(404);
    // a chat opening the map from a repo adds it, as open-map.sh does
    const repo = path.join(s.root, 'shop-api'); fs.mkdirSync(repo);
    expect(await (await s.post('/api/projects', { folder: repo })).json()).toEqual({ name: 'shop-api', href: '/shop-api/' });
    expect((await (await s.get('/api/maps')).json()).map((/** @type {any} */ m) => m.name)).toEqual(['shop-api']);
    // a map's tab reads Living Map until the map itself loads
    expect(await (await s.get('/shop-api/')).text()).toContain('<title>Living Map</title>');
  } finally { await s.stop(); }
});

it('gives a new map of a folder named "repo" its title\'s address, and keeps the folder\'s name working', async () => {
  const s = await serve([]);
  try {
    const repo = path.join(s.root, 'repo'), old = path.join(s.root, 'old'), taken = path.join(s.root, 'other');
    for (const [dir, pkg] of [[repo, 'shop-api'], [old, 'billing'], [taken, '@acme/shop-api']]) { fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg })); }
    // a map someone already has keeps the address they used
    fs.mkdirSync(path.join(old, '.living-map')); fs.writeFileSync(path.join(old, '.living-map', 'state.json'), JSON.stringify({ title: 'billing', nodes: [], edges: [], calls: [] }));
    expect(await (await s.post('/api/projects', { folder: repo })).json()).toEqual({ name: 'shop-api', href: '/shop-api/' });
    expect(fs.readFileSync(path.join(repo, '.living-map', 'address'), 'utf8').trim()).toBe('shop-api');
    expect((await (await s.post('/api/projects', { folder: old })).json()).name).toBe('old');
    // a title another map answers to already leaves the folder's own name
    expect((await (await s.post('/api/projects', { folder: taken })).json()).name).toBe('other');
    // adding it again changes nothing
    expect((await (await s.post('/api/projects', { folder: repo })).json()).name).toBe('shop-api');
    // the folder's name sends pages to the address, and its API answers there too, for listeners named by folder
    const page = await s.get('/repo/?x=1');
    expect([page.status, page.headers.get('location')]).toEqual([302, '/shop-api/?x=1']);
    expect((await (await s.get('/repo/api/state')).json()).title).toBe('shop-api');
    expect((await (await s.get('/api/maps')).json()).map((/** @type {any} */ m) => m.name).sort()).toEqual(['old', 'other', 'shop-api']);
  } finally { await s.stop(); }
});

it('plays the story at / only with --demo', async () => {
  const s = await serve(['--demo']);
  try {
    expect(await (await s.get('/')).text()).toContain('id="nodes"');
    expect((await (await s.get('/api/state')).json()).title).toMatch(/acme/i);
  } finally { await s.stop(); }
});
