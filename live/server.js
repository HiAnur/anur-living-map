// Living Map, live demo: one shared map on a tiny server. Every open window
// (you, Priyanka, Duy, Sam) sees the same map; a drag, a Confirm or a Dispute
// in one window reaches the others at once. No dependencies.
//
//   node server.js [port]              default 4322
//   GET  /                              the map page
//   GET  /api/state                     the whole map (seed + what people did)
//   GET  /api/events                    server-sent events: state after every change
//   GET  /api/outbox                    what the chat hears, plain words
//   POST /api/act  {type, by, ...}      move {id,x,y} · call {id, answer: confirm|dispute}
//                                       ask {node, text} · cursor {x,y,view} · reset

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.argv[2] || process.env.PORT || 4322);
const DIR = import.meta.dirname;
const STATE = path.join(DIR, 'state.json');
const OUTBOX = path.join(DIR, 'outbox.md');
const seed = () => JSON.parse(fs.readFileSync(path.join(DIR, 'seed.json'), 'utf8'));

const fresh = () => ({ ...seed(), log: [], threads: {}, comments: [] });
let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : fresh();
const clients = new Set();
const cursors = {}; // by name: {x, y, view, at}; never saved

const save = () => fs.writeFileSync(STATE, JSON.stringify(state));
const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
const push = () => { for (const r of clients) send(r, 'state', state); };
const tell = (text) => fs.appendFileSync(OUTBOX, `- ${new Date().toTimeString().slice(0, 5)} ${text}\n`);
const stamp = () => new Date().toTimeString().slice(0, 5);

const allNodes = () => state.nodes.flatMap((n) => [n, ...(n.inside?.nodes ?? [])]);
const allEdges = () => state.edges.concat(state.nodes.flatMap((n) => n.inside?.edges ?? []));
const nodeOf = (id) => allNodes().find((n) => n.id === id);

// what a person's answer does to the map, from the call's own seed
function answerCall(a) {
  const c = state.calls.find((x) => x.id === a.id);
  if (!c || c.status !== 'open') return false;
  const fx = c[a.answer] || {};
  c.status = a.answer === 'confirm' ? 'confirmed' : 'disputed';
  c.by = a.by; c.at = stamp(); c.said = fx.says || '';
  const n = fx.node && nodeOf(fx.node);
  if (n) {
    if (fx.state !== undefined) n.state = fx.state;
    if (fx.sub !== undefined) n.sub = fx.sub;
    n.decided = { who: a.by, at: c.at, what: fx.sub || c.status, call: c.id };
  }
  if (fx.edge) { const [f, t] = fx.edge.split('>'); const e = allEdges().find((x) => x.from === f && x.to === t); if (e) e.state = fx.edgeState || ''; }
  state.log.push({ at: Date.now(), who: a.by, action: c.status, call: c.id, node: c.node, text: c.text, said: c.said });
  tell(`${a.by} ${c.status} "${c.text}"${fx.says ? ` — ${fx.says}` : ''}${fx.chat ? `\n  Claude: ${fx.chat}` : ''}`);
  return true;
}

const ACTS = {
  move(a) { const n = nodeOf(a.id); if (!n) return false; n.x = Math.round(a.x); n.y = Math.round(a.y); return true; },
  call: answerCall,
  ask(a) {
    const t = (state.threads[a.node] ??= []);
    t.push({ who: a.by, text: String(a.text).slice(0, 400), at: stamp() });
    t.push({ who: 'Claude', text: state.answers[a.node] || state.answers['*'], at: stamp(), staged: true });
    state.log.push({ at: Date.now(), who: a.by, action: 'asked', node: a.node, text: a.text });
    return true;
  },
  reset() { state = fresh(); try { fs.unlinkSync(OUTBOX); } catch {} return true; },
  // Figma-style comments: a pin at a point on the map (or on a box), a thread of replies, resolvable
  comment(a) {
    const text = String(a.text || '').trim().slice(0, 600); if (!text) return false;
    state.comments ??= [];
    const c = { id: state.comments.length + 1, x: Math.round(a.x), y: Math.round(a.y), view: a.view || 'system', node: a.node || null,
      resolved: false, msgs: [{ who: a.by, text, at: Date.now() }] };
    state.comments.push(c);
    tell(`${a.by} commented${c.node ? ` on ${nodeOf(c.node)?.label || c.node}` : ''}: ${text}`);
    return true;
  },
  reply(a) {
    const c = state.comments?.find((x) => x.id === Number(a.id)); const text = String(a.text || '').trim().slice(0, 600);
    if (!c || !text) return false;
    c.msgs.push({ who: a.by, text, at: Date.now() });
    tell(`${a.by} replied on comment #${c.id}: ${text}`);
    return true;
  },
  resolve(a) { const c = state.comments?.find((x) => x.id === Number(a.id)); if (!c) return false; c.resolved = !c.resolved; return true; },
  // an agent draws its plan: boxes, lines and calls are added or updated by id,
  // so Claude Code (or Codex) can put "Billing" on the map from a chat
  plan(a) {
    const merge = (list, key, items = []) => {
      for (const it of items) {
        const k = key(it), had = list.find((x) => key(x) === k);
        if (had) Object.assign(had, it); else list.push(it);
      }
    };
    merge(state.nodes, (n) => n.id, a.nodes);
    merge(state.edges, (e) => `${e.from}>${e.to}`, a.edges);
    merge(state.calls, (c) => c.id, a.calls);
    Object.assign(state.answers, a.answers || {});
    for (const id of a.remove || []) state.nodes = state.nodes.filter((n) => n.id !== id);
    state.log.push({ at: Date.now(), who: a.by, action: 'drew', text: a.note || `${(a.nodes || []).length} boxes, ${(a.calls || []).length} calls` });
    tell(`${a.by} drew on the map: ${a.note || 'a plan'}`);
    return true;
  },
};

const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.css': 'text/css', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/state') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state));
  if (url.pathname === '/api/outbox') return res.writeHead(200, { 'content-type': 'text/plain' }).end(fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8') : '');
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    send(res, 'state', state); send(res, 'cursors', cursors);
    clients.add(res); req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/act' && req.method === 'POST') {
    let a = {};
    try { a = JSON.parse(await body(req)); } catch {}
    a.by = String(a.by || 'You').slice(0, 40);
    if (a.type === 'cursor') { // ephemeral: where each person's pointer is, in map coordinates
      if (a.x === null) delete cursors[a.by]; else cursors[a.by] = { x: a.x, y: a.y, view: a.view, at: Date.now() };
      for (const r of clients) send(r, 'cursors', cursors);
      return res.writeHead(200).end('{}');
    }
    const ok = !!ACTS[a.type]?.(a);
    if (ok) { save(); push(); }
    return res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' }).end(ok ? '{}' : '{"error":"no"}');
  }
  const file = path.join(DIR, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('not here');
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`Living Map live demo on http://localhost:${PORT}`));
