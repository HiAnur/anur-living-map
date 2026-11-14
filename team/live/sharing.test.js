import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { changeSharing, permission, sharedState } from './sharing.js';

it('only owners enable links; disabling rotates the next link and snapshots never leak its secret', () => {
  const s = { people: [{ id: 'Duy', role: 'Admin' }], removedPeople: ['Removed'] };
  const req = (token = '') => ({ url: '/?share=' + token, headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } });
  expect(changeSharing(s, 'Guest', 'edit')).toBe(false);
  expect(changeSharing(s, 'Duy', 'unknown')).toBe(false);
  expect(changeSharing(s, 'Duy', 'view')).toBe(true);
  const token = s.linkSharing.token;
  expect(permission(s, null, req(token))).toBe('view');
  expect(permission(s, 'Removed', req(token))).toBe(null);
  expect(permission(s, 'Duy', req(token))).toBe('owner');
  expect(sharedState(/** @type {any} */ (s)).linkSharing.token).toBeUndefined();
  expect(sharedState(/** @type {any} */ (s), true).linkSharing.token).toBe(token);
  changeSharing(s, 'Duy', 'restricted');
  expect(permission(s, null, req(token))).toBe(null);
  changeSharing(s, 'Duy', 'edit');
  expect(s.linkSharing.token).not.toBe(token);
});

