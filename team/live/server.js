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

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { actionBoxes, recoverAction } from './action-box.js';
import { closeBuild, openBuild } from './action-build.js';
import { pullRequestExists } from './action-evidence.js';
import { DATA } from './data-dir.js';
import { readPlannedTask } from './action-plan.js';
import { completionSchema, executionPrompt, readCompletion } from './action-completion.js';
import { checkCommand } from './commands.js';
import { agent, chats } from './agent.js';
import { systemJob } from './system-job.js';
import { askAgent } from './ask.js';
import { AUTO_PLAN_QUESTION, autoPlanAdditions, autoPlanPrompt } from './auto-plan.js';
import { appendProposed } from './proposal-layout.js';
import { askContext } from './ask-context.js';
import { boxActs } from './box-acts.js';
import { chatActs } from './chat-acts.js';
import { mapList } from './map-list.js';
import { mapsRoutes } from './maps-routes.js';
import { systemRoutes } from './system-routes.js';
import { PAGE_MODULES } from './page-modules.js';
import { signInRoutes } from './signin-routes.js';
import { readRoutes } from './read-routes.js';
import { selfUpdate } from './self-update.js';
import { jsonBody } from './request.js';
import { shareRoutes } from './share-routes.js';
import { callActs } from './call-acts.js';
import { drawing } from './drawing.js';
import { mapActs } from './map-acts.js';
import { actionActs } from './action-acts.js';
import { archiveActs } from './archive-acts.js';
import { planActs } from './plan-acts.js';
import { mineChat, pendingIn, proposalChecks } from './proposal-check.js';
import { placeNew, readProject, tidy, tidyTree } from './project.js';
import { managesAccess, removedFrom } from './access.js';
import { cloudMirror, installCloudData } from './cloud-client.js';
import { mayAct } from './permissions.js';
import { linkRole, localTool, permission, sharedState } from './sharing.js';
import { boxDates, editHistory, editSnapshot } from './editing.js';
import { withDefaults } from './stored.js';
import { allBoxesOf, allLinesOf, graphsOf } from './map-walk.js';

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
// the page's own modules, at their addresses beside the page
const PAGE_FILES = PAGE_MODULES.map((f) => `/${f}`);
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
  for (const n of allBoxesOf(state)) recoverAction(n);
  oneChat(state);
  const clients = new Set();
  const activeAsks = new Set();
  const clientAccess = new Map();
  const cursors = /** @type {Record<string, any>} */ ({}); // by name: {x, y, view, at}; never saved
  // who has this map open right now: each signed-in window, told to every window as people come and go
  const viewers = new Map();
  const here = () => { const names = [...new Set(viewers.values())]; for (const r of clients) send(r, 'here', names); };

  // Whose change a save records on the boxes it changed: the person for the length of their request, a link's guest
  // for an edit made on the cloud copy, and Claude for what the map does in the background (an Action preparing
  // or running), so a box's Last edited by is never blank beside a fresh date.
  let /** @type {string | null} */ acting = null;
  /** @param {string} by @param {() => any} change */
  const actingAs = (by, change) => { const was = acting; acting = by; try { return change(); } finally { acting = was; } };
  // a named map gets its folder the first time something is written to it
  const save = () => { updateBoxDates(state, undefined, acting || 'Claude'); if (memory || closed) return; fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); };
  const send = (/** @type {any} */ res, /** @type {any} */ ev, /** @type {any} */ data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const push = () => { for (const r of clients) {
    const c = clientAccess.get(r), role = permission(state, c.who, c.req);
    if (!role || role !== c.role) {
      send(r, role ? 'access-changed' : 'access-removed', {}); clients.delete(r); clientAccess.delete(r); r.end();
    } else send(r, 'state', sharedState(state, role === 'owner', c.guest, c.who));
  } };

  /** @type {any} */ const cloud = !memory ? cloudMirror({ home, read: () => state,
    write: (data) => { actingAs('Guest', () => { installCloudData(state, data); save(); }); push(); },
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
  // a system map drawing from code folders in the background, its progress in `state.drawing`
  const system = systemJob({ home, getState: () => state, save, push, agent });
  /**
   * A system map of code folders on this Mac or repos on GitHub, drawn from their code.
   * @param {{ title: string, folders?: string[], repos?: { owner: string, name: string }[], by: string }} job
   */
  function drawSystem({ title, folders = [], repos = [], by }) {
    state.title = state.renamed = title;
    return system.start({ folders, repos, by });
  }
  // Persist a manual map immediately, even before its first topic is named.
  function blank() {
    state.title = state.renamed = 'Untitled map';
    save();
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

  const allNodes = () => allBoxesOf(state);
  const allEdges = () => allLinesOf(state);
  const nodeOf = (/** @type {any} */ id) => allNodes().find((/** @type {any} */ n) => n.id === id);


  const { seesOf, askPrompt } = askContext({ getState: () => state, project, nodeOf, allNodes, allEdges });

  const actions = actionBoxes({
    nodeOf,
    // an archived Action still counts for the Actions that wait on it
    prerequisiteOf: (id) => nodeOf(id) || state.archived?.find((/** @type {any} */ x) => x.box.id === id)?.box,
    allNodes,
    canUse: (n, by) => !!by && by !== 'Guest' && !(state.removedPeople || []).includes(by) && (seesOf(by) === 'all' || n.area === seesOf(by)),
    context: (n, by) => askPrompt(by, n, 'Prepare this box as an action. Ask for missing information before it is ready.', (state.threads?.[`@${by}>${n.id}`] || []).filter((/** @type {any} */ m) => !m.thinking).slice(-20), true),
    ask: (request) => askAgent({ cwd:project || PROJECT || home, contextMaps:selectedContextMaps, who:request.by, prepare:true, connected:managesAccess(state,request.by), ...request }),
    changed: () => { save(); push(); },
    executionCwd: project || PROJECT || home,
    checkPull: (url) => pullRequestExists(url, project || PROJECT || home),
    // a build's worktree lives in the team map's data folder, never inside the project it changes
    builds: {
      open: (a, n) => openBuild({ project: project || PROJECT || home, root: path.join(DATA, 'worktrees', name || mapName(project || PROJECT) || 'map'), action: /** @type {any} */ (a), box: n }),
      close: (a, n) => closeBuild({ build: a.build, title: String(a.brief.goal).slice(0, 120),
        body: [`Opened by an Action on the team map, after ${a.by} pressed Execute.`, '', `**Box:** ${n?.label || ''}`, `**Goal:** ${a.brief.goal}`, `**Expected result:** ${a.brief.result}`, '', '**Steps**', ...a.brief.steps.map((/** @type {string} */ step, /** @type {number} */ i) => `${i + 1}. ${step}`)].join('\n') }),
    },
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
  // a line taken off the map, wherever it is drawn: the system or the inside of a box
  /** @param {any} from @param {any} to */
  function unlinkEdge(from, to) {
    let gone = false;
    for (const s of graphsOf(state)) {
      const before = (s.edges || []).length; s.edges = (s.edges || []).filter((/** @type {any} */ e) => !(e.from === from && e.to === to)); gone ||= s.edges.length < before;
    }
    return gone;
  }
  // a drawing (plan, edit or an applied proposal) reaching the map: drawing.js
  const draw = drawing({ getState: () => state, nodeOf, seesOf, unlinkEdge });

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
    for (const old of history.splice(KEEP_VERSIONS)) try { fs.unlinkSync(path.join(HIST, `${old.id}.json`)); } catch (e) { removeFailed(e, 'an old version'); }
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
    delete state.saves; try { fs.rmdirSync(SAVES); } catch (e) { removeFailed(e, 'the old saves folder'); }
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
    archived: state.archived || [], contextMapIds: state.contextMapIds || [], linked: state.linked || [], said: state.said || {}, removedPeople: state.removedPeople || [], linkSharing: state.linkSharing || { mode: 'restricted' },
    ...(state.renamed ? { title: state.renamed, renamed: state.renamed } : {}), ...(state.autosave === false ? { autosave: false } : {}) });

  const edits = editHistory(undoState);
  const UNDOABLE = new Set(['move', 'reparent', 'tidy', 'add', 'connect', 'remove', 'unlink', 'resize', 'relabel', 'renamebox', 'describebox', 'rename']);
  const ACTS = {
    ...boxActs({ getState: () => state, nodeOf, seesOf, sideOf, tell, pendingProposals, unlinkEdge, placeProposed }),
    ...chatActs({ getState: () => state, project, name, home, nodeOf, seesOf, askPrompt, proposal, check, checkAutoPlan, pendingProposals,
      selectedContextMaps, askAgent, agent, activeAsks, stamp, save, push, tell, ownsChat, mineChat, ownerOf, placeProposed, draw, actions,
      relayout, keepMemory, chats, startMirror, linkOf, savePicture, converse, sendMirror }),
    ...planActs({ getState: () => state, name, nodeOf, seesOf, draw, stamp, waiters, tell, relayout, keepMemory }),
    ...mapActs({ getState: () => state, contextMaps, nodeOf, tell, ownerOf, seesOf }),
    ...archiveActs({ getState: () => state, nodeOf, seesOf, tell }),
    ...callActs({ getState: () => state, nodeOf, seesOf, stamp, tell, ownerOf, allEdges }),
    ...actionActs({ getState: () => state, actions }),
    // the Save menu: Save now, and Auto-save, on unless someone turns it off; off, the map still changes for
    // everyone at once, but only Save now puts a version in History. One switch for the whole map.
    /** @param {Act<'savenow'>} a */
    savenow(a) { saveNow(a.by); return true; },
    /** @param {Act<'autosave'>} a */
    autosave(a) { state.autosave = a.on !== false; return true; },
    // starting over keeps the name someone gave the map; History keeps the map before
    reset() { state = { ...fresh(), ...kept() }; try { fs.unlinkSync(OUTBOX); } catch (e) { removeFailed(e, 'the outbox'); } return true; },
    // going back to a version in the history: the map takes that version's boxes, lines and questions, while chats,
    // comments and people stay as they are; going back is a version itself, so it can be undone the same way
    /** @param {Act<'restore'>} a */
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
  };

  // the map's API, at <map address>/api/...; false when the path is not one of them
  const access = (/** @type {any} */ who, /** @type {any} */ req) => permission(state, who, req);
  const allowed = (/** @type {any} */ who, /** @type {any} */ req) => !closed && !!access(who, req);
  // Admins can manage an unopened map without first joining its viewer list.
  const canDelete = (/** @type {any} */ who) => !!who && !removedFrom(state, who) && (managesAccess(state, who) || roleOf(who) === 'Admin');
  const shared = shareRoutes({ getState: () => state, cloud, save, push, cursors, clients, viewers, send, here });
  const reads = readRoutes({ getState: () => state, getHistory: () => history, contextMaps, name, project, mapName, chatRules, address, rulesSeen, OUTBOX, HIST });
  /** @param {any} req @param {any} res @param {any} p */
  async function handle(req, res, p, who = null) {
    if (!allowed(who, req)) { res.writeHead(403, { 'content-type': 'text/plain', 'cache-control': 'no-store' }).end('You no longer have access to this project.'); return true; }
    const role = access(who, req), guest = !!linkRole(state, req) && role !== 'owner';
    const deny = () => { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'This link does not allow that change.' })); return true; };
    if (guest && !(req.method === 'GET' && (['/', '/index.html', '/editing.js', '/api/state', '/api/events', '/api/file', '/api/history'].includes(p) || /^\/api\/history\/\w+$/.test(p))) && !(p === '/api/act' && req.method === 'POST' && role === 'edit')) return deny();
    if (await shared(req, res, p, { who, role, deny })) return true;
    if (reads(req, res, p, { who, role, guest })) return true;
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
      send(res, 'state', sharedState(state, role === 'owner', guest, who)); send(res, 'cursors', cursors);
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
      let /** @type {any} */ a = await jsonBody(req, {});
      if (!a || typeof a !== 'object' || Array.isArray(a)) { res.writeHead(400).end(); return true; }
      if (guest && (!mayAct(state, a, true) || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json'))) return deny();
      // A link cannot impersonate a member or start Claude on this Mac.
      a.by = guest ? 'Guest' : String(who || a.by || 'You').slice(0, 40);
      if (a.type === 'cursor') { // ephemeral: where each person's pointer is, in map coordinates
        if (a.x === null) delete cursors[a.by]; else cursors[a.by] = { x: a.x, y: a.y, view: a.view, at: Date.now() };
        for (const r of clients) send(r, 'cursors', cursors);
        res.writeHead(200).end('{}');
        return true;
      }
      const wrong = checkCommand(a);
      if (wrong) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: wrong })); return true; }
      // the standing each action needs (permissions.js); a refusal reads as any refused change
      if (!guest && !mayAct(state, a, false)) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'That change could not be saved.' })); return true; }
      told = null;
      // going back or starting over always makes a version; with Auto-save off, what was not saved yet is kept first
      const big = a.type === 'restore' || a.type === 'reset';
      if (big && state.autosave === false) saveNow(a.by, 'Changes not saved yet, kept before going back', Date.now() - 1);
      const before = UNDOABLE.has(a.type) ? editSnapshot(state) : null;
      const result = actingAs(a.by, () => {
        const done = a.type === 'undo' || a.type === 'redo' ? edits.apply(a.by, a.type, state, (n) => seesOf(a.by) === 'all' || n.area === seesOf(a.by)) : { ok: !!/** @type {Record<string, any>} */ (ACTS)[a.type]?.(a) };
        if (done.ok) {
          actions.reconcile(allBoxesOf(state));
          updateBoxDates(state, undefined, a.by);
          if (before) edits.record(a.by, before, editSnapshot(state));
          remember(a.type, a.by, big); save();
        }
        return done;
      });
      if (result.ok) push();
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
      at: fs.existsSync(STATE) ? fs.statSync(STATE).mtimeMs : 0, shared, cloud: inCloud,
      ...(state.drawing ? { system: state.drawing.status } : {}) };
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
    system.cancel();
    for (const r of clients) r.end();
  }

  // Cloud requests use the same editing rules without local files, processes, or routes.
  /** @param {any} a */
  function editShared(a) {
    if (a.type === 'cursor' || !mayAct(state, a, true)) return { ok: false };
    const wrong = checkCommand(a);
    if (wrong) return { ok: false, error: wrong };
    const before = UNDOABLE.has(a.type) ? editSnapshot(state) : null;
    const result = a.type === 'undo' || a.type === 'redo' ? edits.apply(a.by, a.type, state) : { ok: !!/** @type {Record<string, any>} */ (ACTS)[a.type]?.(a) };
    if (result.ok) { actions.reconcile(allBoxesOf(state)); updateBoxDates(state, undefined, a.by); if (before) edits.record(a.by, before, editSnapshot(state)); }
    return { ...result, ...(a.created ? { id: a.created } : {}) };
  }
  return { handle, summary, build, blank, close, allowed, access, canDelete, editShared, drawSystem,
    cancelDrawing: system.cancel, retryDrawing: system.retry,
    snapshot: () => structuredClone(state), undoSnapshot: () => edits.snapshot() };
}

