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
  expect(sharedState(s).linkSharing.token).toBeUndefined();
  expect(sharedState(s, true).linkSharing.token).toBe(token);
  changeSharing(s, 'Duy', 'restricted');
  expect(permission(s, null, req(token))).toBe(null);
  changeSharing(s, 'Duy', 'edit');
  expect(s.linkSharing.token).not.toBe(token);
});

it('enforces view/edit links in pages, APIs and live streams, including revocation and restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-sharing-'));
  for (const name of fs.readdirSync(import.meta.dirname)) if (/\.(js|json|html|md)$/.test(name) && !fs.lstatSync(path.join(import.meta.dirname, name)).isSymbolicLink()) fs.copyFileSync(path.join(import.meta.dirname, name), path.join(root, name));
  const state = JSON.parse(/** @type {any} */ (fs.readFileSync(path.join(root, 'seed.json'), 'utf8')));
  state.people = [{ id: 'Duy', role: 'Admin', joined: 'test' }];
  state.threads = { '@Duy': [{ who: 'Duy', text: 'private-chat-marker' }] };
  fs.mkdirSync(path.join(root, 'maps', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(root, 'maps', 'shared', 'state.json'), JSON.stringify(state));
  const env = { ...process.env, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '' };
  const cookie = execFileSync(process.execPath, ['--input-type=module', '-e', "import {users} from './users.js'; console.log(users.start('Duy'))"], { cwd: root, env, encoding: 'utf8' }).trim();
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`; let child, reader;
  const start = async () => {
    child = spawn(process.execPath, ['server.js', String(port)], { cwd: root, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/version')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('Test server did not start');
  };
  const stop = async () => { if (child && child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } };
  const request = (route, /** @type {any} */ { token, owner = false, data } = {}) => fetch(origin + route + (token ? `?share=${token}` : ''), { method: data ? 'POST' : 'GET', redirect: 'manual', headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', ...(owner ? { cookie: `lm_session=${cookie}` } : {}), ...(data ? { origin, 'content-type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const change = (mode) => request('/shared/api/sharing', { owner: true, data: { mode } });
  const stream = async (token) => { const r = await request('/shared/api/events', { token }); reader = r.body.getReader(); return new TextDecoder().decode((await reader.read()).value); };
  const end = async () => { let text = ''; for (;;) { const r = await reader.read(); if (r.done) return text; text += new TextDecoder().decode(r.value); } };
  try {
    await start();
    const rootLink = await (await request('/api/sharing', { owner: true, data: { mode: 'view' } })).json();
    expect((await request('/api/state', { token: rootLink.token })).status).toBe(200);
    expect((await request('/api/update', { token: rootLink.token, data: {} })).status).toBe(401);
    expect((await request('/shared/')).status).toBe(302);
    expect((await request('/shared/api/state')).status).toBe(403);
    expect((await request('/shared/api/sharing', { data: { mode: 'edit' } })).status).toBe(403);
    expect((await request('/shared/api/cloud/delete', { owner: true, data: {} })).status).toBe(403);
    const { token } = await (await change('view')).json();
    expect((await request('/shared/api/cloud/delete', { token, data: {confirm:true} })).status).toBe(403);
    const page = await request('/shared/', { token }); expect(page.status).toBe(200);
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await page.text()).toContain('name="lm-access" content="view"');
    const data = await (await request('/shared/api/state', { token })).text();
    expect(data).not.toContain(token); expect(data).not.toContain('private-chat-marker');
    const file = await (await request('/shared/api/file', { token })).text(); expect(file).not.toContain(token);
    for (const type of ['add', 'remove', 'rename', 'describebox', 'cursor', 'reset']) expect((await request('/shared/api/act', { token, data: { type, label: 'Blocked', x: 10, y: 10 } })).status).toBe(403);
    expect((await request('/shared/api/outbox', { token })).status).toBe(403);
    expect((await request('/api/maps', { token })).status).toBe(401);
    expect((await request('/other/api/state', { token })).status).toBe(403);
    expect(await stream(token)).not.toContain(token);
    await change('edit'); expect(await end()).toContain('access-changed');
    const added = await request('/shared/api/act', { token, data: { type: 'add', by: 'Duy', label: 'From link', x: 20, y: 20 } }); expect(added.status).toBe(200);
    const { id } = await added.json();
    const next = await (await request('/shared/api/state', { token })).json(); expect(next.nodes.find((n) => n.id === id).by).toBe('Guest');
    const description = async () => (await (await request('/shared/api/state', { token })).json()).nodes.find((n) => n.id === id).sub || '';
    expect((await request('/shared/api/act', { token, data: { type: 'describebox', id, sub: 'A clearer description' } })).status).toBe(200);
    expect(await description()).toBe('A clearer description');
    await request('/shared/api/act', { token, data: { type: 'undo' } }); expect(await description()).toBe('');
    await request('/shared/api/act', { token, data: { type: 'redo' } }); expect(await description()).toBe('A clearer description');
    for (const type of ['reset', 'ask', 'plan', 'execute', 'link']) expect((await request('/shared/api/act', { token, data: { type } })).status).toBe(403);
    expect((await request('/shared/api/sharing', { token, data: { mode: 'edit' } })).status).toBe(403);
    await stop(); await start();
    expect(await description()).toBe('A clearer description');
    expect((await request('/shared/api/state', { token })).status).toBe(200);
    await stream(token); await change('view'); expect(await end()).toContain('access-changed');
    expect((await request('/shared/api/act', { token, data: { type: 'remove', id } })).status).toBe(403);
    await stream(token); await change('restricted'); expect(await end()).toContain('access-removed');
    expect((await request('/shared/', { token })).status).toBe(403);
    expect((await request('/shared/api/state', { token })).status).toBe(403);
    const renewed = await (await change('view')).json(); expect(renewed.token).not.toBe(token);
    expect((await request('/shared/api/state', { owner: true })).status).toBe(200);
  } finally { await /** @type {any} */ (reader)?.cancel().catch(() => {}); await stop(); fs.rmSync(root, { recursive: true, force: true }); }
}, 15000);
