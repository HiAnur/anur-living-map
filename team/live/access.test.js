import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { expect, it } from 'vitest';

import { adminsOf, canAccess, changeAccess, fromThisMac, isEngineer, localTool, setEngineer } from './access.js';
import { openTestMap, read, send } from './map.harness.js';

it('makes you an Admin of every map on this Mac, keeps whoever made a map its Admin, and keeps an older map\'s Admins', () => {
  expect(adminsOf({ admins: ['Sam'], people: [{ id: 'Duy', role: 'Admin' }] }, { before: ['Duy'] })).toEqual(['Sam']);
  expect(adminsOf({ admins: ['Sam'] }, { me: 'Alex' })).toEqual(['Alex', 'Sam']);
  expect(adminsOf({ admins: [] }, { me: null })).toEqual([]);
  // a map made under the name you had before is still yours under the name you have now
  expect(adminsOf({ admins: ['Harshit'] }, { me: 'Harshit Khandelwal' })).toEqual(['Harshit Khandelwal', 'Harshit']);
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

it('takes a page of this map on this Mac as you, and never another site or another address', () => {
  const req = (/** @type {Record<string, string>} */ headers, method = 'GET', url = '/shop/api/state') => ({ method, url, headers: { host: 'localhost:4323', ...headers } });
  // the page's own reads and posts, and a typed address
  expect(fromThisMac(req({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }))).toBe(true);
  expect(fromThisMac(req({ 'sec-fetch-site': 'same-origin', origin: 'http://localhost:4323', 'content-type': 'application/json' }, 'POST', '/shop/api/act'))).toBe(true);
  expect(fromThisMac(req({ 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate' }, 'GET', '/shop/'))).toBe(true);
  expect(fromThisMac({ ...req({ 'sec-fetch-site': 'same-origin' }), headers: { host: '127.0.0.1:4323', 'sec-fetch-site': 'same-origin' } })).toBe(true);
  // another site open in the same browser: its reads, its posts, and a page on another port of this Mac
  expect(fromThisMac(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', origin: 'https://elsewhere.example' }))).toBe(false);
  expect(fromThisMac(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' }))).toBe(false);
  expect(fromThisMac(req({ 'sec-fetch-site': 'cross-site', origin: 'https://elsewhere.example', 'content-type': 'text/plain' }, 'POST', '/shop/api/act'))).toBe(false);
  expect(fromThisMac(req({ 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors', origin: 'http://localhost:5173' }))).toBe(false);
  expect(fromThisMac(req({ origin: 'https://elsewhere.example', 'content-type': 'application/json' }, 'POST', '/api/me'))).toBe(false);
  // a link from another site opens a page it cannot read, but no API and no sign-in
  expect(fromThisMac(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, 'GET', '/shop/'))).toBe(true);
  expect(fromThisMac(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, 'GET', '/shop/api/state'))).toBe(false);
  expect(fromThisMac(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, 'GET', '/auth/google'))).toBe(false);
  expect(fromThisMac(req({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' }, 'POST', '/shop/'))).toBe(false);
  // an address that only resolves to this Mac, as a rebinding site uses, is never you
  expect(fromThisMac({ method: 'GET', url: '/', headers: { host: 'evil.example:4323', 'sec-fetch-site': 'same-origin' } })).toBe(false);
  expect(fromThisMac({ method: 'GET', url: '/', headers: { host: 'localhost.evil.example:4323', 'sec-fetch-site': 'same-origin' } })).toBe(false);
  // a program on this Mac is a tool, not a page: it acts as Claude or as the chat it speaks for
  expect(fromThisMac(req({ 'sec-fetch-mode': 'cors', 'user-agent': 'node' }))).toBe(false);
});

it('disconnects a removed member and blocks their page, APIs and stream, and keeps them out after a restart', async () => {
  const state = JSON.parse(/** @type {any} */ (fs.readFileSync(path.join(import.meta.dirname, 'seed.json'), 'utf8')));
  state.people = [{ id: 'Duy', role: 'Admin', joined: 'test' }, { id: 'Member', joined: 'test' }];
  const { map, close } = openTestMap(state, 'access');
  try {
    expect((await send(map, 'Member', { person: 'Duy' }, '/api/access')).status).toBe(403);
    expect((await send(map, 'Duy', null, '/api/access')).status).toBe(400);
    // Member's window is following the map when Duy removes them
    let streamed = '';
    const res = { writeHead() { return res; }, write(/** @type {string} */ t) { streamed += t; return true; }, end(/** @type {string} */ t = '') { streamed += t; return res; }, setHeader() {}, on() {} };
    await map.handle(Object.assign(Readable.from([]), { method: 'GET', url: '/api/events', headers: { host: 'localhost', cookie: 'lm_session=x' }, on() {} }), res, '/api/events', /** @type {any} */ ('Member'));
    expect((await send(map, 'Duy', { person: 'Member' }, '/api/access')).status).toBe(200);
    expect(streamed).toContain('event: access-removed');
    for (const route of ['/', '/api/state', '/api/events', '/api/file', '/api/history', '/api/outbox']) expect((await read(map, 'Member', route)).status).toBe(403);
    // a browser page that is no one (another site) is kept out too, while a program on this Mac still reads
    const asNobody = async (/** @type {Record<string, string>} */ headers) => { let status = 0; const r = { writeHead(/** @type {number} */ s) { status = s; return r; }, end() { return r; }, write() { return true; }, setHeader() {}, on() {} };
      await map.handle(Object.assign(Readable.from([]), { method: 'GET', url: '/api/state', headers: { host: 'localhost', ...headers }, on() {} }), r, '/api/state', null); return status; };
    expect(await asNobody({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' })).toBe(403);
    expect(await asNobody({})).toBe(200);
    expect((await read(map, 'Duy', '/api/state')).status).toBe(200);
    // the removal is kept with the map, and only an Admin brings them back
    const kept = openTestMap(map.snapshot(), 'access-again');
    try {
      expect((await read(kept.map, 'Member', '/api/state')).status).toBe(403);
      expect((await send(kept.map, 'Duy', { person: 'Member', restore: true }, '/api/access')).status).toBe(200);
      expect((await read(kept.map, 'Member', '/api/state')).status).toBe(200);
    } finally { kept.close(); }
  } finally { close(); }
});

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
