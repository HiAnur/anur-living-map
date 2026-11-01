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
//                                       ask {node, text} · cursor {x,y,view} · reset · open
//
// Each address is a map of its own: / is the project's map (also at /<project folder>/),
// and /<name>/ is a map called <name> with the same page and API under it
// (/gtm/api/state, /gtm/api/act). A named map starts empty, keeps its state in
// live/maps/<name>/, and fills from the plans drawn on it.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { placeNew, readProject } from './project.js';

const PORT = Number(process.argv[2] || process.env.PORT || 4322);
const DIR = import.meta.dirname;
// --project <folder>: draw that project from its own files, and keep the map's
// state beside it in <folder>/.living-map/; without it, the fixed demo in seed.json
const at = process.argv.indexOf('--project');
const PROJECT = at > 0 ? path.resolve(process.argv[at + 1]) : process.env.LIVING_MAP_PROJECT || '';
const demo = () => JSON.parse(fs.readFileSync(path.join(DIR, 'seed.json'), 'utf8'));

// one map: its state, the windows following it, and what people can do to it
function openMap({ project = '', name = '', home }) {
  if (project) fs.mkdirSync(home, { recursive: true });
  const STATE = path.join(home, 'state.json');
  const OUTBOX = path.join(home, 'outbox.md');
  const SAVES = path.join(home, 'saves');
  const seed = () => {
    if (!project && !name) return demo();
    const { people } = demo();
    const drawn = project ? readProject(project) : { title: name, desc: '', nodes: [], edges: [] };
    return { ...drawn, ticket: '', prompt: '', people, calls: [], prs: [], answers: { '*': 'I drew what I know on the map. Click a box for its files, or ask me about one.' } };
  };

  const fresh = () => ({ ...seed(), log: [], threads: {}, comments: [] });
  let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : fresh();
  const clients = new Set();
  const cursors = {}; // by name: {x, y, view, at}; never saved

  // a named map gets its folder the first time something is written to it
  const save = () => { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); };
  const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const push = () => { for (const r of clients) send(r, 'state', state); };
  const tell = (text) => { fs.mkdirSync(home, { recursive: true }); fs.appendFileSync(OUTBOX, `- ${new Date().toTimeString().slice(0, 5)} ${text}\n`); };
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
      // asking to see a flow opens it; the page does the drawing
      const n = nodeOf(a.node), hasFlow = n && (n.flow || n.inside?.nodes?.some((x) => x.flow));
      const answer = hasFlow && /flow|visuali|diagram|draw|sequence/i.test(a.text)
        ? 'Drew the payment flow on the map: the upgrade, Payment confirmed, and where an annual customer gets billed twice.'
        : state.answers[a.node] || state.answers['*'];
      t.push({ who: 'Claude', text: answer, at: stamp(), staged: true });
      state.log.push({ at: Date.now(), who: a.by, action: 'asked', node: a.node, text: a.text });
      return true;
    },
    // starting over keeps the saved maps and the list of sessions that drew on it
    reset() { const keep = { saves: state.saves || [], sessions: state.sessions || [] }; state = { ...fresh(), ...keep }; try { fs.unlinkSync(OUTBOX); } catch {} return true; },
    // a saved map is a copy of the whole map as it is now, kept in saves/<id>.json; the list lives in the map
    save(a) {
      const id = Date.now().toString(36), { saves = [], sessions = [], ...snap } = state;
      fs.mkdirSync(SAVES, { recursive: true });
      fs.writeFileSync(path.join(SAVES, `${id}.json`), JSON.stringify(snap));
      const name = String(a.name || '').trim().slice(0, 80) || `${state.ticket || state.title} · ${stamp()}`;
      state.saves = [{ id, name, by: a.by, at: Date.now(), boxes: snap.nodes.length, open: snap.calls.filter((c) => c.status === 'open').length }, ...saves];
      return true;
    },
    // deleting a saved map drops it from the list and removes its file
    unsave(a) {
      const id = String(a.id).replace(/[^\w]/g, '');
      if (!(state.saves || []).some((s) => s.id === id)) return false;
      state.saves = state.saves.filter((s) => s.id !== id);
      try { fs.unlinkSync(path.join(SAVES, `${id}.json`)); } catch {}
      return true;
    },
    // opening a saved map makes it the map everyone sees; the list and the sessions stay
    load(a) {
      const file = path.join(SAVES, `${String(a.id).replace(/[^\w]/g, '')}.json`);
      if (!fs.existsSync(file)) return false;
      const keep = { saves: state.saves || [], sessions: state.sessions || [] };
      state = { ...JSON.parse(fs.readFileSync(file, 'utf8')), ...keep };
      return true;
    },
    // a chat opening the map: the newest saved map if this folder has one, else a fresh map from the code
    open() {
      const last = (state.saves || []).find((s) => fs.existsSync(path.join(SAVES, `${s.id}.json`)));
      return last ? ACTS.load({ id: last.id }) : ACTS.reset();
    },
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
      // a new box with no place goes where its lines cross nothing
      placeNew(state.nodes, state.edges);
      merge(state.calls, (c) => c.id, a.calls);
      Object.assign(state.answers, a.answers || {});
      // the ask behind the plan shows on the map's top line; a named map takes the plan's title
      if (a.title && name) state.title = String(a.title).slice(0, 60);
      if (a.ticket) state.ticket = String(a.ticket).slice(0, 40);
      if (a.prompt) state.prompt = String(a.prompt).slice(0, 300);
      for (const id of a.remove || []) state.nodes = state.nodes.filter((n) => n.id !== id);
      state.log.push({ at: Date.now(), who: a.by, action: 'drew', text: a.note || `${(a.nodes || []).length} boxes, ${(a.calls || []).length} calls` });
      // each plan an agent draws is one session in the map's list
      state.sessions = [{ id: Date.now().toString(36), agent: a.by, chat: String(a.session || '').slice(0, 80), ticket: state.ticket, prompt: state.prompt,
        note: a.note || '', at: Date.now(), boxes: (a.nodes || []).length, calls: (a.calls || []).length }, ...(state.sessions || [])];
      tell(`${a.by} drew on the map: ${a.note || 'a plan'}`);
      return true;
    },
  };

  // the map's API, at <map address>/api/...; false when the path is not one of them
  async function handle(req, res, p) {
    if (p === '/api/state') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state)); return true; }
    if (p === '/api/outbox') { res.writeHead(200, { 'content-type': 'text/plain' }).end(fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8') : ''); return true; }
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      send(res, 'state', state); send(res, 'cursors', cursors);
      clients.add(res); req.on('close', () => clients.delete(res));
      return true;
    }
    if (p === '/api/act' && req.method === 'POST') {
      let a = {};
      try { a = JSON.parse(await body(req)); } catch {}
      a.by = String(a.by || 'You').slice(0, 40);
      if (a.type === 'cursor') { // ephemeral: where each person's pointer is, in map coordinates
        if (a.x === null) delete cursors[a.by]; else cursors[a.by] = { x: a.x, y: a.y, view: a.view, at: Date.now() };
        for (const r of clients) send(r, 'cursors', cursors);
        res.writeHead(200).end('{}');
        return true;
      }
      const ok = !!ACTS[a.type]?.(a);
      if (ok) { save(); push(); }
      res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' }).end(ok ? '{}' : '{"error":"no"}');
      return true;
    }
    return false;
  }

  return { handle };
}

const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.css': 'text/css', '.svg': 'image/svg+xml' };

const main = openMap({ project: PROJECT, home: PROJECT ? path.join(PROJECT, '.living-map') : DIR });
const named = new Map();
const mapCalled = (name) => named.get(name) ?? named.set(name, openMap({ name, home: path.join(DIR, 'maps', name) })).get(name);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // /<name>/... is the map called <name>, unless a file of the page has that name
  const [, first, rest] = url.pathname.match(/^\/([^/]*)(.*)$/);
  const own = PROJECT && first === path.basename(PROJECT);
  const isMap = /^[a-z0-9-]+$/.test(first) && first !== 'api' && (own || !fs.existsSync(path.join(DIR, first)));
  // the page asks its API by relative address, so a map's address ends in a slash
  if (isMap && !rest) return res.writeHead(302, { location: `/${first}/${url.search}` }).end();
  const map = !isMap || own ? main : mapCalled(first);
  const p = isMap ? rest : url.pathname;
  if (await map.handle(req, res, p)) return;
  const file = path.join(DIR, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('not here');
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`Living Map on http://localhost:${PORT}${PROJECT ? `  (${PROJECT})` : '  (demo)'}`));
