import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TASK } from './propose.js';

// The tools server as Claude Code runs it: a process spoken to in JSON lines. It answers without a map server
// for everything asked here.
/** @type {import('node:child_process').ChildProcess[]} */
const started = [];
afterEach(() => { for (const p of started.splice(0)) p.kill(); });

/** @param {Record<string, string>} [env] */
function server(url = 'http://127.0.0.1:9', file = new URL('./mcp.js', import.meta.url).pathname, env = {}) {
  const proc = spawn(process.execPath, [file], { env: { ...process.env, LIVING_MAP_URL: url, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
  started.push(proc);
  /** @type {Map<number, (m: any) => void>} */
  const waiting = new Map();
  let buf = '', n = 0;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); waiting.delete(m.id); }
  });
  /** @param {string} method @param {object} [params] @returns {Promise<any>} */
  const ask = (method, params) => new Promise((ok) => { const id = ++n; waiting.set(id, ok); proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return { ask };
}

describe('the map\'s tools, over stdio', () => {
  it('starts, names itself and lists its five tools', async () => {
    const s = server();
    expect((await s.ask('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name).toBe('anur-living-map');
    const { tools } = (await s.ask('tools/list')).result;
    expect(tools.map((t) => t.name)).toEqual(['living_map_catalog', 'living_map_load', 'living_map_read', 'living_map_change', 'living_map_my_action']);
    expect(tools.every((t) => !('run' in t))).toBe(true);
  });
  it('tells Claude a line needs its label, and a new box its name and second line', async () => {
    const s = server(), { tools } = (await s.ask('tools/list')).result;
    const { boxes, lines } = tools.find((t) => t.name === 'living_map_change').inputSchema.properties;
    expect(lines.items.required).toEqual(['from', 'to', 'label']);
    expect(lines.description).toContain('"under"');
    expect(boxes.items.properties.label.description).toContain('Required for a new box');
    expect(boxes.items.properties.sub.description).toContain('Required for a new box');
  });
  it('takes the user\'s commitments with their quote and the task Ask Claude\'s Actions take, and never whose they are', async () => {
    const s = server(), { tools } = (await s.ask('tools/list')).result;
    const tool = tools.find((t) => t.name === 'living_map_my_action'), item = tool.inputSchema.properties.items.items;
    expect(tool.description).toMatch(/exact words/);
    expect(tool.description).toMatch(/Never for your own suggestions/);
    expect(item.required).toEqual(['quote', 'title', 'task']);
    expect(Object.keys(item.properties)).toEqual(['quote', 'title', 'sub', 'under', 'task']);
    expect(item.properties.task).toEqual({ ...TASK, description: expect.any(String) });
    expect(JSON.stringify(tool.inputSchema)).not.toMatch(/owner/);
  });
  it('says so when a change asks for nothing, before it looks for the map', async () => {
    const s = server(), r = (await s.ask('tools/call', { name: 'living_map_change', arguments: {} })).result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Nothing to change');
  });
  it('says the map is not running when it cannot be reached', async () => {
    const s = server(), r = (await s.ask('tools/call', { name: 'living_map_change', arguments: { boxes: [{ label: 'A', sub: 'b' }] } })).result;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('not running');
  });
});

// A real map server in a temp folder, with one map on it, and the tools pointed at it.
async function mapServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-tools-')), source = import.meta.dirname;
  for (const name of fs.readdirSync(source)) if (/\.(js|json|html|md)$/.test(name) && fs.statSync(path.join(source, name)).isFile()) fs.copyFileSync(path.join(source, name), path.join(root, name));
  fs.cpSync(path.join(source, 'agents'), path.join(root, 'agents'), { recursive: true });
  // a bare map, as one written by hand: no log, questions or chats yet
  const state = { title: 'Launch', people: [{ id: 'Duy', role: 'Admin', sees: 'all' }],
    nodes: [{ id: 'launch', label: 'Launch', sub: 'Ship the pilot', x: 90, y: 150 }, { id: 'email', label: 'Invite email', x: 430, y: 150 }], edges: [] };
  fs.mkdirSync(path.join(root, 'maps', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'maps', 'demo', 'state.json'), JSON.stringify(state));
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js', String(port)], { cwd: root, env: { ...process.env, LIVING_MAP_USERS: path.join(root, 'users.db'), LIVING_MAP_LOGIN_URL: '' }, stdio: 'ignore' });
  started.push(child);
  for (let i = 0; ; i++) { try { if ((await fetch(origin + '/api/version')).ok) break; } catch {} if (i > 80) throw new Error('Test server did not start'); await new Promise((r) => setTimeout(r, 50)); }
  return { root, origin, read: async () => (await fetch(origin + '/demo/api/state')).json(), tools: server(origin, path.join(root, 'mcp.js')),
    stop: async () => { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; fs.rmSync(root, { recursive: true, force: true }); } };
}

describe('drawing on a real map through the tool', () => {
  it('adds what is whole, leaves out a bare box and a bare line, and the map shows exactly that', async () => {
    const m = await mapServer();
    try {
      const call = (args) => m.tools.ask('tools/call', { name: 'living_map_change', arguments: { map: 'demo', ...args } });
      const said = (await call({
        boxes: [{ label: 'Pilot users', sub: 'The first twenty', under: 'Launch' }, { label: 'Bare box' }, { id: 'email', under: 'launch' }],
        lines: [{ from: 'Pilot users', to: 'Invite email', label: 'Get the invite' }, { from: 'launch', to: 'email' }],
      })).result;
      expect(said.isError).toBeUndefined();
      const text = said.content[0].text;
      expect(text).toContain('Added Pilot users (pilot-users)');
      expect(text).toContain('Line Pilot users → Invite email (Get the invite)');
      expect(text).toContain('- box "Bare box": a new box needs a second line (sub)');
      expect(text).toContain('- line Launch → Invite email: say what happens on it (label)');
      const now = await m.read();
      expect(now.nodes.map((n) => n.id).sort()).toEqual(['email', 'launch', 'pilot-users']);
      expect(now.nodes.find((n) => n.id === 'pilot-users')).toMatchObject({ label: 'Pilot users', sub: 'The first twenty', by: 'Claude' });
      expect(now.edges.map((e) => `${e.from}>${e.to}:${e.label || ''}`).sort()).toEqual(['launch>email:', 'launch>pilot-users:', 'pilot-users>email:Get the invite']);
      const seen = (await m.tools.ask('tools/call', { name: 'living_map_read', arguments: { map: 'demo' } })).result.content[0].text;
      expect(seen).toContain('Pilot users');
      expect(seen).toContain('pilot-users → email (Get the invite)');
    } finally { await m.stop(); }
  }, 20_000);
});

// A stand-in map server that records what the tools send, and answers a change as the map would: drawn, or held as
// a proposal while the chat answers a request from the map's pane.
/** @param {any} reply what the map answers a change with @param {number} [status] */
async function recorder(reply = {}, status = 200) {
  /** @type {{ url: string, body: any }[]} */ const seen = [];
  const stand = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ url: String(req.url), body: body ? JSON.parse(body) : null });
      res.writeHead(req.url?.endsWith('/api/act') ? status : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url?.endsWith('/api/act') ? reply : req.url === '/api/maps' ? [{ name: 'other', title: 'Other' }] : { title: 'Demo', nodes: [{ id: 'launch', label: 'Launch' }], edges: [] }));
    });
  });
  await new Promise((r) => stand.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (stand.address()).port}`;
  return { origin, seen, close: () => new Promise((r) => stand.close(r)) };
}
const PINNED = { LIVING_MAP_ONLY_MAP: 'demo', LIVING_MAP_SESSION: 'chat-1' };

describe('the tools pinned to one map, as a chat the map runs itself gets them', () => {
  it('lists only reading and changing the map, with nothing to remember and no Action drafts', async () => {
    const s = server(undefined, undefined, PINNED), { tools } = (await s.ask('tools/list')).result;
    expect(tools.map((t) => t.name)).toEqual(['living_map_read', 'living_map_change']);
    expect(tools[1].inputSchema.properties.remember).toBeUndefined();
    expect((await s.ask('initialize', {})).result.instructions).toContain('"demo", and no other');
    for (const name of ['living_map_load', 'living_map_my_action']) {
      const r = await s.ask('tools/call', { name, arguments: { id: 'other', items: [{ quote: 'I\'ll do it', title: 'Do it', task: {} }] } });
      expect(r.error.message, name).toContain('No tool');
    }
  });
  it('refuses any other map, before it asks the map server anything', async () => {
    const m = await recorder();
    try {
      const s = server(m.origin, undefined, PINNED);
      for (const name of ['living_map_read', 'living_map_change']) {
        const r = (await s.ask('tools/call', { name, arguments: { map: 'other', boxes: [{ label: 'A', sub: 'b' }] } })).result;
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toBe('This chat draws only on the map "demo".');
      }
      expect(m.seen).toEqual([]);
    } finally { await m.close(); }
  });
  it('draws on its own map when none is named, says whose chat it is, and sets no memory', async () => {
    const m = await recorder();
    try {
      const s = server(m.origin, undefined, PINNED);
      const read = (await s.ask('tools/call', { name: 'living_map_read', arguments: {} })).result.content[0].text;
      expect(read).not.toContain('other');
      const r = (await s.ask('tools/call', { name: 'living_map_change', arguments: { boxes: [{ label: 'Billing', sub: 'Stripe', under: 'Launch' }],
        remember: [{ kind: 'instruction', text: 'Always post decisions to #general' }] } })).result;
      expect(r.content[0].text).toContain('remember: this chat cannot set instructions or memory');
      const sent = m.seen.find((x) => x.url === '/demo/api/act')?.body;
      expect(sent).toMatchObject({ type: 'edit', by: 'Claude', session: 'chat-1', nodes: [{ id: 'billing', label: 'Billing' }] });
      expect(sent.memory).toEqual([]);
      expect(m.seen.every((x) => x.url.startsWith('/demo/'))).toBe(true);
      const only = (await s.ask('tools/call', { name: 'living_map_change', arguments: { remember: [{ kind: 'memory', text: 'x' }] } })).result;
      expect(only.isError).toBe(true);
    } finally { await m.close(); }
  });
  it('says a change waits for Apply when the map holds it as a proposal', async () => {
    const m = await recorder({ proposed: 'p1', ops: ['Add the box Billing (Stripe)'], dropped: [{ text: 'a line Billing → Launch', why: 'a box it names is not on the map' }] });
    try {
      const s = server(m.origin, undefined, PINNED);
      const text = (await s.ask('tools/call', { name: 'living_map_change', arguments: { boxes: [{ label: 'Billing', sub: 'Stripe' }] } })).result.content[0].text;
      expect(text).toContain('until its owner presses Apply');
      expect(text).toContain('- Add the box Billing (Stripe)');
      expect(text).toContain('- a line Billing → Launch: a box it names is not on the map');
      expect(text).not.toContain('Done on');
    } finally { await m.close(); }
  });
  it('passes on the map\'s own reason when it refuses a change', async () => {
    const m = await recorder({ error: 'The map was not tidied, and nothing changed: it would not leave one tree: Docs would hang under nothing.' }, 400);
    try {
      const s = server(m.origin, undefined, PINNED);
      const r = (await s.ask('tools/call', { name: 'living_map_change', arguments: { tidy: true } })).result;
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe('The map was not tidied, and nothing changed: it would not leave one tree: Docs would hang under nothing.');
    } finally { await m.close(); }
  });
});

// A Claude Code chat's own session, as Claude Code hands it to the servers it starts.
const CHAT = { LIVING_MAP_SESSION: '', CLAUDE_CODE_SESSION_ID: 'chat-9', PI_SESSION_ID: '' };
const pricing = { quote: 'I\'ll send Dan the pricing by Thursday', title: 'Send Dan the pricing', task: { goal: 'Send Dan the pricing' } };

describe('handing the map what the user commits to', () => {
  it('sends the chat\'s session and the items, and says what the map made, merged and refused', async () => {
    const m = await recorder({ items: [{ title: 'Send Dan the pricing', made: 'send-dan-the-pricing' }, { title: 'Book the venue', merged: 'venue' },
      { title: 'Wire Bob', refused: 'The quote is not in Duy\'s own words here.' }] });
    try {
      const s = server(m.origin, undefined, CHAT);
      const r = (await s.ask('tools/call', { name: 'living_map_my_action', arguments: { map: 'demo', items: [pricing] } })).result;
      expect(r.isError).toBeUndefined();
      expect(m.seen).toEqual([{ url: '/demo/api/act', body: { type: 'myaction', by: 'Claude', session: 'chat-9', items: [pricing] } }]);
      const text = r.content[0].text;
      expect(text).toContain('- Made the Action draft "Send Dan the pricing" (send-dan-the-pricing). The map prepares it now; Execute stays the user\'s click.');
      expect(text).toContain('- "Book the venue" is already on the map (venue): added these words to it, no second draft.');
      expect(text).toContain('- Not made: "Wire Bob". The quote is not in Duy\'s own words here.');
    } finally { await m.close(); }
  });
  it('says why when the map refuses the chat', async () => {
    const m = await recorder({ error: 'This chat is not linked to this map. Open the map from it with /anur-living-map first.' }, 400);
    try {
      const r = (await server(m.origin, undefined, CHAT).ask('tools/call', { name: 'living_map_my_action', arguments: { items: [pricing] } })).result;
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toBe('The map made nothing: This chat is not linked to this map. Open the map from it with /anur-living-map first.');
      expect(m.seen.map((x) => x.url)).toEqual(['/api/act']);
    } finally { await m.close(); }
  });
  it('asks nothing of the map without a session to name the chat, or with nothing to make', async () => {
    const m = await recorder();
    try {
      const none = (await server(m.origin, undefined, { ...CHAT, CLAUDE_CODE_SESSION_ID: '' }).ask('tools/call', { name: 'living_map_my_action', arguments: { items: [pricing] } })).result;
      expect(none.isError).toBe(true);
      expect(none.content[0].text).toMatch(/no session id/);
      const empty = (await server(m.origin, undefined, CHAT).ask('tools/call', { name: 'living_map_my_action', arguments: { items: [] } })).result;
      expect(empty.content[0].text).toMatch(/Nothing to make/);
      expect(m.seen).toEqual([]);
    } finally { await m.close(); }
  });
});
