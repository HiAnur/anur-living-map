import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { openTestMap, send } from './map.harness.js';
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

// The rules ask only what the map can hold a chat to: a change asked for from the pane comes as a proposal, which the
// map enforces below, and nothing asks the chat to copy rules it cannot be checked on into a box's notes.
it('the rules say what the map enforces about the pane, and ask nothing it cannot check', () => {
  const rules = fs.readFileSync(new URL('./chat-rules.md', import.meta.url), 'utf8');
  expect(rules).toMatch(/what you draw with `living_map_change` into a proposal/);
  expect(rules).not.toMatch(/every rule/i);
});

// While a chat answers a request from the map's pane, from when its listener takes the request until it listens
// again, what it draws directly (living_map_change sends an edit naming its chat) arrives as a proposal for the
// chat's owner, blue on the map with Apply. Any other chat, and the same chat once it listens again, draws as before.
describe('a change drawn while answering the pane', () => {
  const initial = () => ({ title: 'Launch', people: [{ id: 'Ana', role: 'Admin', sees: 'all' }], linked: [{ session: 's1', file: '/no/such.jsonl', owner: 'Ana', at: 1 }],
    nodes: [{ id: 'root', label: 'Launch', sub: 'The pilot', x: 0, y: 0 }], edges: [], calls: [], threads: {}, log: [] });
  /** @param {string} id @param {string} [session] */
  const edit = (id, session = 's1') => ({ type: 'edit', by: 'Claude', session, note: `add ${id}`,
    nodes: [{ id, label: id[0].toUpperCase() + id.slice(1), sub: 'Asked for' }], edges: [{ from: 'root', to: id }],
    calls: [{ id: `q-${id}`, node: 'root', for: 'Ana', from: 'Claude', status: 'open', ask: 'Ship it?', text: 'Ship it?' }] });
  /** The chat's listener asking for what is meant for it: what it was handed, and how to hang up. @param {any} map */
  const listen = async (map) => {
    let text = '', /** @type {() => void} */ hangUp = () => {};
    const req = Object.assign(Readable.from([]), { method: 'GET', url: '/api/wait?session=s1', headers: { host: 'localhost' } });
    const res = { writeHead() { return res; }, end(/** @type {string} */ t = '') { text += t; return res; }, setHeader() {}, write() {},
      on(/** @type {string} */ ev, /** @type {() => void} */ f) { if (ev === 'close') hangUp = f; } };
    await map.handle(req, res, '/api/wait', null);
    return { text: () => text, hangUp: () => hangUp() };
  };

  it('is held as a proposal until the chat listens again', async () => {
    const { map, close } = openTestMap(initial());
    try {
      const boxes = () => map.snapshot().nodes.map((/** @type {any} */ n) => n.id);
      expect((await send(map, 'tool', edit('before'))).status).toBe(200);
      expect(boxes()).toContain('before');

      expect((await send(map, 'Ana', { type: 'say', text: 'Add pricing' })).status).toBe(200);
      const handed = await listen(map);
      expect(handed.text()).toContain('Ana wrote in the map\'s chat: "Add pricing"');

      const asked = await send(map, 'tool', edit('pricing'));
      expect(asked.status).toBe(200);
      expect(asked.body).toMatchObject({ proposed: expect.any(String), ops: ['Add the box Pricing (Asked for)', 'Add a line Launch → Pricing'] });
      expect(asked.body.dropped).toEqual([{ text: 'the question "Ship it?"', why: 'ask it once the change is applied' }]);
      expect(boxes()).not.toContain('pricing');
      expect(map.snapshot().calls.map((/** @type {any} */ c) => c.ask)).toEqual(['Ship it?']);
      const proposal = map.snapshot().proposals.at(-1);
      expect(proposal).toMatchObject({ id: asked.body.proposed, session: 's1', status: 'pending', note: 'add pricing' });

      // another chat on the map is answering nothing from the pane: it draws as before
      expect((await send(map, 'tool', edit('other', 's2'))).status).toBe(200);
      expect(boxes()).toContain('other');

      // the owner's Apply draws the proposal
      expect((await send(map, 'Ana', { type: 'apply', proposal: proposal.id })).status).toBe(200);
      expect(boxes()).toContain('pricing');

      // listening again, the chat has answered: what it draws next lands at once
      const again = await listen(map);
      expect((await send(map, 'tool', edit('after'))).status).toBe(200);
      expect(boxes()).toContain('after');
      again.hangUp();
    } finally { close(); }
  });
  it('says why when nothing in it could be proposed', async () => {
    const { map, close } = openTestMap(initial());
    try {
      await send(map, 'Ana', { type: 'say', text: 'Ask Ana' });
      await listen(map);
      const only = await send(map, 'tool', { type: 'edit', by: 'Claude', session: 's1', calls: edit('x').calls });
      expect(only.status).toBe(400);
      expect(only.body.error).toContain('a question waits until one is applied');
      expect(map.snapshot().calls).toEqual([]);
    } finally { close(); }
  });
  it('takes no word for it from the change itself', async () => {
    const { map, close } = openTestMap(initial());
    try {
      const sent = await send(map, 'tool', { ...edit('plain', 's2'), proposed: { id: 'fake' }, refused: 'no' });
      expect(sent).toEqual({ status: 200, body: {} });
    } finally { close(); }
  });
});
