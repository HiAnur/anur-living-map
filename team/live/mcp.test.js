import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// The tools server as Claude Code runs it: a process spoken to in JSON lines. It answers without a map server
// for everything asked here.
/** @type {import('node:child_process').ChildProcess[]} */
const started = [];
afterEach(() => { for (const p of started.splice(0)) p.kill(); });

function server(url = 'http://127.0.0.1:9', file = new URL('./mcp.js', import.meta.url).pathname) {
  const proc = spawn(process.execPath, [file], { env: { ...process.env, LIVING_MAP_URL: url }, stdio: ['pipe', 'pipe', 'ignore'] });
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
  it('starts, names itself and lists its four tools', async () => {
    const s = server();
    expect((await s.ask('initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name).toBe('living-map');
    const { tools } = (await s.ask('tools/list')).result;
    expect(tools.map((t) => t.name)).toEqual(['living_map_catalog', 'living_map_load', 'living_map_read', 'living_map_change']);
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
