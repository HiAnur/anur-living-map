// Living Map, live demo: one shared story state on a tiny server, so every open
// window (you, Priyanka, Duy) sees the same map and a click in one moves them all.
// No dependencies: node server.js [port]
//
//   GET  /              the map page (index.html)
//   GET  /api/state     {step, me?, log:[{at, who, action, step}]}
//   GET  /api/events    server-sent events: the state after every change
//   POST /api/act       {type, by}  type: next | back | goto(step) | reset |
//                       dispute | confirm | approve | flag  (a click on the map)
//
// Every act is appended to state.json and, when it is a person's call, to
// outbox.md in plain words, which a Claude Code chat can read back:
//   curl -s localhost:4322/api/outbox

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.argv[2] || process.env.PORT || 4322);
const DIR = import.meta.dirname;
const STATE = path.join(DIR, 'state.json');
const OUTBOX = path.join(DIR, 'outbox.md');
const seed = JSON.parse(fs.readFileSync(path.join(DIR, 'seed.json'), 'utf8'));
const LAST = seed.last;

let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { step: seed.step, log: [] };
const clients = new Set();
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
const push = () => { const d = `data: ${JSON.stringify(state)}\n\n`; for (const r of clients) r.write(d); };
const tell = (text) => fs.appendFileSync(OUTBOX, `- ${new Date().toISOString().slice(11, 16)} ${text}\n`);

// what a click on the map does to the story, and what the chat hears
const ACTS = {
  next:    (s) => ({ step: s.step >= LAST ? 0 : s.step + 1 }),
  back:    (s) => ({ step: Math.max(0, s.step - 1) }),
  goto:    (s, a) => ({ step: Math.min(LAST, Math.max(0, Number(a.step) || 0)) }),
  reset:   () => ({ step: 0, clear: true }),
  dispute: (s, a) => ({ step: 3, tell: `${a.by} disputed "retire the renewal job": annual customers keep renewing through our job; new and upgraded customers bill through the provider.` }),
  confirm: (s, a) => ({ step: s.step, tell: `${a.by} confirmed "${a.what || 'the call'}".` }),
  approve: (s, a) => ({ step: 6, tell: `${a.by} approved the plan for ACME-212. Build it.` }),
  flag:    (s, a) => ({ step: 8, tell: `${a.by} flagged #219 to Sam: it deletes the renewal job we agreed to keep.` }),
};

function act(a) {
  const f = ACTS[a.type];
  if (!f) return false;
  const r = f(state, a);
  if (r.clear) { state = { step: 0, log: [] }; try { fs.unlinkSync(OUTBOX); } catch {} }
  else {
    state.step = r.step;
    state.log.push({ at: Date.now(), who: a.by || 'You', action: a.type, step: r.step });
    if (r.tell) tell(r.tell);
  }
  save(); push();
  return true;
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.css': 'text/css', '.svg': 'image/svg+xml' };
const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/state') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state));
  if (url.pathname === '/api/outbox') return res.writeHead(200, { 'content-type': 'text/plain' }).end(fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8') : '');
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res); req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/act' && req.method === 'POST') {
    let a = {};
    try { a = JSON.parse(await body(req)); } catch {}
    const ok = act(a);
    return res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(ok ? state : { error: 'unknown act' }));
  }
  // the page and its files
  const file = path.join(DIR, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('not here');
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`Living Map live demo on http://localhost:${PORT}  (step ${state.step})`));
