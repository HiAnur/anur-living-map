// Living Map, live demo: one shared map on a tiny server. Every open window
// (you, Priyanka, Duy, Sam) sees the same map; a drag, a Confirm or a Dispute
// in one window reaches the others at once. No dependencies.
//
//   node server.js [port]              default 4322
//   GET  /                              the map page
//   GET  /api/state                     the whole map (seed + what people did)
//   GET  /api/events                    server-sent events: state after every change
//   GET  /api/outbox                    what the chat hears, plain words
//   GET  /api/rules                     how a chat answers the map (chat-rules.md); ?session= marks them as that chat's
//   POST /api/act  {type, by, ...}      move {id,x,y} · call {id, answer: confirm|dispute}
//                                       call {id, option} or {id, other: "own words"} on a call with options
//                                       ask {node, text} · cursor {x,y,view} · reset · open
//
// Each address is a map of its own: / is the project's map (also at /<project folder>/),
// and /<name>/ is a map called <name> with the same page and API under it
// (/gtm/api/state, /gtm/api/act). A named map starts empty, keeps its state in
// live/maps/<name>/, and fills from the plans drawn on it.

import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { actionBoxes, recoverAction } from './action-box.js';
import { readPlannedTask } from './action-plan.js';
import { completionSchema, executionPrompt, readCompletion } from './action-completion.js';
import { agent, chats } from './agent.js';
import { askAgent } from './ask.js';
import { AUTO_PLAN_QUESTION, autoPlanAdditions, autoPlanPrompt } from './auto-plan.js';
import { contextReader, describeMap } from './map-context.js';
import { appendProposed } from './proposal-layout.js';
import { askContext } from './ask-context.js';
import { boxActs } from './box-acts.js';
import { chatActs } from './chat-acts.js';
import { diagramOf } from './diagram.js';
import { mineChat, pendingIn, proposalChecks } from './proposal-check.js';
import { placeNew, readProject, tidy, tidyTree } from './project.js';
import { changeAccess, managesAccess, removedFrom } from './access.js';
import { cloudMirror, installCloudData } from './cloud-client.js';
import { changeSharing, linkRole, LINK_EDITS, localTool, permission, sharedState, withoutActions } from './sharing.js';
import { boxDates, branchIds, editHistory, editSnapshot, reparentTopic } from './editing.js';
import { withDefaults } from './stored.js';

// the port is the first argument when it is a number (`node server.js 4323 --project <repo>`); 4323 is what the skill, mcp.js and wait.js expect
const PORT = Number(/^\d+$/.test(process.argv[2] || '') ? process.argv[2] : process.env.PORT || 4323);
const DIR = import.meta.dirname;
// --project <folder>: draw that project from its own files, and keep the map's
// state beside it in <folder>/.living-map/; without it, the fixed demo in seed.json.
// More code folders join with POST /api/projects {folder}, each at /<folder name>/, and are
// remembered in projects.json so they are still listed after a restart
const at = process.argv.indexOf('--project');
const PROJECT = at > 0 ? path.resolve(process.argv[at + 1]) : process.env.LIVING_MAP_PROJECT || '';
const mapName = (/** @type {any} */ folder) => path.basename(folder).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const PROJECTS = path.join(DIR, 'projects.json');
const demo = () => JSON.parse(fs.readFileSync(path.join(DIR, 'seed.json'), 'utf8'));
// how a chat answers what the map sends it, sent with every message, so a chat that started before an update
// never works from rules the map has outgrown; read each time, so an update reaches chats already running
const chatRules = (/** @type {any} */ base) => { try { return fs.readFileSync(path.join(DIR, 'chat-rules.md'), 'utf8').replaceAll('{{BASE}}', base).trim(); } catch { return ''; } };

