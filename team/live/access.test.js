import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { adminsOf, canAccess, changeAccess, isEngineer, localTool, setEngineer } from './access.js';

it('makes whoever made a map its Admin, the install\'s owner Admin of a repo\'s own map, and keeps an older map\'s Admins', () => {
  expect(adminsOf({ admins: ['Sam'], people: [{ id: 'Duy', role: 'Admin' }] }, { owner: 'Alex', before: ['Duy'] })).toEqual(['Sam']);
  expect(adminsOf({ admins: ['Sam'] }, { project: true, owner: 'Alex' })).toEqual(['Alex', 'Sam']);
  expect(adminsOf({ admins: [] }, { project: true, owner: null })).toEqual([]);
  // a map from before maps recorded it: the Admins it was stored with, and the ones it is given
  expect(adminsOf({ people: [{ id: 'Duy', role: 'Admin' }, { id: 'Kim', role: 'CFO' }] }, { before: ['Alex', 'Duy'] })).toEqual(['Duy', 'Alex']);
});

it('only owners remove members, owners keep access, and removal survives serialization', () => {
  const s = { people: [{ id: 'Duy', role: 'Admin' }, { id: 'Member' }] };
  expect(changeAccess(s, 'Member', 'Duy')).toBe(false);
  expect(changeAccess(s, 'Duy', 'Duy')).toBe(false);
  expect(changeAccess(s, 'Duy', 'Member')).toBe(true);
  const saved = JSON.parse(JSON.stringify(s));
  expect(canAccess(saved, 'Member', { headers: {} })).toBe(false);
  expect(canAccess(saved, 'Duy', { headers: {} })).toBe(true);
  expect(canAccess(saved, null, { headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } })).toBe(false);
  expect(canAccess(saved, null, { headers: {} })).toBe(true);
  expect(canAccess(saved, null, { headers: { 'sec-fetch-mode': 'cors', accept: '*/*', 'user-agent': 'node' } })).toBe(true);
  expect(changeAccess(saved, 'Duy', 'Member', true)).toBe(true);
  expect(canAccess(saved, 'Member', { headers: {} })).toBe(true);
});

it('takes a request from Node fetch or curl as a local tool, never one from a browser page', () => {
  const headers = (h) => ({ headers: h });
  // Node's global fetch, as mcp.js and wait.js send it: sec-fetch-mode but no sec-fetch-site
  expect(localTool(headers({ host: 'localhost:4323', connection: 'keep-alive', accept: '*/*', 'accept-language': '*', 'sec-fetch-mode': 'cors', 'user-agent': 'node', 'accept-encoding': 'gzip, deflate' }))).toBe(true);
  expect(localTool(headers({ host: 'localhost:4323', accept: '*/*', 'user-agent': 'curl/8.7.1' }))).toBe(true);
  // a page's fetch: same-origin read, a signed-in read, a post with origin, a navigation
  expect(localTool(headers({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', accept: '*/*' }))).toBe(false);
  expect(localTool(headers({ cookie: 'lm_session=abc', accept: '*/*' }))).toBe(false);
  expect(localTool(headers({ origin: 'http://localhost:4323', 'content-type': 'application/json' }))).toBe(false);
  expect(localTool(headers({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }))).toBe(false);
});

it('disconnects a removed member and blocks page, APIs, discovery and raw files after restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-access-'));
  const source = import.meta.dirname;
  for (const name of fs.readdirSync(source)) if (/\.(js|json|html|md)$/.test(name) && fs.statSync(path.join(source, name)).isFile()) fs.copyFileSync(path.join(source, name), path.join(root, name));
  fs.cpSync(path.join(source, 'agents'), path.join(root, 'agents'), { recursive: true });
  const state = JSON.parse(/** @type {any} */ (fs.readFileSync(path.join(source, 'seed.json'), 'utf8')));
  state.people = [{ id: 'Duy', role: 'Admin', joined: 'test' }, { id: 'Member', joined: 'test' }];
  fs.mkdirSync(path.join(root, 'maps', 'private'), { recursive: true });
  fs.writeFileSync(path.join(root, 'maps', 'private', 'state.json'), JSON.stringify(state));
  const env = { ...process.env, ANUR_LIVING_MAP_MAPS: root, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '' };
  const cookies = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import {users} from './users.js'; console.log(JSON.stringify([users.start('Duy'),users.start('Member')]))"], { cwd: root, env, encoding: 'utf8' }));
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r))); const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`; let child;
  const start = async () => {
    child = spawn(process.execPath, ['server.js', String(port)], { cwd: root, env, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/version')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('Test server did not start');
  };
  const stop = async () => { if (child && child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } };
  const get = (route, /** @type {any} */ actor = 1, headers = {}) => fetch(origin + route, { headers: { ...(actor === null ? {} : { cookie: `lm_session=${cookies[actor]}` }), ...headers }, redirect: 'manual' });
  const access = (actor, data) => fetch(origin + '/private/api/access', { method: 'POST', headers: { cookie: `lm_session=${cookies[actor]}`, origin, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  /** @type {any} */ let reader;
  try {
    await start();
    expect((await access(1, { person: 'Duy' })).status).toBe(403);
    expect((await access(0, null)).status).toBe(400);
    const stream = await get('/private/api/events'); reader = /** @type {any} */ (stream.body).getReader(); await reader.read();
    expect((await access(0, { person: 'Member' })).status).toBe(200);
    let events = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; events += new TextDecoder().decode(chunk.value); }
    expect(events).toContain('event: access-removed');
    for (const route of ['/private/', '/private/api/state', '/private/api/events', '/private/api/file', '/private/api/history', '/private/api/outbox']) expect((await get(route)).status).toBe(403);
    expect((await get('/private/api/state', null, { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' })).status).toBe(403);
    expect((await get('/private/api/state', null)).status).toBe(200);
    expect((await get('/maps/private/state.json')).status).toBe(404);
    expect((await (await get('/api/maps')).json()).some((m) => m.name === 'private')).toBe(false);
    expect((await get('/private/api/state', 0)).status).toBe(200);
    await stop(); await start();
    expect((await get('/private/api/state')).status).toBe(403);
    expect((await access(0, { person: 'Member', restore: true })).status).toBe(200);
    expect((await get('/private/api/state')).status).toBe(200);
  } finally { await reader?.cancel().catch(() => {}); await stop(); fs.rmSync(root, { recursive: true, force: true }); }
}, 15000);

it('counts an Admin, a member marked Engineer, and a role that says so as Engineers, and lets only an Admin mark one', () => {
  const state = /** @type {any} */ ({ people: [{ id: 'Duy', role: 'Admin' }, { id: 'Harshit', role: 'Engineer, runs Claude Code' }, { id: 'Priyanka', role: 'CFO' }, { id: 'Sam' }] });
  expect(['Duy', 'Harshit', 'Priyanka', 'Sam', 'Nobody'].map((who) => isEngineer(state, who))).toEqual([true, true, false, false, false]);
  expect(setEngineer(state, 'Harshit', 'Sam', true)).toBe(false);
  expect(setEngineer(state, 'Duy', 'Sam', true)).toBe(true);
  expect(isEngineer(state, 'Sam')).toBe(true);
  expect(setEngineer(state, 'Duy', 'Duy', false)).toBe(false);
  expect(setEngineer(state, 'Duy', 'Sam', false)).toBe(true);
  expect(isEngineer(state, 'Sam')).toBe(false);
});
