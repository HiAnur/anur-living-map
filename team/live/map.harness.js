// Sending requests to a real map through its API, as each kind of person: what the tests that ask a map what it
// allows share. Not a test itself, and not shipped (package.json and cloud/prepare.mjs leave *.harness.js out).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { openMap } from './server.js';

/** The share key a test map's link carries: put it in the map's `linkSharing.token`. */
export const TOKEN = 'a'.repeat(64);

/**
 * Who sends a request: a signed-in person by name, a guest with the map's `'edit link'` or `'view link'`, or
 * `'tool'`, a program on this Mac, which names itself Duy.
 * @typedef {string} Sender
 */

/**
 * A map of its own in a folder of its own, kept in memory; `more` is what else openMap is told (who is signed in).
 * @param {any} initialState @param {any} [more]
 */
export function openTestMap(initialState, name = 'test-map', more = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `lm-${name}-`));
  const map = openMap({ name, home, memory: true, initialState, ...more });
  return { map, close: () => { map.close(); fs.rmSync(home, { recursive: true, force: true }); } };
}

/**
 * One request to the map's /api/act, as `who` sends it: its status and the body it answered with.
 * @param {ReturnType<typeof openMap>} map @param {Sender} who @param {any} a
 */
export async function send(map, who, a) {
  const link = who === 'edit link' || who === 'view link', tool = who === 'tool';
  const headers = tool ? { host: 'localhost' } : { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(link ? {} : { cookie: 'lm_session=x' }) };
  const req = Object.assign(Readable.from([JSON.stringify(tool ? { by: 'Duy', ...a } : a)]), { method: 'POST', url: link ? `/api/act?share=${TOKEN}` : '/api/act', headers });
  let status = 0, text = '';
  const res = { writeHead(/** @type {number} */ s) { status = s; return res; }, end(/** @type {string} */ t = '') { text = t; return res; }, setHeader() {}, write() {}, on() {} };
  await map.handle(req, res, '/api/act', /** @type {any} */ (link || tool ? null : who));
  /** @type {any} */ let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* a reply that is not JSON is read by its status alone */ }
  return { status, body };
}

/**
 * A read from the map's API, as `who` (a signed-in person by name): its status and what it sent, whole or written
 * in parts (a server-sent stream ends its first message there).
 * @param {ReturnType<typeof openMap>} map @param {Sender} who @param {string} p
 */
export async function read(map, who, p) {
  const req = Object.assign(Readable.from([]), { method: 'GET', url: p, headers: { host: 'localhost', cookie: 'lm_session=x' }, on() {} });
  let status = 0, text = '';
  const res = { writeHead(/** @type {number} */ s) { status = s; return res; }, end(/** @type {string} */ t = '') { text += String(t); return res; }, write(/** @type {string} */ t) { text += t; return true; }, setHeader() {}, on() {} };
  await map.handle(req, res, p, /** @type {any} */ (who));
  return { status, text };
}

/**
 * A fresh map from `initial`, sent `a` (or each of a list of steps, stopping at the first that is refused), then
 * closed: the last status, and the map as it was after.
 * @param {Sender} who @param {any} a @param {any} initial
 */
export async function act(who, a, initial) {
  const { map, close } = openTestMap(initial);
  let answer = { status: 0, body: /** @type {any} */ (null) };
  for (const step of Array.isArray(a) ? a : [a]) {
    answer = await send(map, who, step);
    if (answer.status !== 200) break;
  }
  const after = /** @type {any} */ (map.snapshot());
  close();
  return { ...answer, after };
}