it('enforces view/edit links in pages, APIs and live streams, including revocation and restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-sharing-'));
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(root, name));
  fs.cpSync(path.join(import.meta.dirname, 'agents'), path.join(root, 'agents'), { recursive: true });
  const state = JSON.parse(/** @type {any} */ (fs.readFileSync(path.join(root, 'seed.json'), 'utf8')));
  state.people = [{ id: 'Duy', role: 'Admin', joined: 'test' }];
  state.threads = { '@Duy': [{ who: 'Duy', text: 'private-chat-marker' }] };
  fs.mkdirSync(path.join(root, 'maps', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(root, 'maps', 'shared', 'state.json'), JSON.stringify(state));
  const env = { ...process.env, ANUR_LIVING_MAP_MAPS: root, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '' };
  execFileSync(process.execPath, ['--input-type=module', '-e', "import {users} from './users.js'; users.rename('Duy')"], { cwd: root, env });
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  let /** @type {any} */ child, /** @type {any} */ live;
  const start = async () => {
    child = spawn(process.execPath, ['server.js', String(port), '--demo'], { cwd: root, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}/api/version`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('Test server did not start');
  };
  const stop = async () => { if (child && child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } };
  // The owner is Duy's own page on this Mac. Someone with a link reaches the map at another address (a tunnel to
  // this Mac): they are never Duy there, whatever their browser sends.
  /** @returns {Promise<any>} */
  const request = (/** @type {string} */ route, /** @type {any} */ { token, owner = false, data } = {}) => new Promise((ok, fail) => {
    const host = owner ? `localhost:${port}` : `share.example:${port}`;
    const req = http.request({ host: '127.0.0.1', port, path: route + (token ? `?share=${token}` : ''), method: data ? 'POST' : 'GET',
      headers: { host, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', ...(data ? { origin: `http://${host}`, 'content-type': 'application/json' } : {}) } }, ok);
    req.on('error', fail); req.end(data ? JSON.stringify(data) : undefined);
  });
  const text = (/** @type {any} */ res) => new Promise((ok) => { let t = ''; res.setEncoding('utf8'); res.on('data', (/** @type {string} */ c) => { t += c; }); res.on('end', () => ok(t)); });
  const json = async (/** @type {any} */ res) => JSON.parse(/** @type {string} */ (await text(res)));
  const status = async (/** @type {string} */ route, /** @type {any} */ o = {}) => { const res = await request(route, o); res.resume(); return res.statusCode; };
  const change = async (/** @type {string} */ mode) => json(await request('/shared/api/sharing', { owner: true, data: { mode } }));
  // a window following the map: what it is sent first, and then the rest until the server closes it
  const stream = async (/** @type {string} */ token) => {
    const res = await request('/shared/api/events', { token }); res.setEncoding('utf8');
    let all = ''; const ended = new Promise((ok) => res.on('end', ok)); res.on('data', (/** @type {string} */ c) => { all += c; });
    while (!all) await new Promise((r) => setTimeout(r, 10));
    const first = all; live = { res, end: async () => { await ended; return all.slice(first.length); } };
    return first;
  };
  const end = () => live.end();
  try {
    await start();
    const rootLink = await json(await request('/api/sharing', { owner: true, data: { mode: 'view' } }));
    expect(await status('/api/state', { token: rootLink.token })).toBe(200);
    expect(await status('/api/update', { token: rootLink.token, data: {} })).toBe(403);
    expect(await status('/shared/')).toBe(403);
    expect(await status('/shared/api/state')).toBe(403);
    expect(await status('/shared/api/sharing', { data: { mode: 'edit' } })).toBe(403);
    expect(await status('/shared/api/cloud/delete', { owner: true, data: {} })).toBe(403);
    const { token } = await change('view');
    expect(await status('/shared/api/cloud/delete', { token, data: {confirm:true} })).toBe(403);
    const page = await request('/shared/', { token }); expect(page.statusCode).toBe(200);
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(await text(page)).toContain('name="lm-access" content="view"');
    const data = await text(await request('/shared/api/state', { token }));
    expect(data).not.toContain(token); expect(data).not.toContain('private-chat-marker');
    const file = await text(await request('/shared/api/file', { token })); expect(file).not.toContain(token);
    for (const type of ['add', 'remove', 'rename', 'describebox', 'cursor', 'reset']) expect(await status('/shared/api/act', { token, data: { type, label: 'Blocked', x: 10, y: 10 } })).toBe(403);
    expect(await status('/shared/api/outbox', { token })).toBe(403);
    expect(await status('/api/maps', { token })).toBe(403);
    expect(await status('/other/api/state', { token })).toBe(403);
    expect(await stream(token)).not.toContain(token);
    await change('edit'); expect(await end()).toContain('access-changed');
    const added = await request('/shared/api/act', { token, data: { type: 'add', by: 'Duy', label: 'From link', x: 20, y: 20 } }); expect(added.statusCode).toBe(200);
    const { id } = await json(added);
    const next = await json(await request('/shared/api/state', { token })); expect(next.nodes.find((/** @type {any} */ n) => n.id === id).by).toBe('Guest');
    const description = async () => (await json(await request('/shared/api/state', { token }))).nodes.find((/** @type {any} */ n) => n.id === id).sub || '';
    expect(await status('/shared/api/act', { token, data: { type: 'describebox', id, sub: 'A clearer description' } })).toBe(200);
    expect(await description()).toBe('A clearer description');
    await status('/shared/api/act', { token, data: { type: 'undo' } }); expect(await description()).toBe('');
    await status('/shared/api/act', { token, data: { type: 'redo' } }); expect(await description()).toBe('A clearer description');
    for (const type of ['reset', 'ask', 'plan', 'execute', 'link']) expect(await status('/shared/api/act', { token, data: { type } })).toBe(403);
    expect(await status('/shared/api/sharing', { token, data: { mode: 'edit' } })).toBe(403);
    await stop(); await start();
    expect(await description()).toBe('A clearer description');
    expect(await status('/shared/api/state', { token })).toBe(200);
    await stream(token); await change('view'); expect(await end()).toContain('access-changed');
    expect(await status('/shared/api/act', { token, data: { type: 'remove', id } })).toBe(403);
    await stream(token); await change('restricted'); expect(await end()).toContain('access-removed');
    expect(await status('/shared/', { token })).toBe(403);
    expect(await status('/shared/api/state', { token })).toBe(403);
    const renewed = await change('view'); expect(renewed.token).not.toBe(token);
    expect(await status('/shared/api/state', { owner: true })).toBe(200);
  } finally { live?.res.destroy(); await stop(); fs.rmSync(root, { recursive: true, force: true }); }
}, 15000);