// A file to remove that is already gone is fine; anything else (permissions, a full disk) is said once.
/** @param {any} e @param {string} what */
const removeFailed = (e, what) => { if (e?.code !== 'ENOENT' && e?.code !== 'ENOTEMPTY') console.error(`[map] could not remove ${what}: ${e?.message}`); };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.css': 'text/css', '.svg': 'image/svg+xml' };

if (process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename) {
const { googleFinish, googleOn, googleStart, passwordCheck } = await import('./google.js');
const { MIN, users, recovery } = await import('./users.js');
const { handleRecovery } = await import('./recovery.js');
const maps = mapList({ openMap, DIR, PROJECT, PROJECTS, mapName, demo });
const { deletedMaps, projects, mapCalled } = maps;

// a page, with the signed-in person written into it for the page's own script
const page = (/** @type {any} */ res, /** @type {any} */ file, /** @type {any} */ who, access = 'edit', shared = false) => res.writeHead(200, { 'content-type': 'text/html', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' })
  .end(fs.readFileSync(path.join(DIR, file), 'utf8').replace('</head>', [who && `<meta name="lm-user" content="${who.replace(/[^\w .-]/g, '')}">`,
    googleOn() && '<meta name="lm-google" content="1">', `<meta name="lm-access" content="${access}">`, shared && '<meta name="lm-shared" content="1">', '</head>'].filter(Boolean).join('\n')));
const cookieOf = (/** @type {any} */ req, /** @type {any} */ key) => (req.headers.cookie || '').split(/;\s*/).map((/** @type {any} */ c) => c.split('=')).find((/** @type {any} */ [k]) => k === key)?.[1] || '';
const signIns = signInRoutes({ users, MIN, googleFinish, googleOn, googleStart, passwordCheck, page, cookieOf, PORT });
const mapRoutes = mapsRoutes({ maps, DIR, PROJECT, PROJECTS, mapName });
const systemMaps = systemRoutes({ maps, PROJECT });

const server = http.createServer(async (req, res) => {
  const url = new URL(/** @type {string} */ (req.url), 'http://x');
  if (await handleRecovery(req, res, { users, recovery, port: PORT })) return;
  // Signing in. Every page asks who you are; a person without a password yet chooses one the first time.
  // The API stays open to this Mac's own tools, Claude's plans and the listeners, since the server only
  // answers on this Mac; a signed-in browser always acts as the person who signed in.
  const who = users.whoIs(cookieOf(req, 'lm_session'));
  /** @type {(code: any, data: any, cookie?: any) => any} */
  const json = (code, data, cookie) => res.writeHead(code, { 'content-type': 'application/json', ...(cookie ? { 'set-cookie': cookie } : {}) }).end(JSON.stringify(data));
  if (await signIns(req, res, url, who, json)) return;
  if (url.pathname === '/api/agent-login' && req.method === 'POST') return who ? json(200, { ok: await agent.signIn() }) : json(401, { ok: false });
  const isPage = req.method === 'GET' && !url.pathname.includes('/api/') && (url.pathname.endsWith('/') || url.pathname.endsWith('.html'));
  if (isPage && !who && !url.searchParams.has('share')) return res.writeHead(302, { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` }).end();
  const rootLinkAPI = !PROJECT && /^\/api\/(state|events|file|history(?:\/\w+)?|act)$/.test(url.pathname) && maps.main.access(who, req);
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/version' && !who && !localTool(req) && !rootLinkAPI) return json(401, { error: 'Sign in first.' });
  // with a project, / lists every map to choose from: the project's own, then each named one
  if (PROJECT && url.pathname === '/') return page(res, 'maps.html', who);
  if (await mapRoutes(req, res, url, who, json)) return;
  if (await systemMaps(req, res, url, who, json)) return;
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
  // /<name>/... is the map called <name>, unless a file of the page has that name
  const [, first, rest] = /** @type {RegExpMatchArray} */ (url.pathname.match(/^\/([^/]*)(.*)$/));
  if (deletedMaps.has(first) || (PROJECT && !first && !maps.main)) return json(410, { error: 'This map is in Trash. Restore it from the home page.' });
  const own = projects.get(first);
  const isMap = /^[a-z0-9-]+$/.test(first) && first !== 'api' && (own || !fs.existsSync(path.join(DIR, first)));
  // the page asks its API by relative address, so a map's address ends in a slash
  if (isMap && !rest) return res.writeHead(302, { location: `/${first}/${url.search}` }).end();
  const map = !isMap ? maps.main : own || mapCalled(first);
  const p = isMap ? rest : url.pathname;
  // the page's own modules are its code, the same for every map and visitor, so they load before any check of who
  // may see this map: a share link's key rides only on the page's own requests, never on the browser's imports
  if (PAGE_FILES.includes(p) && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(path.join(DIR, p.slice(1))));
  if (!map) return json(410, { error: 'This map is in Trash. Restore it from the home page.' });
  if (await map.handle(req, res, p, who)) return;
  if (p === '/' || p === '/index.html') return page(res, 'index.html', who, map.access(who, req), url.searchParams.has('share') && map.access(who, req) !== 'owner');
  // Private map files and server sources are never browser assets.
  if (!['/login.html', '/maps.html', '/editing.js'].includes(p)) return res.writeHead(404).end('not here');
  const file = path.join(DIR, p.replace(/^\/+/, ''));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('not here');
  res.writeHead(200, { 'content-type': /** @type {Record<string, any>} */ (types)[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
});

const { VERSION, checkLatest, cannotUpdate, pull, restart, whenListening } = selfUpdate(server);
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => process.exit(0));
server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Living Map on http://localhost:${PORT}${PROJECT ? `  (${PROJECT})` : '  (demo)'}`);
  await whenListening();
});

}