// the sides of a box a line can leave or arrive on: top, right, bottom, left
const SIDES = new Set(['t', 'r', 'b', 'l']), sideOf = (/** @type {any} */ v) => SIDES.has(v) ? v : null;
// one map: its state, the windows following it, and what people can do to it
/** @param {any} options */
export function openMap({ project = '', name = '', home, initialState, undoState, memory = false, contextMaps = null }) {
  if (project) fs.mkdirSync(home, { recursive: true });
  let closed = false;
  const STATE = path.join(home, 'state.json');
  const OUTBOX = path.join(home, 'outbox.md');
  const SAVES = path.join(home, 'saves');
  // a team map's people are whoever has signed in on it, from the moment they open it; nobody is listed who
  // never came. The story's seed is only the role book: the role a seated name carries when they join. Everyone
  // sees the whole map; only the story keeps its cast and their areas.
  const roleOf = (/** @type {any} */ id) => demo().people.find((/** @type {any} */ p) => p.id === id)?.role;
  const seed = () => {
    if (!project && !name) return demo();
    const drawn = project ? readProject(project) : { title: name, desc: '', nodes: [], edges: [] };
    return { ...drawn, ticket: '', prompt: '', people: [], calls: [], prs: [], answers: { '*': 'I drew what I know on the map. Click a box for its files, or ask me about one.' } };
  };

  const fresh = () => ({ ...seed(), log: [], threads: {}, comments: [] });
  // All chat is one place: each person's chat with Claude (threads['@Duy']). A question about a box
  // carries the box as `about`. Older maps kept a thread per box; those messages move into the chat of
  // whoever asked, keep their box, and fall into time order by the log, which kept the moment of each ask.
  /** @param {any} s */
  function oneChat(s) {
    const boxes = Object.keys(s.threads || {}).filter((k) => !k.startsWith('@'));
    if (!boxes.length) return;
    const used = new Set(), when = (/** @type {any} */ m) => {
      const i = (s.log || []).findIndex((/** @type {any} */ l, /** @type {any} */ j) => !used.has(j) && l.action === 'asked' && l.who === m.who && l.text === m.text);
      if (i < 0) return null; used.add(i); return s.log[i].at;
    };
    const into = /** @type {Record<string, any>} */ ({});
    const add = (/** @type {any} */ key, /** @type {any} */ list, /** @type {any} */ about) => {
      let t = 0, who = key.startsWith('@') ? key.slice(1) : null;
      for (const m of list) {
        if (m.who !== 'Claude') { who = m.who; t = when(m) ?? t; } else t += 0.001;
        (into[`@${who || 'Duy'}`] ??= []).push({ m: about ? { ...m, about } : m, t });
      }
    };
    // a person's earlier chats (threads['@Duy#<when>']) and their box chats (threads['@Duy>billing']) stay as they are
    const own = (/** @type {any} */ k) => k.includes('#') || k.includes('>');
    const kept = Object.entries(s.threads).filter(([k]) => own(k));
    for (const [key, list] of Object.entries(s.threads)) if (!own(key)) add(key, list, key.startsWith('@') ? null : key);
    s.threads = { ...Object.fromEntries(kept), ...Object.fromEntries(Object.entries(into).map(([k, l]) => [k, l.sort((/** @type {any} */ a, /** @type {any} */ b) => a.t - b.t).map((/** @type {any} */ x) => x.m)])) };
  }
  // a chat that is this person's: the one open now, one in their history, or one on a box
  let state = withDefaults(initialState ? structuredClone(initialState) : fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : fresh());
  // A map is usable as extra context only while it remains checked in Brain.
  const selectedContextMaps = (/** @type {any} */ who) => (contextMaps?.(who) || []).filter((/** @type {any} */ m) => state.contextMapIds?.includes(m.id)).map((/** @type {any} */ m) => ({...m, allowed: () => state.contextMapIds?.includes(m.id) && m.allowed()}));
  const updateBoxDates = boxDates(state, !initialState && !fs.existsSync(STATE));
  // a map stored with the seed's cast, or with guests, keeps only those who joined by signing in; the rest come back the moment they do
  if (!memory && (project || name)) state.people = (state.people || []).filter((/** @type {any} */ p) => p.joined).map((/** @type {any} */ p) => ({ ...p, role: roleOf(p.id), sees: 'all' }));
  // a reply cut off when the server stopped says so, instead of thinking forever
  for (const t of Object.values(state.threads || {})) for (const m of t) if (m.thinking) { delete m.thinking; delete m.doing; delete m.since; m.text ||= 'Stopped before it answered. Ask again.'; }
  for (const n of state.nodes.flatMap((/** @type {any} */ n) => [n, ...(n.inside?.nodes || [])])) recoverAction(n);
  oneChat(state);
  const clients = new Set();
  const activeAsks = new Set();
  const clientAccess = new Map();
  const cursors = /** @type {Record<string, any>} */ ({}); // by name: {x, y, view, at}; never saved
  // who has this map open right now: each signed-in window, told to every window as people come and go
  const viewers = new Map();
  const here = () => { const names = [...new Set(viewers.values())]; for (const r of clients) send(r, 'here', names); };

  // a named map gets its folder the first time something is written to it
  const save = () => { updateBoxDates(state); if (memory || closed) return; fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); };
  const send = (/** @type {any} */ res, /** @type {any} */ ev, /** @type {any} */ data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const push = () => { for (const r of clients) {
    const c = clientAccess.get(r), role = permission(state, c.who, c.req);
    if (!role || role !== c.role) {
      send(r, role ? 'access-changed' : 'access-removed', {}); clients.delete(r); clientAccess.delete(r); r.end();
    } else send(r, 'state', sharedState(state, role === 'owner', c.guest));
  } };

  /** @type {any} */ const cloud = !memory ? cloudMirror({ home, read: () => state,
    write: (data) => { installCloudData(state, data); save(); push(); },
    notify: () => { for (const r of clients) if (clientAccess.get(r)?.role === 'owner') send(r, 'cloud', cloud.status()); }
  }) : null;

  // The Claude pane, synced: the Claude Code chat linked last (state.linked[0]) is followed through its
  // transcript, and its owner's windows get it as a "mirror" event: that chat's messages, what the owner
  // wrote from the map, and the changes it proposed here, in time order. Nobody else is sent it.
  let /** @type {any} */ mirror = null;
  const linkOf = () => state.linked?.[0] || null;
  const ownsChat = (/** @type {any} */ session, /** @type {any} */ by) => (state.linked || []).some((/** @type {any} */ l) => l.session === session && l.owner === by);
  function mirrorView() {
    const l = linkOf(); if (!l || !mirror || mirror.session !== l.session) return null;
    // handed: the chat's listener has taken the message; one written before this was tracked counts as taken
    const said = (state.said?.[l.session] || []).map((/** @type {any} */ s) => ({ who: 'you', text: s.text, at: s.at, map: true, handed: !s.id || !!s.handed, ...(s.imgs ? { imgs: s.imgs } : {}) }));
    const props = (state.proposals || []).filter((/** @type {any} */ p) => p.session === l.session).map((/** @type {any} */ p) => ({ who: 'claude', at: p.made, proposal: p }));
    // listening: the chat's listener is waiting for the map right now, so what is written next reaches it at once
    return { session: l.session, owner: l.owner, model: mirror.f.model(), status: mirror.f.status(), listening: waiters.some((/** @type {any} */ w) => w.who === l.session),
      msgs: [...mirror.f.msgs(), ...said, ...props].sort((x, y) => x.at - y.at).slice(-300) };
  }
  const sendMirror = () => { const v = mirrorView(); if (!v) return; for (const r of clients) if (viewers.get(r) === v.owner) send(r, 'mirror', v); };
  function startMirror() {
    const l = linkOf();
    if (mirror && mirror.session === l?.session) return;
    mirror?.f.stop(); mirror = null;
    if (l && l.file && fs.existsSync(l.file)) mirror = { session: l.session, f: chats.follow(l.file, sendMirror, { anyUser: !!l.built }) };
  }
  if (!memory) startMirror();

  // Maps started from a prompt before new maps opened in the Claude app (build, below) have their chat running
  // here, headless, in the map's folder: the agent's own chat (agent.converse) with nobody to ask, so anything it
  // would stop to ask about (sending, posting, changing things outside the map) is refused. Their pane follows that chat,
  // and what the owner writes there continues it, one turn at a time.
  let /** @type {any} */ building = null; const /** @type {any} */ queued = [];
  const brief = () => [
    `You are drawing a map on Living Map, the team's shared map on this Mac. This map is "${name}": pass map: "${name}" to living_map_read and living_map_change.`,
    'It began as a blank canvas from the prompt you are given. Find what it needs with the tools you have (files, the web, and the apps this Claude Code is connected to), then draw it with living_map_change: boxes for the parts, lines between them, and a question for a teammate where something is not known.',
    'Read, never act: do not send, post, book, buy, or change anything outside this map.',
    'Your replies show in the chat beside the map: say in two or three short lines what you drew, what you found, and what you could not reach.',
  ].join('\n');
  /** @param {any} l @param {any} text */
  function converse(l, text) {
    if (building) { queued.push(text); return; }
    fs.mkdirSync(home, { recursive: true });
    const first = !l.started; l.started = true; save();
    building = agent.converse({ cwd: home, session: l.session, first, title: `Living Map: ${state.title}`, system: brief(), prompt: text,
      onClose: () => { building = null; if (queued.length) converse(l, queued.splice(0).join('\n\n')); } });
    // its transcript appears once it starts; the pane follows it from then
    if (!l.file) {
      let tries = 0;
      const look = setInterval(() => {
        const file = chats.findChat(l.session);
        if (file) { l.file = file; save(); startMirror(); }
        if (file || ++tries > 240) clearInterval(look);
      }, 500);
    }
  }
  // A new map from a prompt opens a new chat in the agent's app, in the map's folder, so it sits in Recents like
  // any other chat, with every tool, connector and permission the app gives it. The chat starts with
  // /anur-living-map map:<name> and the prompt, and draws. The pane follows it from its first second: the server
  // links the new chat whose words hold "map:<name>" as soon as its transcript appears, without waiting the half
  // minute until the skill's own link step (which then changes nothing).
  function build(/** @type {any} */ { prompt, by }) {
    const words = prompt.replace(/\s+/g, ' ').split(' ');
    let title = ''; for (const w of words) { if ((`${title} ${w}`).trim().length > 40) break; title = `${title} ${w}`.trim(); }
    state.title = state.renamed = (title || 'New map').replace(/^./, (c) => c.toUpperCase());
    state.starting = { prompt, by, at: Date.now() };
    save(); push();
    const q = `/anur-living-map map:${name} ${prompt}`;
    chats.openNew({ prompt: q, folder: home });
    const since = state.starting.at - 2000; let tries = 0;
    const look = setInterval(() => {
      const file = chats.findNewChat({ folder: home, since, holding: `map:${name}` });
      if (file && state.starting) { ACTS.link({ session: path.basename(file, '.jsonl'), file, by }); save(); push(); }
      if (file || !state.starting || ++tries > 240) clearInterval(look);
    }, 500);
  }
  // pictures attached from the map's chat, kept in the map's folder as <hash>.png (or .jpg, .gif, .webp);
  // a picture from the chat itself is read from its transcript; both go by the same kind of id
  const PICS = path.join(home, 'chat-images'), EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  /** @param {any} p */
  function savePicture(p) {
    const m = String(p || '').match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64'); if (!buf.length || buf.length > 10e6) return null;
    const id = crypto.createHash('sha1').update(m[2]).digest('hex').slice(0, 16), file = path.join(PICS, `${id}.${/** @type {Record<string, any>} */ (EXT)[m[1]]}`);
    fs.mkdirSync(PICS, { recursive: true }); if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
    return { id, file };
  }
  /** @param {any} id */
  function picture(id) {
    const t = mirror?.f.img(id); if (t) return { type: t.type, buf: Buffer.from(t.data, 'base64') };
    const f = fs.existsSync(PICS) && fs.readdirSync(PICS).find((n) => n.startsWith(`${id}.`));
    return f ? { type: Object.keys(EXT).find((k) => f.endsWith(`.${/** @type {Record<string, any>} */ (EXT)[k]}`)), buf: fs.readFileSync(path.join(PICS, f)) } : null;
  }

  // what people do on the map goes to the outbox, and, given a chat to tell, to that chat's inbox:
  // its listener (wait.js) is waiting at /api/wait and wakes the chat. "*" is whichever chat listens.
  const /** @type {any} */ waiters = [];
  // this map's address, for the rules a chat follows
  const address = () => `http://localhost:${PORT}${name ? `/${name}` : project ? `/${mapName(project)}` : ''}`;
  // which version of the rules each chat last got: they go out again only when they are new to that chat,
  // and otherwise one line says where to read them, for a chat that has lost them from view
  const rulesSeen = new Map();
  const rulesFor = (/** @type {any} */ session) => {
    const rules = chatRules(address()); if (!rules) return '';
    const v = crypto.createHash('sha1').update(rules).digest('hex');
    if (rulesSeen.get(session) === v) return `\nAnswer by the map's rules, unchanged since you last got them (${address()}/api/rules).\n`;
    rulesSeen.set(session, v); return `\nHOW TO ANSWER IT (from the map server):\n${rules}\n`;
  };
  // what the change being made told the outbox; the history names that version with it
  let /** @type {any} */ told = null;
  // said: the id of what the owner wrote in the pane, marked handed once a listener takes it
  const tell = (/** @type {any} */ text, to = '', said = '') => {
    told = text;
    if (!memory) { fs.mkdirSync(home, { recursive: true }); fs.appendFileSync(OUTBOX, `- ${new Date().toTimeString().slice(0, 5)} ${text}\n`); }
    if (to) { state.forChats = [...(state.forChats || []), { to, text, at: stamp(), ...(said ? { said } : {}) }].slice(-50); setTimeout(wake); }
  };
  // hand each waiting chat what is meant for it; "*" goes to the chat that started listening last
  function wake() {
    let changed = false;
    for (const w of [...waiters].reverse()) {
      const mine = (state.forChats || []).filter((/** @type {any} */ m) => m.to === w.who || m.to === '*');
      if (!mine.length) continue;
      state.forChats = state.forChats.filter((/** @type {any} */ m) => !mine.includes(m));
      waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer);
      w.res.writeHead(200, { 'content-type': 'text/plain' }).end(mine.map((/** @type {any} */ m) => `- ${m.at} ${m.text}`).join('\n') + '\n' + rulesFor(w.who));
      for (const m of mine) if (m.said) { const s = state.said?.[w.who]?.find((/** @type {any} */ x) => x.id === m.said); if (s) s.handed = Date.now(); }
      changed = true;
    }
    if (changed) { save(); setTimeout(sendMirror); }
  }
  // which chat a change belongs to: the one that drew the call or box, else the last one that drew on this map
  /** @type {(nodeId: any, call?: any) => any} */
  const ownerOf = (nodeId, call) => call?.session || nodeOf(nodeId)?.session || state.owner || '*';
  const stamp = () => new Date().toTimeString().slice(0, 5);

  const allNodes = () => state.nodes.flatMap((/** @type {any} */ n) => [n, ...(n.inside?.nodes ?? [])]);
  const allEdges = () => state.edges.concat(state.nodes.flatMap((/** @type {any} */ n) => n.inside?.edges ?? []));
  const nodeOf = (/** @type {any} */ id) => allNodes().find((/** @type {any} */ n) => n.id === id);

  // what a person's answer does to the map, from the call's own seed. A yes-or-no call takes
  // confirm or dispute; a call with options takes one of them, or the person's own words.
  /** @param {any} a */
  function answerCall(a) {
    const c = state.calls.find((/** @type {any} */ x) => x.id === a.id);
    if (!c || c.status !== 'open') return false;
    let fx;
    if (c.options?.length) {
      const o = c.options.find((/** @type {any} */ x) => x.id === a.option), own = String(a.other || '').trim().slice(0, 400);
      if (!o && !own) return false;
      fx = o || {};
      c.status = 'answered'; c.pickedId = o ? o.id : 'other'; c.picked = o ? o.label : own;
      c.by = a.by; c.at = stamp(); c.said = o ? fx.says || '' : own;
    } else {
      if (a.answer !== 'confirm' && a.answer !== 'dispute') return false;
      fx = c[a.answer] || {};
      c.status = a.answer === 'confirm' ? 'confirmed' : 'disputed';
      c.by = a.by; c.at = stamp(); c.said = fx.says || '';
    }
    const n = fx.node && nodeOf(fx.node);
    if (n) {
      if (fx.state !== undefined) n.state = fx.state;
      if (fx.sub !== undefined) n.sub = fx.sub;
      n.decided = { who: a.by, at: c.at, what: fx.sub || c.picked || c.status, call: c.id };
    }
    if (fx.edge) { const [f, t] = fx.edge.split('>'); const e = allEdges().find((/** @type {any} */ x) => x.from === f && x.to === t); if (e) e.state = fx.edgeState || ''; }
    state.log.push({ at: Date.now(), who: a.by, action: c.status, call: c.id, node: c.node, text: c.text, said: c.said, picked: c.picked });
    tell(c.status === 'answered'
      ? `${a.by} answered "${c.text}": ${c.pickedId === 'other' ? `in their own words, "${c.picked}"` : `"${c.picked}"${fx.says ? ` — ${fx.says}` : ''}`}`
      : `${a.by} ${c.status} "${c.text}"${fx.says ? ` — ${fx.says}` : ''}${fx.chat ? `\n  Claude: ${fx.chat}` : ''}`, ownerOf(c.node, c));
    return true;
  }

  const { seesOf, askPrompt } = askContext({ getState: () => state, project, nodeOf, allNodes, allEdges });

  const actions = actionBoxes({
    nodeOf,
    allNodes,
    canUse: (n, by) => !!by && by !== 'Guest' && !(state.removedPeople || []).includes(by) && (seesOf(by) === 'all' || n.area === seesOf(by)),
    context: (n, by) => askPrompt(by, n, 'Prepare this box as an action. Ask for missing information before it is ready.', (state.threads?.[`@${by}>${n.id}`] || []).filter((/** @type {any} */ m) => !m.thinking).slice(-20), true),
    ask: (request) => askAgent({ cwd:project || PROJECT || home, contextMaps:selectedContextMaps, who:request.by, prepare:true, connected:managesAccess(state,request.by), ...request }),
    changed: () => { save(); push(); },
    executionCwd: project || PROJECT || home,
    run: (request) => { fs.mkdirSync(home, {recursive:true}); return agent.run({ schema:completionSchema, system:executionPrompt, read:readCompletion, ...request }); },
  });

  // Instructions (what Claude must follow) and Memory (what the team asked it to keep), each for the whole map
  // (box null) or one box. Claude reads both before every answer; people add, edit and remove them on the map.
  /** @param {any} m @param {any} by */
  function keepMemory(m, by) {
    const kind = ['instruction', 'memory'].includes(m?.kind) ? m.kind : null, text = String(m?.text || '').trim().slice(0, 300);
    const box = m?.box ? nodeOf(m.box) : null, sees = seesOf(by);
    if (!kind || !text || (m?.box && !box) || (box && sees !== 'all' && box.area !== sees)) return null;
    const item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind, box: box?.id || null, text, by, at: Date.now() };
    (state.memory ??= []).push(item); return item;
  }
  // boxes, lines and calls are added or updated by id; removed boxes go
  /** @param {any} p @param {any} by @param {any} source */
  function draw(p, by, source) {
    // A drawing can change a box's content, but its original creator, source and dates come from the map.
    const markCreators = (/** @type {any} */ nodes, /** @type {any} */ previous) => {
      for (const n of nodes || []) if (n) {
        const prior = previous?.find((/** @type {any} */ box) => box.id === n.id);
        delete n.createdAt; delete n.updatedAt; delete n.updatedBy; delete n.source;
        delete n.by;
        if (prior?.by) n.by = prior.by;
        else if (!prior) n.by = by;
        if (prior?.source) n.source = prior.source;
        else if (!prior) n.source = source;
        markCreators(n.inside?.nodes, prior?.inside?.nodes);
      }
    };
    markCreators(p.nodes, state.nodes);
    for (const n of p.nodes || []) if (n && 'diagram' in n) n.diagram = diagramOf(n.diagram);
    const merge = (/** @type {any} */ list, /** @type {any} */ key, /** @type {any} */ items = []) => {
      for (const it of items) {
        const k = key(it), had = list.find((/** @type {any} */ x) => key(x) === k);
        if (had) Object.assign(had, it); else list.push(it);
      }
    };
    merge(state.nodes, (/** @type {any} */ n) => n.id, p.nodes);
    merge(state.edges, (/** @type {any} */ e) => `${e.from}>${e.to}`, p.edges);
    // a new box with no place goes where its lines cross nothing
    placeNew(state.nodes, state.edges, state.start);
    merge(state.calls, (/** @type {any} */ c) => c.id, p.calls);
    for (const id of p.remove || []) state.nodes = state.nodes.filter((/** @type {any} */ n) => n.id !== id);
    for (const e of p.unlink || []) unlinkEdge(e.from, e.to);
  }
  // a line taken off the map, wherever it is drawn: the system or the inside of a box
  /** @param {any} from @param {any} to */
  function unlinkEdge(from, to) {
    let gone = false;
    for (const s of [state, ...state.nodes.map((/** @type {any} */ n) => n.inside).filter(Boolean)]) {
      const before = (s.edges || []).length; s.edges = (s.edges || []).filter((/** @type {any} */ e) => !(e.from === from && e.to === to)); gone ||= s.edges.length < before;
    }
    return gone;
  }

  const { proposal, checkAutoPlan, check } = proposalChecks({ getState: () => state, nodeOf, allNodes, allEdges, seesOf, placeProposed: (plan) => placeProposed(plan) });
  /** @param {any} plan */
  function placeProposed(plan) {
    const fresh = plan.nodes.filter((/** @type {any} */ n) => !nodeOf(n.id)).map((/** @type {any} */ { x, y, ...n }) => n);
    plan.layout = [];
    if (!fresh.length) return;
    plan.layout = appendProposed(state.nodes, state.edges, fresh, plan.edges);
    placeNew([...state.nodes.map((/** @type {any} */ n) => ({ ...n, ...plan.layout.find((/** @type {any} */ m) => m.id === n.id) })), ...fresh], [...state.edges, ...plan.edges], plan.start || state.start);
    for (const f of fresh) Object.assign(plan.nodes.find((/** @type {any} */ n) => n.id === f.id), { x: f.x, y: f.y });
  }
  // Claude's "tidy": Tidy up as if nobody had dragged a box, so every box is regrouped and rebalanced and the lines
  // read as one tree; the boxes are Claude's to place again until someone drags one
  function relayout() {
    if (!tidyTree(state.nodes, state.edges, null, () => false, state.start)) tidy(state.nodes, state.edges);
    for (const n of state.nodes) delete n.moved;
    for (const p of pendingProposals()) placeProposed(p.plan);
  }
  /** @type {(by?: any) => any[]} */
  const pendingProposals = (by) => pendingIn(state, by, ownsChat);
  // Older pending offers also adopt the branch preview when their map opens.
  for (const p of pendingProposals()) placeProposed(p.plan);

  // History: every change saves itself, and each one is a version of the map you can open and go back to,
  // kept in history/<id>.json with the list in history/index.json, newest first. A version is the map itself,
  // its boxes, lines and questions; chats, comments, people and the linked chat are not part of it.
  const HIST = path.join(home, 'history'), HIST_LIST = path.join(HIST, 'index.json'), KEEP_VERSIONS = 500;
  const CONTENT = ['desc', 'nodes', 'edges', 'calls', 'prs', 'pr', 'executed', 'ticket', 'prompt', 'answers'];
  const contentOf = (/** @type {any} */ s) => JSON.stringify(Object.fromEntries(CONTENT.filter((k) => s[k] !== undefined).map((k) => [k, s[k]])));
  const clock = (/** @type {any} */ t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  let history = fs.existsSync(HIST_LIST) ? JSON.parse(fs.readFileSync(HIST_LIST, 'utf8')) : [];
  /** @param {any} v @param {any} json */
  function keepVersion(v, json) {
    if (memory) return;
    fs.mkdirSync(HIST, { recursive: true }); fs.writeFileSync(path.join(HIST, `${v.id}.json`), json);
    history = [v, ...history.filter((/** @type {any} */ h) => h.id !== v.id)].sort((x, y) => y.at - x.at);
    for (const old of history.splice(KEEP_VERSIONS)) try { fs.unlinkSync(path.join(HIST, `${old.id}.json`)); } catch {}
    fs.writeFileSync(HIST_LIST, JSON.stringify(history));
  }
  // dragging boxes about, or tidying again and again, is one version while the same person keeps at it
  const RUNS = new Set(['move', 'tidy', 'resize']), RUN_MS = 3 * 60_000;
  const LABEL = { move: 'moved boxes', reparent: 'moved a topic to another parent', tidy: 'tidied up the map', add: 'drew a box', connect: 'drew a line', remove: 'took a box off the map', unlink: 'took a line off the map', relabel: 'renamed a line', resize: 'resized a box', reset: 'started the map over from the code', rename: 'renamed the map' };
  let lastContent = history[0] && fs.existsSync(path.join(HIST, `${history[0].id}.json`)) ? fs.readFileSync(path.join(HIST, `${history[0].id}.json`), 'utf8') : null;
  // with Auto-save off (state.autosave false, from the Save menu) a change makes no version; Save now does
  /** @param {any} type @param {any} by */
  function remember(type, by, force = false) {
    if (state.autosave === false && !force) return;
    const json = contentOf(state); if (json === lastContent) return;
    lastContent = json;
    const top = history[0], now = Date.now();
    const run = top && RUNS.has(type) && top.kind === type && top.by === by && now - top.at < RUN_MS;
    keepVersion({ id: run ? top.id : now.toString(36), at: now, by, kind: type, what: told || `${by} ${/** @type {Record<string, any>} */ (LABEL)[type] || 'changed the map'}`, boxes: state.nodes.length }, json);
  }
  // Save now: the map as it is becomes a version, saved by this person (nothing new to keep when no change was made)
  /** @param {any} by */
  function saveNow(by, what = `${by} saved the map`, at = Date.now()) {
    const json = contentOf(state); if (json === lastContent) return;
    lastContent = json;
    keepVersion({ id: at.toString(36), at, by, kind: 'save', what, boxes: state.nodes.length }, json);
  }
  // maps saved with the old Save button become versions in the history, and their files go
  if (state.saves?.length) {
    for (const s of state.saves) {
      const file = path.join(SAVES, `${s.id}.json`); if (!fs.existsSync(file)) continue;
      keepVersion({ id: s.id, at: s.at, by: s.by, kind: 'save', what: `${s.by} saved the map as "${s.name}"`, boxes: s.boxes }, contentOf(JSON.parse(fs.readFileSync(file, 'utf8'))));
      fs.unlinkSync(file);
    }
    delete state.saves; try { fs.rmdirSync(SAVES); } catch {}
    save();
    if (history[0]) lastContent = fs.readFileSync(path.join(HIST, `${history[0].id}.json`), 'utf8');
  }
  // the map as it is now, when no version holds it yet, is the first version: the starting point to go back to.
  // A named map nobody has drawn on yet (no state.json) keeps none, so visiting an address, or a page left open
  // on a map that was deleted, never makes its folder again
  if ((project || fs.existsSync(STATE)) && contentOf(state) !== lastContent) {
    lastContent = contentOf(state);
    keepVersion({ id: Date.now().toString(36), at: Date.now(), by: '', kind: 'start', what: history.length ? 'The map as it was left' : 'The map when its history began', boxes: state.nodes.length }, lastContent);
  }

  // what outlives starting over
  const kept = () => ({
    // the Claude chat this map is linked to, and what was written to it from the map, outlive it too
    contextMapIds: state.contextMapIds || [], linked: state.linked || [], said: state.said || {}, removedPeople: state.removedPeople || [], linkSharing: state.linkSharing || { mode: 'restricted' },
    ...(state.renamed ? { title: state.renamed, renamed: state.renamed } : {}), ...(state.autosave === false ? { autosave: false } : {}) });

  const edits = editHistory(undoState);
  const UNDOABLE = new Set(['move', 'reparent', 'tidy', 'add', 'connect', 'remove', 'unlink', 'resize', 'relabel', 'renamebox', 'describebox', 'rename']);
  const ACTS = {
    ...boxActs({ getState: () => state, nodeOf, seesOf, sideOf, tell }),
    ...chatActs({ getState: () => state, project, name, home, nodeOf, seesOf, askPrompt, proposal, check, checkAutoPlan, pendingProposals,
      selectedContextMaps, askAgent, agent, activeAsks, stamp, save, push, tell, ownsChat, mineChat, ownerOf, placeProposed, draw, actions,
      relayout, keepMemory }),
    /** @param {any} a */
    reparent(a) {
      const sees = seesOf(a.by);
      if (!reparentTopic(state, a, (n) => sees === 'all' || n.area === sees)) return false;
      tell(`${a.by} moved ${nodeOf(a.id).label} under ${nodeOf(a.parent).label}`);
      return true;
    },
    /** @param {any} a */
    move(a) {
      if (Array.isArray(a.moves)){
        const sees = seesOf(a.by), moves = a.moves;
        if (!moves.length || new Set(moves.map((/** @type {any} */ m) => m?.id)).size !== moves.length || moves.some((/** @type {any} */ m) => { const n = nodeOf(m?.id); return !n || (sees !== 'all' && n.area !== sees) || ![m.fromX,m.fromY,m.x,m.y].every(Number.isFinite) || n.x !== m.fromX || n.y !== m.fromY; })) return false;
        for (const m of moves) Object.assign(nodeOf(m.id),{x:Math.round(m.x),y:Math.round(m.y),moved:true});
        return true;
      }
      const n = nodeOf(a.id) || pendingProposals(a.by).flatMap((p) => p.plan.nodes).find((x) => x.id === a.id && Number.isFinite(x.x));
      if (!n) return false; n.x = Math.round(a.x); n.y = Math.round(a.y);
      // put there by a person: Tidy up keeps its side and order (a box still only proposed is not on the map yet)
      if (nodeOf(a.id)) n.moved = true;
      return true;
    },
    // drawn by hand on the map: a box where it was drawn (a.view: inside that box; box-acts.js), a line from one box to another
    // (words on it optional; drawing one that exists changes its words), and a box taken off the map, its lines with
    // it. Someone who sees one area draws in that area and takes off only what is in it
    // a line dragged out of a box's dot keeps the side it left from (out) and the side it arrives on (in): t r b l
    /** @param {any} a */
    connect(a) {
      const from = nodeOf(a.from), to = nodeOf(a.to); if (!from || !to || from === to) return false;
      const out = sideOf(a.out), inn = sideOf(a.in), sides = { ...(out ? { out } : {}), ...(inn ? { in: inn } : {}) };
      const sees = seesOf(a.by); if (sees !== 'all' && [from, to].some((n) => n.area !== sees)) return false;
      const inside = a.view && a.view !== 'system' ? nodeOf(a.view)?.inside : null, edges = inside ? (inside.edges ??= []) : state.edges;
      const label = String(a.label || '').trim().slice(0, 40), had = edges.find((/** @type {any} */ e) => e.from === from.id && e.to === to.id);
      if (had) { if (!label && !out && !inn) return false; if (label) had.label = label; Object.assign(had, sides); } else edges.push({ from: from.id, to: to.id, ...(label ? { label } : {}), ...sides });
      tell(`${a.by} drew a line ${from.label} → ${to.label}${label ? ` (${label})` : ''}`);
      return true;
    },
    // a box resized from a corner: its new middle and size; a person put it there, so Tidy up keeps it
    /** @param {any} a */
    resize(a) {
      const n = nodeOf(a.id); if (!n) return false;
      const sees = seesOf(a.by); if (sees !== 'all' && n.area !== sees) return false;
      const w = Math.round(Number(a.w)), h = Math.round(Number(a.h));
      if (!(w >= 60 && w <= 800 && h >= 36 && h <= 600) || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
      Object.assign(n, { x: Math.round(a.x), y: Math.round(a.y), w, h, moved: true });
      return true;
    },
    // a line's words changed by a double click on them; empty words take them off the line
    /** @param {any} a */
    relabel(a) {
      const from = nodeOf(a.from), to = nodeOf(a.to); if (!from || !to) return false;
      const sees = seesOf(a.by); if (sees !== 'all' && [from, to].some((n) => n.area !== sees)) return false;
      const all = [state.edges, ...state.nodes.map((/** @type {any} */ p) => p.inside?.edges || [])].flat();
      const e = all.find((x) => x.from === from.id && x.to === to.id); if (!e) return false;
      const label = String(a.label || '').trim().slice(0, 40); if ((e.label || '') === label) return false;
      if (label) e.label = label; else delete e.label;
      tell(`${a.by} ${label ? `named the line ${from.label} → ${to.label} "${label}"` : `took the words off the line ${from.label} → ${to.label}`}`);
      return true;
    },
    // a line picked on the map and deleted, by hand
    /** @param {any} a */
    unlink(a) {
      const from = nodeOf(a.from), to = nodeOf(a.to); if (!from || !to) return false;
      const sees = seesOf(a.by); if (sees !== 'all' && [from, to].some((n) => n.area !== sees)) return false;
      if (!unlinkEdge(from.id, to.id)) return false;
      tell(`${a.by} took the line ${from.label} → ${to.label} off the map`);
      return true;
    },
    /** @param {any} a */
    remove(a) {
      const roots = Array.isArray(a.ids) ? a.ids : [a.id];
      if (!roots.length || roots.some((/** @type {any} */ id) => !nodeOf(id))) return false;
      const ids = a.cascade ? branchIds(state, roots) : new Set(roots), sees = seesOf(a.by);
      if ([...ids].some((id) => !nodeOf(id) || (sees !== 'all' && nodeOf(id).area !== sees))) return false;
      const label = nodeOf(roots[0]).label;
      const drop = (/** @type {any} */ s) => { s.nodes = s.nodes.filter((/** @type {any} */ n) => !ids.has(n.id)); s.edges = (s.edges || []).filter((/** @type {any} */ e) => !ids.has(e.from) && !ids.has(e.to)); };
      drop(state); for (const n of state.nodes) if (n.inside) drop(n.inside);
      tell(`${a.by} took ${label}${ids.size > 1 ? ' and its branch' : ''} off the map`);
      return true;
    },
    // Tidy up, for everyone, laid out for what the person pressing it can see (a.only: the boxes not folded away
    // in their window). A topic map lays out as a mind map; any other map puts its showing boxes that are off the
    // grid on it, with no line through a box. Neither moves anything when pressed twice. Boxes Claude proposed and nobody applied yet find new places around it.
    /** @param {any} a */
    tidy(a) {
      const inside = a.view && a.view !== 'system' ? nodeOf(a.view)?.inside : null, list = inside ? inside.nodes : state.nodes;
      if (!list?.length) return false;
      const edges = inside ? inside.edges || [] : state.edges, only = Array.isArray(a.only) ? new Set(a.only.map(String)) : null;
      const sizes = new Map((Array.isArray(a.sizes) ? a.sizes : []).filter((/** @type {any} */ s) => s && typeof s.id === 'string' && Number.isFinite(s.w) && s.w >= 60 && s.w <= 800 && Number.isFinite(s.h) && s.h >= 36 && s.h <= 2000).map((/** @type {any} */ s) => [s.id, {w:s.w, h:s.h}]));
      // a box someone dragged or drew keeps its side and order; every box Claude placed is regrouped and rebalanced
      if (!tidyTree(list, edges, only, (n) => Number.isFinite(n.x) && n.moved, inside ? null : state.start, sizes)) tidy(list, edges, only);
      if (!inside) for (const p of pendingProposals()) placeProposed(p.plan);
      return true;
    },
    call: answerCall,
    /** @param {any} a */
    actionbox(a) { return actions.begin(a.id, a.by); },
    /** @param {any} a */
    actionstart(a) { return actions.start(a.id, a.by, a.intent); },
    /** @param {any} a */
    actionretry(a) { return actions.prepare(a.id, a.by); },
    /** @param {any} a */
    actionanswer(a) { return actions.prepare(a.id, a.by, a.answer); },
    /** @param {any} a */
    actionrevise(a) { return actions.revise(a.id, a.by); },
    /** @param {any} a */
    actioncancel(a) { return actions.cancel(a.id, a.by); },
    /** @param {any} a */
    actionexecute(a) { return actions.execute(a.id, a.by, a.revision); },
    /** @param {any} a */
    actioncontinue(a) { return actions.continue(a.id, a.by, a.revision, a.answer); },
    /** @param {any} a */
    actionstop(a) { return actions.stop(a.id, a.by, a.revision); },
    // the Save menu: Save now, and Auto-save, on unless someone turns it off; off, the map still changes for
    // everyone at once, but only Save now puts a version in History. One switch for the whole map.
    /** @param {any} a */
    savenow(a) { saveNow(a.by); return true; },
    /** @param {any} a */
    autosave(a) { state.autosave = a.on !== false; return true; },
    // starting over keeps the name someone gave the map; History keeps the map before
    reset() { state = { ...fresh(), ...kept() }; try { fs.unlinkSync(OUTBOX); } catch {} return true; },
    // Discovery combines this background with the current topics and decisions.
    /** @param {any} a */
    contextmap(a) {
      if (!a.by || a.by === 'Guest' || seesOf(a.by) !== 'all' || typeof a.id !== 'string' || typeof a.include !== 'boolean') return false;
      if (a.include && !(contextMaps?.(a.by) || []).some((/** @type {any} */ m) => m.id === a.id && m.allowed())) return false;
      const ids = new Set(state.contextMapIds || []);
      if (a.include) ids.add(a.id); else ids.delete(a.id);
      state.contextMapIds = [...ids];
      return true;
    },
    /** @param {any} a */
    describemap(a) {
      if (typeof a.description !== 'string' || a.description.length > 12000 || seesOf(a.by) !== 'all') return false;
      state.desc = a.description.trim();
      return true;
    },
    // Renaming changes the title, not the map's address.
    /** @param {any} a */
    rename(a) {
      const title = String(a.title || '').trim().slice(0, 60);
      if (!title) return false;
      state.title = title; state.renamed = title;
      return true;
    },
    // going back to a version in the history: the map takes that version's boxes, lines and questions, while chats,
    // comments and people stay as they are; going back is a version itself, so it can be undone the same way
    /** @param {any} a */
    restore(a) {
      const v = history.find((/** @type {any} */ h) => h.id === String(a.id)), file = v && path.join(HIST, `${v.id}.json`);
      if (!file || !fs.existsSync(file)) return false;
      const restored = JSON.parse(fs.readFileSync(file, 'utf8'));
      boxDates(restored);
      Object.assign(state, restored);
      tell(`${a.by} went back to the version from ${clock(v.at)}`);
      return true;
    },
    // a chat opening the map finds it as it was left: every change saved itself, and History has the versions before
    open() { return true; },
    // Figma-style comments: a pin at a point on the map (or on a box), a thread of replies, resolvable
    /** @param {any} a */
    comment(a) {
      const text = String(a.text || '').trim().slice(0, 600); if (!text) return false;
      state.comments ??= [];
      const c = { id: state.comments.length + 1, x: Math.round(a.x), y: Math.round(a.y), view: a.view || 'system', node: a.node || null,
        resolved: false, msgs: [{ who: a.by, text, at: Date.now() }] };
      state.comments.push(c);
      tell(`${a.by} commented${c.node ? ` on ${nodeOf(c.node)?.label || c.node}` : ''}: ${text}`, ownerOf(c.node));
      return true;
    },
    /** @param {any} a */
    reply(a) {
      const c = state.comments?.find((/** @type {any} */ x) => x.id === Number(a.id)); const text = String(a.text || '').trim().slice(0, 600);
      if (!c || !text) return false;
      c.msgs.push({ who: a.by, text, at: Date.now() });
      tell(`${a.by} replied on comment #${c.id}: ${text}`, ownerOf(c.node));
      return true;
    },
    /** @param {any} a */
    resolve(a) { const c = state.comments?.find((/** @type {any} */ x) => x.id === Number(a.id)); if (!c) return false; c.resolved = !c.resolved; return true; },
    /** @param {any} a */
    drop(a) {
      const fromChat = a.proposal ? (state.proposals || []).find((/** @type {any} */ x) => x.id === a.proposal) : null;
      const key = String(a.thread || ''), pr = fromChat || state.threads[key]?.[Number(a.index)]?.proposal;
      if (!pr || pr.status !== 'pending' || !(fromChat ? ownsChat(fromChat.session, a.by) : mineChat(key, a.by))) return false;
      pr.status = 'dropped'; pr.by = a.by; return true;
    },
    // the Claude Code chat that opened this map with /anur-living-map: its owner's Claude pane follows that chat
    /** @param {any} a */
    link(a) {
      const session = String(a.session || ''), file = String(a.file || '');
      if (!chats.isChat(file, session)) return false;
      state.linked = [{ session, file, owner: a.by, at: Date.now() }, ...(state.linked || []).filter((/** @type {any} */ l) => l.session !== session)].slice(0, 10);
      delete state.starting;
      startMirror(); return true;
    },
    // what the owner types in the pane goes to that chat through its listener, and shows in the pane at once;
    // pictures attached to it are saved in the map's folder, and the chat is told where, so Claude can open them
    /** @param {any} a */
    say(a) {
      const l = linkOf(), text = String(a.text || '').trim().slice(0, 2000);
      if (!l || l.owner !== a.by) return false;
      const pics = (Array.isArray(a.images) ? a.images : []).slice(0, 5).map(savePicture).filter(Boolean);
      if (!text && !pics.length) return false;
      // a chat the map started itself hears it straight away, and its transcript shows it in the pane
      if (l.built) { converse(l, `${text}${pics.length ? `\n\n(attached ${pics.map((/** @type {any} */ p) => p.file).join(', ')})` : ''}`); return true; }
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      ((state.said ??= {})[l.session] ??= []).push({ id, text, at: Date.now(), ...(pics.length ? { imgs: pics.map((/** @type {any} */ p) => p.id) } : {}) });
      tell(`${a.by} wrote in the map's chat: "${text}"${pics.length ? ` (attached ${pics.map((/** @type {any} */ p) => p.file).join(', ')})` : ''}`, l.session, id);
      setTimeout(sendMirror); return true;
    },
    // a change the linked chat proposes: blue on the map and a card in the pane until its owner presses Apply
    /** @param {any} a */
    propose(a) {
      const session = String(a.session || ''), l = (state.linked || []).find((/** @type {any} */ x) => x.session === session);
      if (!l) return false;
      const pr = check(a, l.owner); if (!pr.ops.length) return false;
      state.proposals = [...(state.proposals || []), { id: Date.now().toString(36), session, made: Date.now(), note: String(a.note || '').slice(0, 200), ...pr }].slice(-30);
      setTimeout(sendMirror); return true;
    },
    // New chat: the chat you have goes into your history as threads['@Duy#<now>'], and you start an empty one
    /** @param {any} a */
    newchat(a) {
      const key = `@${a.by}`, t = state.threads[key];
      if (!t?.length || t.some((/** @type {any} */ m) => m.thinking)) return false;
      state.threads[`${key}#${Date.now().toString(36)}`] = t; state.threads[key] = [];
      return true;
    },
    // a chat picked from your history becomes the open one, and the one open now goes into the history
    /** @param {any} a */
    openchat(a) {
      const key = `@${a.by}`, from = String(a.chat || ''), old = state.threads[from], now = state.threads[key] || [];
      if (!from.startsWith(`${key}#`) || !old || now.some((/** @type {any} */ m) => m.thinking)) return false;
      delete state.threads[from];
      if (now.length) state.threads[`${key}#${Date.now().toString(36)}`] = now;
      state.threads[key] = old;
      return true;
    },
    // an agent draws its plan: boxes, lines and calls are added or updated by id,
    // so Claude Code (or Codex) can put "Billing" on the map from a chat
    /** @param {any} a */
    plan(a) {
      // what a chat draws is that chat's: changes people make to it go back to that chat
      const who = String(a.session || '').slice(0, 80);
      if (who) { for (const it of [...(a.nodes || []), ...(a.calls || [])]) it.session = who; state.owner = who; }
      // a plan that asks something new waits for answers again before anyone can press Execute
      if ((a.calls || []).some((/** @type {any} */ c) => c.status === 'open')) state.executed = null;
      draw(a, a.by, { kind: 'plan', ...(who ? { session: who } : {}) });
      Object.assign(state.answers, a.answers || {});
      // the ask behind the plan shows on the map's top line; a named map takes the plan's title
      if (a.title && name && !state.renamed) state.title = String(a.title).slice(0, 60);
      if (a.ticket) state.ticket = String(a.ticket).slice(0, 40);
      if (a.prompt) state.prompt = String(a.prompt).slice(0, 300);
      state.log.push({ at: Date.now(), who: a.by, action: 'drew', text: a.note || `${(a.nodes || []).length} boxes, ${(a.calls || []).length} calls` });
      tell(`${a.by} drew on the map: ${a.note || 'a plan'}`);
      return true;
    },
    // the plan's pull request, posted by the chat that drew it: a draft holding the plan while it waits for
    // answers, then open, with what the map checked, once the code is on it
    /** @param {any} a */
    pr(a) {
      const id = String(a.id || '').slice(0, 20); if (!id) return false;
      const had = (state.prs ||= []).find((/** @type {any} */ p) => p.id === id), s = (/** @type {any} */ v, /** @type {any} */ n) => String(v ?? '').slice(0, n);
      const pr = { id, title: s(a.title || had?.title, 120), url: s(a.url || had?.url, 300),
        status: ['draft', 'open', 'merged', 'closed'].includes(a.status) ? a.status : had?.status || 'draft',
        agent: s(a.agent || had?.agent || 'Claude Code', 40), by: a.by,
        checks: Array.isArray(a.checks) ? a.checks.slice(0, 12).map((/** @type {any} */ c) => ({ name: s(c.name, 120), ok: !!c.ok, ...(c.detail ? { detail: s(c.detail, 200) } : {}) })) : had?.checks || [],
        files: Array.isArray(a.files) ? a.files.slice(0, 30).map((/** @type {any} */ f) => s(f, 120)) : had?.files || [] };
      if (had) Object.assign(had, pr); else state.prs.push(pr);
      state.pr = id;
      tell(`${a.by} ${had ? 'updated' : 'opened'} pull request ${id}${pr.title ? `: ${pr.title}` : ''} (${pr.status})`);
      return true;
    },
    // Execute: the map's admin says go once nothing on the plan waits on anyone. The chat that drew the plan builds
    // it when it is listening; when that chat has gone quiet, the chat listening on this map now builds it instead,
    // so pressing Execute never lands in an empty inbox
    /** @param {any} a */
    execute(a) {
      const admin = state.people?.find((/** @type {any} */ p) => p.id === a.by)?.role === 'Admin';
      if (!admin || state.executed || !(state.prompt || state.owner) || state.calls.some((/** @type {any} */ c) => c.status === 'open')) return false;
      state.executed = { by: a.by, at: stamp() };
      const pr = state.prs?.find((/** @type {any} */ p) => p.id === state.pr), to = state.owner && waiters.some((/** @type {any} */ w) => w.who === state.owner) ? state.owner : '*';
      tell(`${a.by} pressed Execute: every question on the map is answered. Build the plan now from what was decided${pr ? `, on pull request ${pr.id}'s branch` : ''}.`, to);
      return true;
    },
    // Give me plan.md: instead of building, the same chat writes the plan out as plan.md at the repo's root,
    // and the map links to it; Execute stays for when the admin is ready
    /** @param {any} a */
    planmd(a) {
      const admin = state.people?.find((/** @type {any} */ p) => p.id === a.by)?.role === 'Admin';
      if (!admin || state.executed || !(state.prompt || state.owner) || state.calls.some((/** @type {any} */ c) => c.status === 'open')) return false;
      state.planmd = { by: a.by, at: stamp() };
      const to = state.owner && waiters.some((/** @type {any} */ w) => w.who === state.owner) ? state.owner : '*';
      tell(`${a.by} asked for plan.md instead of Execute: write this map's plan to plan.md at the repo's root (what changes, step by step, from what was decided, and what could break), then stop. Do not build; ${a.by} presses Execute when ready.`, to);
      return true;
    },
    // a quick change from a chat's Living Map tools (mcp.js): boxes, lines and questions added or updated by id,
    // the way a plan draws them, without a new session in the map's list
    // Instructions and Memory: only Claude adds them (Apply on its change, or the map tools); people change their
    // words or take them away, a box's ones only within their access
    /** @param {any} a */
    editmemory(a) {
      const m = state.memory?.find((/** @type {any} */ x) => x.id === a.id), text = String(a.text || '').trim().slice(0, 300), b = m?.box && nodeOf(m.box), sees = seesOf(a.by);
      if (!m || !text || (b && sees !== 'all' && b.area !== sees)) return false;
      m.text = text; m.by = a.by; m.at = Date.now(); return true;
    },
    /** @param {any} a */
    forget(a) {
      const i = (state.memory || []).findIndex((/** @type {any} */ x) => x.id === a.id), b = i >= 0 && state.memory[i].box && nodeOf(state.memory[i].box), sees = seesOf(a.by);
      if (i < 0 || (b && sees !== 'all' && b.area !== sees)) return false;
      state.memory.splice(i, 1); return true;
    },
    /** @param {any} a */
    edit(a) {
      if (![a.nodes, a.edges, a.calls, a.memory, a.unlink].some((x) => Array.isArray(x) && x.length) && a.tidy !== true && !a.start) return false;
      if (typeof a.start === 'string' && [...state.nodes, ...(a.nodes || [])].some((n) => n?.id === a.start)) state.start = a.start;
      draw({ nodes: a.nodes, edges: a.edges, calls: a.calls, unlink: a.unlink }, a.by, { kind: 'edit' });
      if (a.tidy === true) relayout();
      for (const m of (a.memory || []).slice(0, 10)) keepMemory(m, a.by);
      state.log.push({ at: Date.now(), who: a.by, action: 'drew', text: String(a.note || 'a quick change').slice(0, 200) });
      tell(`${a.by} changed the map: ${String(a.note || 'a quick change').slice(0, 200)}`);
      return true;
    },
  };

  // the map's API, at <map address>/api/...; false when the path is not one of them
  const access = (/** @type {any} */ who, /** @type {any} */ req) => permission(state, who, req);
  const allowed = (/** @type {any} */ who, /** @type {any} */ req) => !closed && !!access(who, req);
  // Admins can manage an unopened map without first joining its viewer list.
  const canDelete = (/** @type {any} */ who) => !!who && !removedFrom(state, who) && (managesAccess(state, who) || roleOf(who) === 'Admin');
  /** @param {any} req @param {any} res @param {any} p */
  async function handle(req, res, p, who = null) {
    if (!allowed(who, req)) { res.writeHead(403, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('You no longer have access to this project.'); return true; }
    const role = access(who, req), guest = !!linkRole(state, req) && role !== 'owner';
    const deny = () => { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This link does not allow that change.' })); return true; };
    if (guest && !(req.method === 'GET' && (['/', '/index.html', '/editing.js', '/api/state', '/api/events', '/api/file', '/api/history'].includes(p) || /^\/api\/history\/\w+$/.test(p))) && !(p === '/api/act' && req.method === 'POST' && role === 'edit')) return deny();
    if (p === '/api/cloud' && req.method === 'GET') {
      if (role !== 'owner') return deny();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(cloud?.status() || { configured: false })); return true;
    }
    if (p === '/api/cloud/delete' && req.method === 'POST') {
      if (role !== 'owner' || !who || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return deny();
      let a; try { a = JSON.parse(await body(req)); } catch {}
      if (a?.confirm !== true) return deny();
      try { await cloud?.remove(); }
      catch (/** @type {any} */ e) { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message })); return true; }
      changeSharing(state, who, 'restricted'); save(); push();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...state.linkSharing, cloud: cloud?.status() || { configured: false } })); return true;
    }
    if (p === '/api/sharing' && req.method === 'POST') {
      if (!who || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) return deny();
      let a; try { a = JSON.parse(await body(req)); } catch {}
      if (role !== 'owner' || !['view','edit','restricted'].includes(a?.mode)) return deny();
      if (cloud?.status().configured && (a.publish === true || cloud.status().published)) {
        try { await cloud.publish(a.mode); }
        catch (/** @type {any} */ e) { res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message })); return true; }
      }
      if (!changeSharing(state, who, a?.mode)) return deny();
      save(); push();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...state.linkSharing, cloud: cloud?.status() })); return true;
    }
    if (p === '/api/access' && req.method === 'POST') {
      const origin = req.headers.origin;
      if (!who || origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return true; }
      /** @type {any} */ let a = {}; try { a = JSON.parse(await body(req)); } catch {}
      if (!a || typeof a !== 'object' || Array.isArray(a)) { res.writeHead(400).end('Invalid access change'); return true; }
      if (!changeAccess(state, who, a.person, a.restore === true)) { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Only an owner can remove or restore a member. Owners keep their access.' })); return true; }
      save();
      if (!a.restore) {
        delete cursors[a.person];
        for (const r of clients) if (viewers.get(r) === a.person) { send(r, 'access-removed', {}); clients.delete(r); viewers.delete(r); r.end(); }
      }
      push(); here();
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}'); return true;
    }
    if (p === '/api/context-options' && req.method === 'GET') {
      const maps = (contextMaps?.(who) || []).filter((/** @type {any} */ m) => m.allowed()).map((/** @type {any} */ m) => {
        const d = describeMap(m.id,m.snapshot(),who);
        return {id:m.id,title:d.name,boxes:d.counts.boxes};
      });
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({maps})); return true;
    }
    if (p === '/api/context-description' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(describeMap(name || mapName(project) || 'map', state, who))); return true;
    }
    if (p === '/api/state') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(sharedState(state, role === 'owner', guest))); return true; }
    // Share as a file: the map's page with the map's own data written into it, named <title>.html. It opens on its
    // own anywhere, drawn from that data, and POST /api/maps/load brings the same data back as a map here
    if (p === '/api/file') {
      const exported = sharedState(state, false, guest); exported.nodes = withoutActions(exported.nodes);
      const data = JSON.stringify(exported).replace(/<\//g, '<\\/');
      const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
        .replace('</head>', `<meta name="lm-file" content="${new Date().toISOString()}">\n<script id="lm-data" type="application/json">${data}</script>\n</head>`);
      const file = `${String(state.title || 'map').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'map'}.html`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': `attachment; filename="${file.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(file)}` }).end(html);
      return true;
    }
    // the plan.md Claude wrote for this map, read from the repo's root
    if (p === '/api/planmd') {
      const f = project && path.join(project, 'plan.md');
      if (!f || !fs.existsSync(f)) res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Claude has not written plan.md yet. It appears here once it has.');
      else res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(fs.readFileSync(f));
      return true;
    }
    // the map's versions, newest first, and one version's boxes, lines and questions
    if (p === '/api/history') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(history)); return true; }
    const ver = p.match(/^\/api\/history\/(\w+)$/), vfile = ver && history.some((/** @type {any} */ h) => h.id === ver[1]) && path.join(HIST, `${ver[1]}.json`);
    if (ver) { if (!vfile || !fs.existsSync(vfile)) res.writeHead(404).end(); else res.writeHead(200, { 'content-type': 'application/json' }).end(fs.readFileSync(vfile)); return true; }
    // with ?session=, that chat now has these rules, so its next message carries only the news
    if (p === '/api/rules') {
      const rules = chatRules(address()), session = new URL(req.url, 'http://x').searchParams.get('session');
      if (session && rules) rulesSeen.set(session, crypto.createHash('sha1').update(rules).digest('hex'));
      res.writeHead(200, { 'content-type': 'text/plain' }).end(rules + '\n'); return true;
    }
    if (p === '/api/outbox') { res.writeHead(200, { 'content-type': 'text/plain' }).end(fs.existsSync(OUTBOX) ? fs.readFileSync(OUTBOX, 'utf8') : ''); return true; }
    // a chat's listener waits here until the map has something for that chat; after 4 minutes it gets
    // an empty answer and asks again
    if (p === '/api/wait') {
      const who = new URL(req.url, 'http://x').searchParams.get('session') || '';
      if (!who) { res.writeHead(400).end('session missing'); return true; }
      // the pane hears when a listener comes and goes, so it can say whether the chat is listening
      const drop = () => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); setTimeout(sendMirror); } clearTimeout(w.timer); };
      const w = { who, res, timer: setTimeout(() => { drop(); res.writeHead(200).end(''); }, 240_000) };
      waiters.push(w);
      res.on('close', drop);
      wake(); setTimeout(sendMirror);
      return true;
    }
    // a picture in the synced chat, only for the signed-in window of the person whose chat it is
    const pic = p.match(/^\/api\/chat-image\/([0-9a-f]{16})$/);
    if (pic) {
      const im = who && linkOf()?.owner === who ? picture(pic[1]) : null;
      if (!im) { res.writeHead(404).end(); return true; }
      res.writeHead(200, { 'content-type': im.type, 'cache-control': 'private, max-age=86400' }).end(im.buf); return true;
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      send(res, 'state', sharedState(state, role === 'owner', guest)); send(res, 'cursors', cursors);
      if (role === 'owner' && cloud) send(res, 'cloud', cloud.status());
      if (who && !guest) { const v = mirrorView(); if (v?.owner === who) send(res, 'mirror', v); }
      clients.add(res); clientAccess.set(res, { req, who, role, guest }); req.on('close', () => { clients.delete(res); clientAccess.delete(res); });
      // whoever signs in and opens the map joins its people, with the role the seed gives their name, if any
      if (who && !guest && !state.people?.some((/** @type {any} */ p) => p.id === who)) { (state.people ||= []).push({ id: who, role: roleOf(who), sees: 'all', joined: new Date().toISOString() }); save(); push(); }
      if (who && !guest) { viewers.set(res, who); res.on('close', () => { viewers.delete(res); clients.delete(res); here(); }); }
      here();
      return true;
    }
    if (p === '/api/act' && req.method === 'POST') {
      let /** @type {any} */ a = {};
      try { a = JSON.parse(await body(req)); } catch {}
      if (!a || typeof a !== 'object' || Array.isArray(a)) { res.writeHead(400).end(); return true; }
      if (guest && (!LINK_EDITS.has(a.type) || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json'))) return deny();
      // A link cannot impersonate a member or start Claude on this Mac.
      a.by = guest ? 'Guest' : String(who || a.by || 'You').slice(0, 40);
      if (a.type === 'cursor') { // ephemeral: where each person's pointer is, in map coordinates
        if (a.x === null) delete cursors[a.by]; else cursors[a.by] = { x: a.x, y: a.y, view: a.view, at: Date.now() };
        for (const r of clients) send(r, 'cursors', cursors);
        res.writeHead(200).end('{}');
        return true;
      }
      told = null;
      // going back or starting over always makes a version; with Auto-save off, what was not saved yet is kept first
      const big = a.type === 'restore' || a.type === 'reset';
      if (big && state.autosave === false) saveNow(a.by, 'Changes not saved yet, kept before going back', Date.now() - 1);
      const before = UNDOABLE.has(a.type) ? editSnapshot(state) : null;
      const result = a.type === 'undo' || a.type === 'redo' ? edits.apply(a.by, a.type, state, (n) => seesOf(a.by) === 'all' || n.area === seesOf(a.by)) : { ok: !!/** @type {Record<string, any>} */ (ACTS)[a.type]?.(a) };
      if (result.ok) {
        actions.reconcile(state.nodes.flatMap((/** @type {any} */ n) => [n, ...(n.inside?.nodes || [])]));
        updateBoxDates(state, undefined, a.by);
        if (before) edits.record(a.by, before, editSnapshot(state));
        remember(a.type, a.by, big); save(); push();
      }
      res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' }).end(result.ok ? JSON.stringify(a.created ? { id: a.created } : {}) : JSON.stringify({ error: result.error || 'That change could not be saved.' }));
      return true;
    }
    return false;
  }

  // one line for the list of maps at /
  const summary = () => {
    const online = cloud?.status(), inCloud = !!online?.published;
    const shared = inCloud ? ['view', 'edit'].includes(online.mode)
      : !!state.linkSharing?.token && ['view', 'edit'].includes(state.linkSharing.mode);
    return { title: state.title, boxes: state.nodes.length, open: state.calls.filter((/** @type {any} */ c) => c.status === 'open').length,
      at: fs.existsSync(STATE) ? fs.statSync(STATE).mtimeMs : 0, shared, cloud: inCloud };
  };

  // what waits on a person here, for the Inbox: questions for them, and comment threads waiting on
  // their reply (they wrote in it, or someone @-named them); only on boxes they may see
  const asks = (/** @type {any} */ who) => {
    const sees = seesOf(who), seen = (/** @type {any} */ id) => { const n = id && nodeOf(id); return !n || sees === 'all' || n.area === sees; };
    const mention = new RegExp(`@${who.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return [
      ...state.calls.filter((/** @type {any} */ c) => c.for === who && c.status === 'open' && seen(c.node))
        .map((/** @type {any} */ c) => ({ kind: 'call', id: c.id, node: c.node, text: c.ask || c.text, on: nodeOf(c.node)?.label || '', from: c.from || 'Claude' })),
      ...(state.comments || []).filter((/** @type {any} */ c) => !c.resolved && seen(c.node) && c.msgs.at(-1).who !== who && c.msgs.some((/** @type {any} */ m) => m.who === who || mention.test(m.text)))
        .map((/** @type {any} */ c) => ({ kind: 'comment', id: c.id, node: c.node, text: c.msgs.at(-1).text, on: nodeOf(c.node)?.label || '', from: c.msgs.at(-1).who })),
    ];
  };

  // a deleted map stops following its chat, stops any drawing it runs, and lets go of the pages watching it
  function close() {
    closed = true;
    for (const stop of activeAsks) stop();
    activeAsks.clear();
    actions.close();
    cloud?.close();
    mirror?.f.stop(); mirror = null;
    building?.(); queued.length = 0;
    for (const r of clients) r.end();
  }

  // Cloud requests use the same editing rules without local files, processes, or routes.
  /** @param {any} a */
  function editShared(a) {
    if (!LINK_EDITS.has(a.type) || a.type === 'cursor') return { ok: false };
    const before = UNDOABLE.has(a.type) ? editSnapshot(state) : null;
    const result = a.type === 'undo' || a.type === 'redo' ? edits.apply(a.by, a.type, state) : { ok: !!/** @type {Record<string, any>} */ (ACTS)[a.type]?.(a) };
    if (result.ok) { actions.reconcile(state.nodes.flatMap((/** @type {any} */ n) => [n, ...(n.inside?.nodes || [])])); updateBoxDates(state, undefined, a.by); if (before) edits.record(a.by, before, editSnapshot(state)); }
    return { ...result, ...(a.created ? { id: a.created } : {}) };
  }
  return { handle, summary, asks, build, close, allowed, access, canDelete, editShared,
    snapshot: () => structuredClone(state), undoSnapshot: () => edits.snapshot() };
}

const body = (/** @type {any} */ req) => new Promise((ok) => { let b = ''; req.on('data', (/** @type {any} */ c) => (b += c)); req.on('end', () => ok(b)); });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.css': 'text/css', '.svg': 'image/svg+xml' };

if (process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename) {
const { googleFinish, googleOn, googleStart, passwordCheck } = await import('./google.js');
const { MIN, users, recovery } = await import('./users.js');
const { handleRecovery } = await import('./recovery.js');
const DELETED = path.join(DIR, 'maps', '.deleted', 'index.json');
const deletedMaps = new Set((() => { try { return JSON.parse(fs.readFileSync(DELETED, 'utf8')); } catch { return []; } })());
const saveDeleted = () => { fs.mkdirSync(path.dirname(DELETED), { recursive: true }); fs.writeFileSync(`${DELETED}.tmp`, JSON.stringify([...deletedMaps])); fs.renameSync(`${DELETED}.tmp`, DELETED); };
/** @param {any} options */
function connectedMap(options) {
  let /** @type {any} */ map;
  const own = options.name || (options.project ? mapName(options.project) : '');
  const req = { url: '/', headers: { 'sec-fetch-site': 'same-origin' } };
  map = openMap({ ...options, contextMaps: (/** @type {any} */ who) => {
    if (!who || who === 'Guest' || !map.allowed(who, req)) return [];
    return everyMap().filter(([id]) => id !== own).map(([id, other]) => ({ id,
      allowed: () => map.allowed(who, req) && everyMap().some(([key, value]) => key === id && value === other) && other.allowed(who, req),
      snapshot: other.snapshot,
    }));
  } });
  return map;
}
/** @type {any} */ let main = PROJECT && deletedMaps.has(mapName(PROJECT)) ? null : connectedMap({ project: PROJECT, home: PROJECT ? path.join(PROJECT, '.living-map') : DIR });
// every code folder this server draws, by folder name: the one it started with, then each added since
// a map's address is its folder's name in lowercase letters, digits and dashes (AnurWebApp -> /anurwebapp/)
const projects = new Map(PROJECT && main ? [[mapName(PROJECT), main]] : []);
const folders = new Map(PROJECT && main ? [[mapName(PROJECT), PROJECT]] : []);
const remembered = () => { try { return JSON.parse(fs.readFileSync(PROJECTS, 'utf8')); } catch { return []; } };
const addProject = (/** @type {any} */ folder, restore = false) => {
  const name = mapName(folder);
  if (deletedMaps.has(name) && !restore) return false;
  if (folders.has(name)) return folders.get(name) === folder;
  if (!/^[a-z0-9-]+$/.test(name) || !fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) return false;
  if (deletedMaps.delete(name)) saveDeleted();
  projects.set(name, connectedMap({ project: folder, home: path.join(folder, '.living-map') }));
  if (folder === PROJECT) main = projects.get(name);
  folders.set(name, folder);
  return true;
};
if (PROJECT) for (const f of remembered()) addProject(f);
const named = new Map();
// a name no map here has yet, from the first words of what it is about (a prompt, a shared file's title)
/** @param {any} text */
function freeName(text) {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 4).join('-').slice(0, 40) || 'map';
  const taken = (/** @type {any} */ n) => deletedMaps.has(n) || fs.existsSync(path.join(DIR, 'maps', n)) || fs.existsSync(path.join(DIR, n)) || n === 'api' || (PROJECT && n === mapName(PROJECT));
  let name = base; for (let i = 2; taken(name); i++) name = `${base}-${i}`;
  return name;
}
const mapCalled = (/** @type {any} */ name) => named.get(name) ?? named.set(name, connectedMap({ name, home: path.join(DIR, 'maps', name) })).get(name);
// Existing archives are readable in Trash too, including maps removed before Restore was available.
const trashRecords = (/** @type {any} */ who) => {
  const bin = path.dirname(DELETED);
  if (!who || !fs.existsSync(bin)) return [];
  return fs.readdirSync(bin, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
    try {
      const archive = path.join(bin, d.name), state = JSON.parse(fs.readFileSync(path.join(archive, 'state.json'), 'utf8'));
      let meta; try { meta = JSON.parse(fs.readFileSync(path.join(archive, 'trash.json'), 'utf8')); } catch {}
      if (meta?.restored || removedFrom(state, who) || !(managesAccess(state, who) || demo().people.some((/** @type {any} */ p) => p.id === who && p.role === 'Admin'))) return [];
      const name = meta?.name || d.name.replace(/-(?:[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}|[a-z0-9]{8,12})$/, '');
      if (!/^[a-z0-9-]+$/.test(name)) return [];
      const project = meta ? meta.project : [PROJECT, ...remembered()].find((f) => f && mapName(f) === name) || '';
      return [{ id: d.name, name, title: state.title || name, at: meta?.at || fs.statSync(archive).mtimeMs, project, archive }];
    } catch { return []; }
  }).sort((a, b) => b.at - a.at);
};
// every map to choose from: the code folders' own, then each named one
const everyMap = () => {
  const MAPS = path.join(DIR, 'maps');
  const names = fs.existsSync(MAPS) ? fs.readdirSync(MAPS).filter((d) => /^[a-z0-9-]+$/.test(d) && !projects.has(d) && !deletedMaps.has(d)).sort() : [];
  return [...projects, ...names.map((d) => [d, mapCalled(d)])];
};

// a page, with the signed-in person written into it for the page's own script
const page = (/** @type {any} */ res, /** @type {any} */ file, /** @type {any} */ who, access = 'edit', shared = false) => res.writeHead(200, { 'content-type': 'text/html', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' })
  .end(fs.readFileSync(path.join(DIR, file), 'utf8').replace('</head>', [who && `<meta name="lm-user" content="${who.replace(/[^\w .-]/g, '')}">`,
    googleOn() && '<meta name="lm-google" content="1">', `<meta name="lm-access" content="${access}">`, shared && '<meta name="lm-shared" content="1">', '</head>'].filter(Boolean).join('\n')));
const cookieOf = (/** @type {any} */ req, /** @type {any} */ key) => (req.headers.cookie || '').split(/;\s*/).map((/** @type {any} */ c) => c.split('=')).find((/** @type {any} */ [k]) => k === key)?.[1] || '';

const server = http.createServer(async (req, res) => {
  const url = new URL(/** @type {string} */ (req.url), 'http://x');
  if (await handleRecovery(req, res, { users, recovery, port: PORT })) return;
  // Signing in. Every page asks who you are; a person without a password yet chooses one the first time.
  // The API stays open to this Mac's own tools, Claude's plans and the listeners, since the server only
  // answers on this Mac; a signed-in browser always acts as the person who signed in.
  const who = users.whoIs(cookieOf(req, 'lm_session'));
  /** @type {(code: any, data: any, cookie?: any) => any} */
  const json = (code, data, cookie) => res.writeHead(code, { 'content-type': 'application/json', ...(cookie ? { 'set-cookie': cookie } : {}) }).end(JSON.stringify(data));
  const signIn = (/** @type {any} */ name) => json(200, { name }, `lm_session=${users.start(name)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${users.maxAge}`);
  if (url.pathname === '/login') { res.setHeader('cache-control', 'no-store'); return page(res, 'login.html', who); }
  // Sign in with Google, through Living Map login (google.js); it comes back to this map's own address
  const signInError = (/** @type {any} */ e) => res.writeHead(302, { location: `/login?error=${encodeURIComponent(e)}` }).end();
  if (url.pathname === '/auth/google' && req.method === 'GET') {
    if (!googleOn()) return signInError('Google sign-in is not set up on this map.');
    const host = /^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '') ? req.headers.host : `localhost:${PORT}`;
    const next = url.searchParams.get('next') || '/';
    return res.writeHead(302, { location: googleStart(`http://${host}`, next.startsWith('/') && !next.startsWith('//') ? next : '/') }).end();
  }
  if (url.pathname === '/auth/done' && req.method === 'GET') {
    let got; try { got = await googleFinish(url.searchParams); } catch (/** @type {any} */ e) { return signInError(e.message); }
    // one of this map's people only when the login's list says so (an address, not a name, proves who someone is);
    // anyone else is a guest under their Google name, never seated as a person who happens to share it
    const name = got.listed ? users.person(got.name) || got.name : users.person(got.name) ? `${got.name} (guest)` : got.name;
    return res.writeHead(302, { location: got.next, 'set-cookie': `lm_session=${users.start(name)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${users.maxAge}` }).end();
  }
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let /** @type {any} */ a = {}; try { a = JSON.parse(await body(req)); } catch {}
    const one = users.person(a.name);
    // a person with no password yet: the page asks them to choose one
    if (one && !users.has(one)) return json(409, { first: one, min: MIN });
    // a password this Mac keeps, else one kept at Living Map login (someone with no Google account)
    const name = one && users.has(one) ? users.check(a.name, a.password) : await passwordCheck(a.name, a.password);
    if (!name) { await new Promise((ok) => setTimeout(ok, 400)); return json(401, { error: one ? 'That password is not right.' : 'That name and password are not right.' }); }
    return signIn(name);
  }
  if (url.pathname === '/api/first' && req.method === 'POST') {
    let /** @type {any} */ a = {}; try { a = JSON.parse(await body(req)); } catch {}
    const one = users.person(a.name);
    if (!one) return json(400, { error: 'There is no one called that on this map.' });
    if (users.has(one)) return json(400, { error: `${one} already has a password. Sign in instead.` });
    const name = users.first(one, a.password);
    return name ? signIn(name) : json(400, { error: `Use at least ${MIN} characters.` });
  }
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    users.end(cookieOf(req, 'lm_session'));
    return res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'lm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }).end('{}');
  }
  if (url.pathname === '/api/agent-login' && req.method === 'POST') return who ? json(200, { ok: await agent.signIn() }) : json(401, { ok: false });
  const isPage = req.method === 'GET' && !url.pathname.includes('/api/') && (url.pathname.endsWith('/') || url.pathname.endsWith('.html'));
  if (isPage && !who && !url.searchParams.has('share')) return res.writeHead(302, { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` }).end();
  const rootLinkAPI = !PROJECT && /^\/api\/(state|events|file|history(?:\/\w+)?|act)$/.test(url.pathname) && main.access(who, req);
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/version' && !who && !localTool(req) && !rootLinkAPI) return json(401, { error: 'Sign in first.' });
  // with a project, / lists every map to choose from: the project's own, then each named one
  if (PROJECT && url.pathname === '/') return page(res, 'maps.html', who);
  // a new map from a prompt on the list of maps: a blank canvas named after the prompt, and a new Claude Code
  // session in the Claude app drawing it, for the person who asked, signed in
  if (url.pathname === '/api/newmap' && req.method === 'POST') {
    if (!who) return json(401, { error: 'Sign in first.' });
    let /** @type {any} */ a = {}; try { a = JSON.parse(await body(req)); } catch {}
    const prompt = String(a.prompt || '').trim().slice(0, 4000);
    if (!prompt) return json(400, { error: 'Say what the map is about.' });
    const name = freeName(prompt);
    mapCalled(name).build({ prompt, by: who });
    return json(200, { name, href: `/${name}/` });
  }
  // Load a map file: the data a shared file carries (Share as a file) becomes a map here, named after its title,
  // exactly as it was saved, and opens
  if (url.pathname === '/api/maps/load' && req.method === 'POST') {
    if (!who) return json(401, { error: 'Sign in first.' });
    let s = null; try { s = JSON.parse(JSON.parse(await body(req)).data); } catch {}
    if (!s || typeof s !== 'object' || !Array.isArray(s.nodes) || !Array.isArray(s.edges)) return json(400, { error: 'Not a map file. Share as a file on a map makes one.' });
    delete s.linkSharing;
    const name = freeName(String(s.title || 'map'));
    const dir = path.join(DIR, 'maps', name);
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s));
    mapCalled(name);
    return json(200, { name, href: `/${name}/` });
  }
  // Archive only the map data, never its code folder. A tombstone also prevents old URLs and restarts recreating it.
  if (['/api/maps/trash', '/api/maps/delete'].includes(url.pathname) && req.method === 'POST') {
    if (!who) return json(401, { error: 'Sign in first.' });
    if (req.headers.origin !== `http://${req.headers.host}` || !String(req.headers['content-type'] || '').startsWith('application/json')) return json(403, { error: 'Open Living Map on this Mac to move a map to Trash.' });
    let /** @type {any} */ a = {}; try { a = JSON.parse(await body(req)); } catch {}
    const name = String(a.name || '');
    if (!/^[a-z0-9-]+$/.test(name) || deletedMaps.has(name)) return json(404, { error: 'That map is no longer in your list. Check Trash.' });
    const project = folders.get(name), dir = project ? path.join(project, '.living-map') : path.join(DIR, 'maps', name);
    if (!projects.has(name) && !fs.existsSync(dir)) return json(404, { error: 'That map is no longer in your list. Check Trash.' });
    const map = projects.get(name) || mapCalled(name);
    if (!map.canDelete(who)) return json(403, { error: 'Only a map owner can move this map to Trash.' });
    const bin = path.join(DIR, 'maps', '.deleted'), archive = path.join(bin, `${name}-${crypto.randomUUID()}`);
    try {
      fs.mkdirSync(bin, { recursive: true });
      fs.renameSync(dir, archive);
      try {
        fs.writeFileSync(path.join(archive, 'trash.json'), JSON.stringify({ name, project: project || '', at: Date.now() }));
        deletedMaps.add(name); saveDeleted();
      }
      catch (error) { deletedMaps.delete(name); fs.renameSync(archive, dir); throw error; }
    } catch { return json(500, { error: 'Could not move the map to Trash. Try again.' }); }
    map.close(); named.delete(name); projects.delete(name); folders.delete(name);
    if (map === main) main = null;
    return json(200, { name, trashId: path.basename(archive) });
  }
  if (url.pathname === '/api/maps/trash' && req.method === 'GET') {
    if (!who) return json(401, { error: 'Sign in first.' });
    return json(200, trashRecords(who).map(({ id, name, title, at }) => ({ id, name, title, at })));
  }
  if (url.pathname === '/api/maps/restore' && req.method === 'POST') {
    if (!who) return json(401, { error: 'Sign in first.' });
    if (req.headers.origin !== `http://${req.headers.host}` || !String(req.headers['content-type'] || '').startsWith('application/json')) return json(403, { error: 'Open Living Map on this Mac to restore a map.' });
    let /** @type {any} */ a = {}; try { a = JSON.parse(await body(req)); } catch {}
    const record = trashRecords(who).find((r) => r.id === a.id);
    if (!record) return json(404, { error: 'That map is not in your Trash.' });
    const { name, project, archive } = record, home = project ? path.join(project, '.living-map') : path.join(DIR, 'maps', name);
    if (projects.has(name) || (!deletedMaps.has(name) && named.has(name)) || fs.existsSync(path.join(home, 'state.json'))) return json(409, { error: 'A map already uses this address. Your trashed map is kept.' });
    if (project && !fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) return json(409, { error: 'The code folder is no longer available. Your trashed map is kept.' });
    const files = fs.readdirSync(archive).filter((f) => f !== 'trash.json' && !(f === 'server.log' && fs.existsSync(path.join(home, f))));
    if (files.some((f) => fs.existsSync(path.join(home, f)))) return json(409, { error: 'Existing files would be replaced. Your trashed map is kept.' });
    const moved = [], wasDeleted = deletedMaps.has(name);
    try {
      fs.mkdirSync(home, { recursive: true });
      for (const f of files) { fs.renameSync(path.join(archive, f), path.join(home, f)); moved.push(f); }
      deletedMaps.delete(name); saveDeleted();
      fs.writeFileSync(path.join(archive, 'trash.json'), JSON.stringify({ name, project, at: record.at, restored: true }));
    } catch {
      for (const f of moved.reverse()) fs.renameSync(path.join(home, f), path.join(archive, f));
      if (wasDeleted) { deletedMaps.add(name); saveDeleted(); }
      return json(500, { error: 'The map could not be restored. Try again.' });
    }
    if (project) {
      const map = connectedMap({ project, home }); projects.set(name, map); folders.set(name, project); if (project === PROJECT) main = map;
    } else mapCalled(name);
    return json(200, { name, title: record.title, href: `/${name}/` });
  }
  // which code this server runs: the package version, the build (commits in the clone), and whether main holds
  // newer ones; ?check=1 asks origin first (about a second), otherwise the answer is from the last check
  if (url.pathname === '/api/version') return (url.searchParams.get('check') ? checkLatest() : Promise.resolve()).then(() => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(VERSION)));
  // the Update button: everything Anur (the clone, so the server, the MCP tools and the skill's copy) is brought
  // to main. The answer comes once the download is done, so the page can show each step; then the server restarts
  if (url.pathname === '/api/update' && req.method === 'POST') {
    const send = (/** @type {any} */ a) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(a));
    const why = (await checkLatest()) === null ? 'this copy is not a git clone' : VERSION.latest ? 'already the latest' : await cannotUpdate();
    if (why) return send({ ok: false, why });
    const got = await pull();
    if (!got) return send({ ok: false, why: 'GitHub could not be reached' });
    send({ ok: true, pulled: got.count });
    if (got.count) setTimeout(restart, 50);
    return;
  }
  if (url.pathname === '/api/map-context' && req.method === 'GET') {
    if ((!who && !localTool(req)) || url.searchParams.has('share')) return json(403, { error: 'Sign in to discover other maps.' });
    const read = contextReader({ who, maps: () => everyMap().map(([id, map]) => ({ id, allowed: () => map.allowed(who, req), snapshot: map.snapshot })) });
    try {
      return json(200, read(url.searchParams.get('tool') || 'list_maps', { id: url.searchParams.get('id'), query: url.searchParams.get('query') || '', offset: Number(url.searchParams.get('offset') || 0),
        ...(url.searchParams.has('sections') ? {sections:/** @type {string} */ (url.searchParams.get('sections')).split(',')} : {}) }));
    } catch (/** @type {any} */ e) { return json(400, { error: e.message }); }
  }
  if (url.pathname === '/api/maps') {
    const list = everyMap().filter(([, m]) => m.allowed(who, req)).map(([name, m]) => ({ name, href: `/${name}/`, deletable: m.canDelete(who), ...m.summary() }));
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
  }
  // the Inbox: what waits on one person on every map, the maps with nothing for them left out
  if (url.pathname === '/api/inbox') {
    const asker = String(who || url.searchParams.get('as') || 'Duy').slice(0, 40);
    const list = (PROJECT ? everyMap() : [['', main], ...everyMap()])
      .filter(([, m]) => m.allowed(who, req)).map(([name, m]) => ({ name, href: `/${name}${name ? '/' : ''}`, title: m.summary().title, items: m.asks(asker) })).filter((x) => x.items.length);
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
  }
  // a chat opening the map from another code folder adds that folder to the list, and it stays there
  if (PROJECT && url.pathname === '/api/projects' && req.method === 'POST') {
    let /** @type {any} */ a = {}; try { a = JSON.parse(await body(req)); } catch {}
    const folder = a.folder ? path.resolve(String(a.folder)) : '', name = mapName(folder);
    if (!folder || !addProject(folder, true)) return json(400, { error: folders.has(name) ? `Another folder called ${name} is already on this map.` : 'Not a folder this map can draw.' });
    if (folder !== PROJECT && !remembered().includes(folder)) fs.writeFileSync(PROJECTS, JSON.stringify([...remembered(), folder], null, 1));
    return json(200, { name, href: `/${name}/` });
  }
  // /<name>/... is the map called <name>, unless a file of the page has that name
  const [, first, rest] = /** @type {RegExpMatchArray} */ (url.pathname.match(/^\/([^/]*)(.*)$/));
  if (deletedMaps.has(first) || (PROJECT && !first && !main)) return json(410, { error: 'This map is in Trash. Restore it from the home page.' });
  const own = projects.get(first);
  const isMap = /^[a-z0-9-]+$/.test(first) && first !== 'api' && (own || !fs.existsSync(path.join(DIR, first)));
  // the page asks its API by relative address, so a map's address ends in a slash
  if (isMap && !rest) return res.writeHead(302, { location: `/${first}/${url.search}` }).end();
  const map = !isMap ? main : own || mapCalled(first);
  const p = isMap ? rest : url.pathname;
  if (!map) return json(410, { error: 'This map is in Trash. Restore it from the home page.' });
  if (await map.handle(req, res, p, who)) return;
  if (p === '/' || p === '/index.html') return page(res, 'index.html', who, map.access(who, req), url.searchParams.has('share') && map.access(who, req) !== 'owner');
  // Private map files and server sources are never browser assets.
  if (!['/login.html', '/maps.html', '/editing.js'].includes(p)) return res.writeHead(404).end('not here');
  const file = path.join(DIR, p.replace(/^\/+/, ''));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('not here');
  res.writeHead(200, { 'content-type': /** @type {Record<string, any>} */ (types)[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
});

// ── keeps itself current ──
// Run from a git clone on main with no changes of its own, the server looks at GitHub when it starts and every
// ten minutes, pulls what is new, refreshes the skill's installed copy (chats.skillDir), and starts itself again in
// its place: every change is on disk already, pages and listeners reconnect by themselves. A copy without git
// (npx) is left to npx, which fetches the newest version each run. The commit it runs from goes in
// ~/.living-map-2/server.rev, which /anur-living-map reads to tell a server on older code.
const REPO = path.resolve(DIR, '..', '..');
const REV = path.join(os.homedir(), '.living-map-2', 'server.rev');
const git = (/** @type {any[]} */ ...a) => new Promise((ok) => execFile('git', ['-C', REPO, ...a], { encoding: 'utf8' }, (e, out) => ok(e ? null : out.trim())));
const EVERY = 10 * 60_000;
// the skill's copy is replaced file by file through a rename, never written in place: bash reads a running script
// by offset, so writing over open-map.sh while /anur-living-map runs would tear it mid-line
function refreshSkill() {
  const src = path.join(REPO, 'team', 'skill', 'anur-living-map'), dst = chats.skillDir('anur-living-map');
  for (const f of /** @type {string[]} */ (fs.readdirSync(src, { recursive: true }))) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) continue;
    fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, `${d}.new`); fs.renameSync(`${d}.new`, d);
  }
}
// asks origin how many commits main holds that this clone does not; null when this is not a clone or origin is out of reach
const GIT_NET = ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=4'];
async function checkLatest() {
  if ((await git('rev-parse', '--is-inside-work-tree')) !== 'true') return null;
  if ((await git(...GIT_NET, 'fetch', '-q', 'origin', 'main')) === null) return VERSION.latest;
  VERSION.behind = Number(await git('rev-list', '--count', 'HEAD..origin/main')) || 0;
  VERSION.latest = VERSION.behind === 0;
  return VERSION.latest;
}
// why a pull cannot run: the clone is on another branch or has changes of its own; '' when it can
async function cannotUpdate() {
  const branch = await git('branch', '--show-current');
  if (branch !== 'main') return branch ? `this copy is on the branch ${branch}, not main` : 'this copy is a preview, not main';
  // only edits to tracked files block a pull: a map's own .living-map/ folder or any other new file does not
  if (await git('status', '--porcelain', '--untracked-files=no')) return 'this copy has edits that are not on main';
  return '';
}
// pulls main, refreshes the skill's copy and starts this server again on the new code
// pulls main and refreshes the skill's copy; how many commits came in, or null when the pull failed
async function pull() {
  const was = await git('rev-parse', 'HEAD');
  if ((await git(...GIT_NET, 'pull', '-q', '--ff-only', 'origin', 'main')) === null) return null;
  const now = await git('rev-parse', 'HEAD'), count = now === was ? 0 : Number(await git('rev-list', '--count', `${was}..${now}`)) || 0;
  if (count) { try { refreshSkill(); } catch {} console.log(`update: ${count} new commits pulled, starting again: ${await git('log', '-1', '--format=%s')}`); }
  return { count };
}
// starts this server again on the code now in the clone
function restart() {
  server.closeAllConnections();
  server.close(() => { spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'inherit' }).unref(); process.exit(0); });
}
async function keepCurrent() { if ((await checkLatest()) === false && !(await cannotUpdate()) && (await pull())?.count) restart(); }
// build: how many commits the clone's history holds, so every merge moves it; a copy without git has none
/** @type {any} */ const VERSION = { version: JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8')).version, build: 0, commit: '', at: '', latest: null, behind: 0, started: Date.now() };
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => process.exit(0));
server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Living Map on http://localhost:${PORT}${PROJECT ? `  (${PROJECT})` : '  (demo)'}`);
  const head = await git('rev-parse', 'HEAD');
  if (head) { VERSION.commit = head.slice(0, 7); VERSION.at = (await git('log', '-1', '--format=%cs')) || ''; VERSION.build = Number(await git('rev-list', '--count', 'HEAD')) || 0; }
  if (head) { try { fs.mkdirSync(path.dirname(REV), { recursive: true }); fs.writeFileSync(REV, `${head}\n`); } catch {} }
  keepCurrent(); setInterval(keepCurrent, EVERY).unref();
});

}
