import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { expect, it } from 'vitest';

import { openMap } from './server.js';

// A chat knows the map's go-ahead only by the words chat-rules.md tells it to look for, so the message Build the
// plan sends must start the way that rule quotes it.
it('the message Build the plan sends is the one the chat rules describe', async () => {
  const rules = fs.readFileSync(new URL('./chat-rules.md', import.meta.url), 'utf8');
  const quoted = /** @type {RegExpMatchArray} */ (rules.match(/`<Name> (pressed [^:`]+):/))[1];
  expect(quoted).toBe('pressed Build the plan');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-rules-'));
  const map = openMap({ name: 'rules', home, memory: true, initialState: {
    title: 'Launch', prompt: 'Add billing', people: [{ id: 'Ana', role: 'Admin', sees: 'all' }], calls: [], threads: {}, log: [], nodes: [], edges: [] } });
  const req = Object.assign(Readable.from([JSON.stringify({ type: 'execute' })]), { method: 'POST', url: '/api/act', headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie: 'lm_session=x' } });
  let status = 0;
  const res = { writeHead(/** @type {number} */ s) { status = s; return res; }, end() { return res; }, setHeader() {}, write() {}, on() {} };
  await map.handle(req, res, '/api/act', /** @type {any} */ ('Ana'));
  expect(status).toBe(200);
  expect(map.snapshot().forChats?.at(-1)?.text).toMatch(new RegExp(`^Ana ${quoted}: `));
  map.close(); fs.rmSync(home, { recursive: true, force: true });
});
