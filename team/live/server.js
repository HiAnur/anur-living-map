// Living Map: shared maps on a tiny server. Every open window sees the same map; a drag, a Confirm or a Dispute
// in one window reaches the others at once. No dependencies.
//
//   node server.js [port] [--project <repo>]   default 4323
//   node server.js [port] --demo               the plan-first story (seed.json) at /, for showing the map
//   GET  /                              the list of maps (the story's map page with --demo)
//   GET  /api/state                     the whole map (seed + what people did)
//   GET  /api/events                    server-sent events: state after every change
//   GET  /api/outbox                    what the chat hears, plain words
//   GET  /api/rules                     how a chat answers the map (chat-rules.md); ?session= marks them as that chat's
//   POST /api/act  {type, by, ...}      move {id,x,y} · call {id, answer: confirm|dispute}
//                                       call {id, option} or {id, other: "own words"} on a call with options
//                                       ask {node, text} · cursor {x,y,view} · reset · open
//
// Each address is a map of its own: the project's map is at /<project folder>/ (and its API at /api/...),
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
import { traceDiagram } from './system-trace.js';
import { diagramOf } from './diagram.js';
import { onGitHub, repoOf } from './system-work.js';
import { sharedGithub } from './github.js';
import { askAgent } from './ask.js';
import { AUTO_PLAN_QUESTION, autoPlanAdditions, autoPlanPrompt } from './auto-plan.js';
import { appendProposed } from './proposal-layout.js';
import { drawServer } from './draw.js';
import { askContext } from './ask-context.js';
import { boxActs } from './box-acts.js';
import { chatActs } from './chat-acts.js';
import { mapList } from './map-list.js';
import { mapsRoutes } from './maps-routes.js';
import { systemRoutes } from './system-routes.js';
import { PAGE_MODULES } from './page-modules.js';
import { signInRoutes } from './signin-routes.js';
import { readRoutes } from './read-routes.js';
import { workFolder } from './wide-folder.js';
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
import { hubSizes, placeNew, readProject, tidy, tidyLayers, tidyTree } from './project.js';
import { adminsOf, isEngineer, managesAccess, removedFrom } from './access.js';
import { cloudMirror, installCloudData } from './cloud-client.js';
import { mayAct } from './permissions.js';
import { linkRole, localTool, permission, sharedState, withoutRepos } from './sharing.js';
import { boxDates, editHistory, editSnapshot } from './editing.js';
import { withDefaults } from './stored.js';
import { allBoxesOf, allLinesOf, graphsOf } from './map-walk.js';

// the port is the first argument when it is a number (`node server.js 4323 --project <repo>`); 4323 is what the skill, mcp.js and wait.js expect
const PORT = Number(/^\d+$/.test(process.argv[2] || '') ? process.argv[2] : process.env.PORT || 4323);
const DIR = import.meta.dirname;
// --project <folder>: draw that project from its own files, and keep the map's
// state beside it in <folder>/.living-map/. More code folders join with POST /api/projects {folder}, each at
// /<folder name>/, and are remembered in projects.json so they are still listed after a restart.
// --demo, with no project: the fixed story in seed.json at /, which is only for showing the map; a real install
// never sees its cast
const at = process.argv.indexOf('--project');
const PROJECT = at > 0 ? path.resolve(process.argv[at + 1]) : process.env.LIVING_MAP_PROJECT || '';
const DEMO = !PROJECT && process.argv.includes('--demo');
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
/**
 * `installOwner`: who owns this install (users.js), and so every repo's own map. `before`: the Admins a map kept
 * from before maps recorded who made them goes on having, besides the ones it was stored with. `at`: the address a
 * code folder's map answers at, when it is not the folder's own name.
 * @param {any} options
 */
export function openMap({ project = '', name = '', at = '', home, initialState, undoState, memory = false, contextMaps = null,
  installOwner = () => /** @type {string | null} */ (null), before = () => /** @type {string[]} */ ([]) }) {
  if (project) fs.mkdirSync(home, { recursive: true });
  // this map's address: its name, or its code folder's (map-list.js); none for the story at /
  const slug = name || at || (project ? mapName(project) : '');
  let closed = false;
  const STATE = path.join(home, 'state.json');
  const OUTBOX = path.join(home, 'outbox.md');
  const SAVES = path.join(home, 'saves');
  // a team map's people are whoever has signed in on it, from the moment they open it; nobody is listed who
  // never came. Its Admins are whoever made it, and on a repo's own map the owner of this install (adminsOf).
  // Everyone sees the whole map; only the story keeps its cast, their roles and their areas.
  const roleOf = (/** @type {any} */ id) => !project && !name ? demo().people.find((/** @type {any} */ p) => p.id === id)?.role
    : adminsOf(state, { project: !!project, owner: installOwner() }).includes(id) ? 'Admin' : undefined;
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
  const existed = !!initialState || fs.existsSync(STATE);
  let state = withDefaults(initialState ? structuredClone(initialState) : fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : fresh());
  // A map from before maps recorded who made them keeps its Admins, written down once so a name someone takes
  // later never becomes one. A new map starts with none: whoever makes it, or else first opens it, is its Admin.
  if ((project || name) && !Array.isArray(state.admins)) {
    state.admins = existed ? adminsOf(state, { before: before() }) : [];
    if (existed && !memory) fs.writeFileSync(STATE, JSON.stringify(state));
  }
  // A map is usable as extra context only while it remains checked in Brain.
  const selectedContextMaps = (/** @type {any} */ who) => (contextMaps?.(who) || []).filter((/** @type {any} */ m) => state.contextMapIds?.includes(m.id)).map((/** @type {any} */ m) => ({...m, allowed: () => state.contextMapIds?.includes(m.id) && m.allowed()}));
  const updateBoxDates = boxDates(state, !initialState && !fs.existsSync(STATE));
  // a map stored with the seed's cast, or with guests, keeps only those who joined by signing in; the rest come back the moment they do
  // An Admin is one by adminsOf alone; any other role a person was stored with stays theirs.
  if (!memory && (project || name)) state.people = (state.people || []).filter((/** @type {any} */ p) => p.joined).map((/** @type {any} */ p) => ({ ...p, role: roleOf(p.id) || (p.role === 'Admin' ? undefined : p.role), sees: 'all' }));
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
    } else send(r, 'state', sharedState(state, role === 'owner', c.guest, c.who, hiddenFor(c.guest ? null : c.who)));
  } };

  /** @type {any} */ const cloud = !memory ? cloudMirror({ home, read: () => state,
    write: (data) => { actingAs('Guest', () => { installCloudData(state, data); save(); }); push(); },
    notify: () => { for (const r of clients) send(r, 'cloud', cloudFor(clientAccess.get(r)?.role)); }
  }) : null;
  // Everyone's Share says where the map is kept; only an owner, who can publish or delete the online copy, is sent
  // its link and what went wrong with it.
  const cloudFor = (/** @type {any} */ role) => {
    const s = cloud.status();
    return role === 'owner' ? s : { configured: s.configured, published: s.published, mode: s.mode };
  };

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
  // here, headless, in the map's folder: the agent's own chat (agent.converse). Its only tools are this map's own,
  // pinned to this map (drawServer), so what it reads cannot make it act anywhere else. Their pane follows that
  // chat, and what the owner writes there continues it, one turn at a time; every turn answers the pane, so what
  // it draws arrives as a proposal.
  let /** @type {any} */ building = null; const /** @type {any} */ queued = [];
  const brief = () => [
    `You are drawing a map on Living Map, the team's shared map on this Mac. This map is "${name}", and your tools, living_map_read and living_map_change, work on it alone.`,
    'Draw what you are asked with living_map_change: boxes for the parts and lines between them. What you draw waits as a proposal, blue on the map, until the owner presses Apply.',
    'You have no other tools: no files, web or connected apps. Work from the map and what you are told, and say what you would need to look up.',
    'Your replies show in the chat beside the map: say in two or three short lines what you proposed and what you could not reach.',
  ].join('\n');
  /** @param {any} l @param {any} text */
  function converse(l, text) {
    if (building) { queued.push(text); return; }
    fs.mkdirSync(home, { recursive: true });
    const first = !l.started; l.started = true; save();
    answering.set(l.session, Date.now());
    const servers = { living_map: drawServer({ url: `http://localhost:${PORT}`, map: name || (project ? mapName(project) : ''), session: l.session }) };
    building = agent.converse({ cwd: home, session: l.session, first, title: `Living Map: ${state.title}`, system: brief(), prompt: text, servers,
      onClose: () => { building = null; answering.delete(l.session); if (queued.length) converse(l, queued.splice(0).join('\n\n')); } });
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
  // a system map notices new commits in its repos while nobody has it open
  const stopWatching = system.watch();
  /** The repos someone may not read on GitHub, cut from everything they receive of this map; no one is a guest. @param {string | null} who */
  const hiddenFor = (who) => system.hiddenFor(who, push);
  /** Whether an action names a box in a repo someone may not read: by its id, its node, its ends or the box asked about. @param {any} a @param {string | null} who */
  const touchesHidden = (a, who) => {
    const hidden = hiddenFor(who);
    if (!hidden.size) return false;
    const ids = [a.id, a.node, a.from, a.to, a.about, a.parent, a.into].filter((x) => typeof x === 'string');
    return ids.some((id) => { const n = nodeOf(id); return n && hidden.has(String(repoOf(state, n))); });
  };
  /** Where an Action's work on a box happens: on a system map, the box's repo; elsewhere the map's own folder (null). @param {any} n @param {string} by @param {boolean} build */
  const workOf = async (n, by, build) => (!project && state.drawing && n && repoOf(state, n) ? system.workFor(/** @type {string} */ (repoOf(state, n)), by, build) : null);
  /**
   * Why someone may not raise a build's pull request from this box, '' when they may: the box's repo on GitHub
   * (its system map's source, or the clone's origin) must let them push, as their own GitHub link says. A repo
   * not on GitHub opens no pull request, so it asks nothing.
   * @param {any} n @param {string} by @returns {Promise<string>}
   */
  async function canBuild(n, by) {
    const repo = !project && state.drawing && n ? repoOf(state, n) : null;
    const from = repo ? system.sourceOf(repo) : null;
    /** @type {{ owner: string, name: string } | null} */
    const gh = from && 'owner' in from ? /** @type {{ owner: string, name: string }} */ (from) : onGitHub(String(from && 'folder' in from ? from.folder : project || PROJECT || home));
    return gh ? sharedGithub().whyNoPush(by, gh.owner, gh.name) : '';
  }
  /**
   * A system map of code folders on this Mac or repos on GitHub, drawn from their code.
   * @param {{ title: string, folders?: string[], repos?: { owner: string, name: string }[], by: string }} job
   */
  function drawSystem({ title, folders = [], repos = [], by }) {
    state.title = state.renamed = title; state.admins = [by];
    return system.start({ folders, repos, by });
  }
  // Persist a manual map immediately, even before its first topic is named.
  /**
   * A blank map, owned by whoever made it; one that builds on a system map names it, and its chats read that map
   * as background.
   * @param {{ buildsOn?: { name: string, title: string }, by?: string }} [o]
   */
  function blank({ buildsOn, by } = {}) {
    state.title = state.renamed = 'Untitled map';
    if (by) state.admins = [by];
    if (buildsOn) { state.buildsOn = buildsOn; state.contextMapIds = [buildsOn.name]; }
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
    state.starting = { prompt, by, at: Date.now() }; state.admins = [by];
    save(); push();
    const q = `/anur-living-map map:${name} ${prompt}`;
    chats.openNew({ prompt: q, folder: home });
    watchNewChat();
  }
  // Looks for the chat a click opened, for two minutes from the click. The click is saved with the map, so a
  // server that restarts before the chat appears picks the search up again on start, and a chat that appeared
  // while it was down is found on the first look; otherwise the pane would say it is opening a chat that is open.
  function watchNewChat() {
    if (!state.starting) return;
    const { at, by } = state.starting, since = at - 2000;
    const look = () => {
      const file = state.starting && chats.findNewChat({ folder: home, since, holding: `map:${name}` });
      if (file) { ACTS.link({ session: chats.sessionOf?.(file) ?? path.basename(file, '.jsonl'), file, by }); save(); push(); }
      return !!file || !state.starting || Date.now() - at > 120e3;
    };
    if (look()) return;
    const timer = setInterval(() => { if (closed || look()) clearInterval(timer); }, 500);
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
  // The chats answering a request from the pane right now, by session, since when: from the moment a chat's listener
  // takes the request until it listens again (a chat the map runs itself, until its turn ends). Their direct
  // changes (edit, from living_map_change) arrive as proposals, so what was asked in the pane waits for Apply.
  const answering = new Map(), ANSWER_MS = 30 * 60_000;
  /** @param {unknown} session */
  const isAnswering = (session) => typeof session === 'string' && Date.now() - (answering.get(session) ?? -Infinity) < ANSWER_MS;
  // this map's address, for the rules a chat follows
  const address = () => `http://localhost:${PORT}${slug ? `/${slug}` : ''}`;
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
      for (const m of mine) if (m.said) { const s = state.said?.[w.who]?.find((/** @type {any} */ x) => x.id === m.said); if (s) s.handed = Date.now(); answering.set(w.who, Date.now()); }
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


  const { seesOf, askPrompt } = askContext({ getState: () => state, project, nodeOf, allNodes, allEdges, hiddenFor: (who) => hiddenFor(who) });

  const actions = actionBoxes({
    nodeOf,
    // an archived Action still counts for the Actions that wait on it
    prerequisiteOf: (id) => nodeOf(id) || state.archived?.find((/** @type {any} */ x) => x.box.id === id)?.box,
    allNodes,
    canUse: (n, by) => !!by && by !== 'Guest' && !(state.removedPeople || []).includes(by) && (seesOf(by) === 'all' || n.area === seesOf(by)),
    context: (n, by) => askPrompt(by, n, 'Prepare this box as an action. Ask for missing information before it is ready.', (state.threads?.[`@${by}>${n.id}`] || []).filter((/** @type {any} */ m) => !m.thinking).slice(-20), true),
    ask: (request) => askAgent({ cwd:workFolder(project || PROJECT, home), contextMaps:selectedContextMaps, who:request.by, prepare:true, connected:managesAccess(state,request.by),
      place: () => workOf(request.box, request.by, false), ...request }),
    changed: () => { save(); push(); },
    executionCwd: workFolder(project || PROJECT, home),
    // on a system map an Action works in its box's repo; a box in no repo has nowhere to run
    cannotRun: (n) => !project && state.drawing && !repoOf(state, n) ? 'This box is not inside one of the map\'s repos, so an Action here has nowhere to run.' : null,
    cwdFor: (n, by) => workOf(n, by, false),
    canBuild,
    reach: (tool) => agent.reach(tool),
    checkPull: (url) => pullRequestExists(url, project || PROJECT || home),
    // a build's worktree lives in the team map's data folder, never inside the project it changes
    builds: {
      open: async (a, n) => {
        const why = await canBuild(n, a.by);
        if (why) return { error: why };
        const w = await workOf(n, a.by, true);
        if (w && 'error' in w) return w;
        return openBuild({ project: w?.cwd || project || PROJECT || home, root: path.join(DATA, 'worktrees', slug || mapName(PROJECT) || 'map'), action: /** @type {any} */ (a), box: n });
      },
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
    const nodes = [...state.nodes.map((/** @type {any} */ n) => ({ ...n, ...plan.layout.find((/** @type {any} */ m) => m.id === n.id) })), ...fresh], edges = [...state.edges, ...plan.edges], start = plan.start || state.start;
    placeNew(nodes, edges, start, hubSizes(nodes, edges, start, !!state.drawing));
    for (const f of fresh) Object.assign(plan.nodes.find((/** @type {any} */ n) => n.id === f.id), { x: f.x, y: f.y });
  }
  // Claude's "tidy": Tidy up as if nobody had dragged a box, so every box is regrouped and rebalanced and the lines
  // read as one tree; the boxes are Claude's to place again until someone drags one
  function relayout() {
    if (!tidyTree(state.nodes, state.edges, null, () => false, state.start, hubSizes(state.nodes, state.edges, state.start, !!state.drawing)) && !(state.drawing && tidyLayers(state.nodes, state.edges))) tidy(state.nodes, state.edges);
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
    archived: state.archived || [], ...(Array.isArray(state.admins) ? { admins: state.admins } : {}), contextMapIds: state.contextMapIds || [], linked: state.linked || [], said: state.said || {}, removedPeople: state.removedPeople || [], linkSharing: state.linkSharing || { mode: 'restricted' },
    ...(state.renamed ? { title: state.renamed, renamed: state.renamed } : {}), ...(state.autosave === false ? { autosave: false } : {}) });

  const edits = editHistory(undoState);
  const UNDOABLE = new Set(['move', 'reparent', 'tidy', 'add', 'connect', 'remove', 'unlink', 'resize', 'relabel', 'renamebox', 'describebox', 'pointbox', 'rename']);
  const chatting = chatActs({ getState: () => state, project, name, home, nodeOf, systemCode: system.codeFor, seesOf, askPrompt, proposal, check, checkAutoPlan, pendingProposals,
    selectedContextMaps, askAgent, agent, activeAsks, stamp, save, push, tell, ownsChat, mineChat, ownerOf, placeProposed, draw, actions,
    relayout, keepMemory, chats, startMirror, linkOf, savePicture, converse, sendMirror });
  const ACTS = {
    ...boxActs({ getState: () => state, nodeOf, seesOf, sideOf, tell, pendingProposals, unlinkEdge, placeProposed }),
    ...chatting,
    ...planActs({ getState: () => state, name, nodeOf, seesOf, draw, stamp, waiters, tell, relayout, keepMemory, isAnswering,
      proposeFor: (a) => chatting.propose(a, 40) }),
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
  const shared = shareRoutes({ getState: () => state, cloud, save, push, cursors, clients, viewers, send, here, holdsPrivate: () => system.holdsPrivate() });
  const reads = readRoutes({ getState: () => state, getHistory: () => history, contextMaps, name: slug, project, mapName, chatRules, address, rulesSeen, OUTBOX, HIST, hiddenFor });
  // after ACTS, which linking the chat needs
  if (!memory) watchNewChat();

  /** @param {any} req @param {any} res @param {any} p */
  async function handle(req, res, p, who = null, pictureOf = (/** @type {string} */ _name) => '') {
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
      // listening again: the request it was handed is answered
      answering.delete(who);
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
      // whoever signs in and opens the map joins its people, as an Admin if the map is theirs (roleOf); the first to
      // open a named map nobody made becomes its Admin. They join before this window is followed, so it starts with
      // the role it keeps: joining as an Admin makes them an owner, and a window that saw that change would reload
      // as if its access had changed.
      if (who && !guest && !state.people?.some((/** @type {any} */ p) => p.id === who)) {
        if (name && !state.admins?.length) state.admins = [who];
        (state.people ||= []).push({ id: who, role: roleOf(who), sees: 'all', joined: new Date().toISOString() }); save(); push();
      }
      // their Google picture, kept on them as one of the map's people so everyone here sees it on their face
      const one = /** @type {any} */ (who && !guest ? state.people?.find((/** @type {any} */ p) => p.id === who) : null), face = one ? pictureOf(String(who)) : '';
      if (one && (one.picture || '') !== face) { if (face) one.picture = face; else delete one.picture; save(); push(); }
      const mine = access(who, req);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      send(res, 'state', sharedState(state, mine === 'owner', guest, who, hiddenFor(guest ? null : who))); send(res, 'cursors', cursors);
      if (cloud) send(res, 'cloud', cloudFor(mine));
      if (who && !guest) { const v = mirrorView(); if (v?.owner === who) send(res, 'mirror', v); }
      clients.add(res); clientAccess.set(res, { req, who, role: mine, guest }); req.on('close', () => { clients.delete(res); clientAccess.delete(res); });
      if (who && !guest) { viewers.set(res, who); res.on('close', () => { viewers.delete(res); clients.delete(res); here(); }); }
      here();
      return true;
    }
    // a system map's repos with commits newer than the drawing, among those the asker may read
    // "Trace a request" on a system map box: code follows the facts behind it hop by hop and the steps become the box's
    // sequence (system-trace.js), as the asker may read the repos it crosses; a member may trace a box in their area
    if (p === '/api/system-trace' && req.method === 'POST') {
      const /** @type {any} */ a = await jsonBody(req, {});
      const n = nodeOf(a?.id), sees = who && !guest ? seesOf(who) : null;
      const reply = (/** @type {number} */ code, /** @type {any} */ body) => { res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body)); return true; };
      if (!who || guest || !state.people?.some((/** @type {any} */ x) => x.id === who) || removedFrom(state, who)) return reply(403, { error: 'Only someone on this map can trace a request.' });
      if (!n || (sees !== 'all' && n.area !== sees)) return reply(404, { error: 'That box is not on the map, or not in your area.' });
      const got = system.trace(n.id, who);
      if (!got) return reply(409, { error: 'This map keeps no facts for that box yet. Draw it again, then trace.' });
      if (!got.steps.length) return reply(409, { error: 'Code shows no request leaving this box.' });
      n.diagram = diagramOf(traceDiagram(n.label, got.steps)); n.traceRepos = got.repos;
      tell(`${who} traced a request from ${n.label}`); save(); push();
      return reply(200, { steps: got.steps.length });
    }
    if (p === '/api/system-changed' && req.method === 'GET') {
      const repos = who && !guest ? await system.changed(who).catch((/** @type {any} */ e) => { console.error('[map] system changes', e); return []; }) : [];
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ repos })); return true;
    }
    if (p === '/api/act' && req.method === 'POST') {
      let /** @type {any} */ a = await jsonBody(req, {});
      if (!a || typeof a !== 'object' || Array.isArray(a)) { res.writeHead(400).end(); return true; }
      if (guest && (!mayAct(state, a, true) || req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json'))) return deny();
      // A link cannot impersonate a member or start Claude on this Mac.
      a.by = guest ? 'Guest' : String(who || a.by || 'You').slice(0, 40);
      // an edit from a program on this Mac, or one naming the chat that sent it, is the map's tools drawing for
      // Claude (mcp.js), and is held to Claude's rules whatever name it gives
      if (a.type === 'edit' && !guest && (!who || a.session)) a.by = 'Claude';
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
      // nothing may be done to a box drawn from a repo the person may not read on GitHub: they never see it
      if (touchesHidden(a, guest ? null : a.by)) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'That box is in a repo you can\'t read on GitHub.' })); return true; }
      told = null;
      // what a handler says back about the action (edit's proposal, or why it refused) is its own, never the sender's
      delete a.proposed; delete a.refused;
      // going back or starting over always makes a version; with Auto-save off, what was not saved yet is kept first
      const big = a.type === 'restore' || a.type === 'reset';
      if (big && state.autosave === false) saveNow(a.by, 'Changes not saved yet, kept before going back', Date.now() - 1);
      const before = UNDOABLE.has(a.type) ? editSnapshot(state) : null;
      const result = actingAs(a.by, () => {
        const done = a.type === 'undo' || a.type === 'redo' ? edits.apply(a.by, a.type, state, (n) => seesOf(a.by) === 'all' || n.area === seesOf(a.by)) : { ok: !!/** @type {Record<string, any>} */ (ACTS)[a.type]?.(a), error: a.refused };
        if (done.ok) {
          actions.reconcile(allBoxesOf(state));
          updateBoxDates(state, undefined, a.by);
          if (before) edits.record(a.by, before, editSnapshot(state));
          remember(a.type, a.by, big); save();
        }
        return done;
      });
      if (result.ok) push();
      const made = { ...(a.created ? { id: a.created } : {}), ...(a.proposed ? { proposed: a.proposed.id, ops: a.proposed.ops, dropped: a.proposed.dropped } : {}) };
      res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' }).end(JSON.stringify(result.ok ? made : { error: result.error || 'That change could not be saved.' }));
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
      // a system map says how many repos it was drawn from and when, so the list shows how current it is
      ...(state.drawing ? { system: state.drawing.status, repos: state.drawing.repos || 0,
        ...(state.drawing.at ? { drawn: state.drawing.at + (state.drawing.ms || 0) } : {}), ...(state.drawing.newCommits?.length ? { newCommits: state.drawing.newCommits.length } : {}) } : {}) };
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
    system.cancel(); stopWatching();
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
  // whether Claude is at work on this map now: a reply, an Action, a system map drawing, a new map being drawn
  const busy = () => activeAsks.size > 0 || !!building || system.running() || actions.busy();
  return { handle, summary, build, blank, close, allowed, access, canDelete, editShared, drawSystem, busy,
    /** may redraw this system map or stop its drawing: an Engineer (an Admin among them) or whoever drew it @param {string} who */
    mayRedraw: (who) => !!who && (state.drawing?.by === who || isEngineer(state, who)),
    cancelDrawing: system.cancel, retryDrawing: system.retry,
    applyRedraw: () => { const done = system.applyRedraw(); if (done) { save(); push(); } return done; },
    dropRedraw: () => { const done = system.dropRedraw(); if (done) { save(); push(); } return done; },
    /** the box a clone on this Mac has on this system map, if it was drawn from that repo @param {string} folder */
    repoBox: (folder) => state.drawing ? system.boxOf(folder) : null,
    snapshot: () => structuredClone(state), undoSnapshot: () => edits.snapshot(),
    /** the map as someone may read it, as background for another map: without the repos they may not read @param {string | null} who */
    snapshotFor: (who) => withoutRepos(structuredClone(state), hiddenFor(who)) };
}

// A file to remove that is already gone is fine; anything else (permissions, a full disk) is said once.
/** @param {any} e @param {string} what */
const removeFailed = (e, what) => { if (e?.code !== 'ENOENT' && e?.code !== 'ENOTEMPTY') console.error(`[map] could not remove ${what}: ${e?.message}`); };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.css': 'text/css', '.svg': 'image/svg+xml' };

if (process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename) {
const { googleFinish, googleOn, googleStart, passwordCheck } = await import('./google.js');
const { MIN, users, recovery } = await import('./users.js');
const { handleRecovery, mailReady } = await import('./recovery.js');
// A map from before maps recorded who made them keeps the story's Admin, where that name has signed in here, and
// the install's owner. An Admin's name nobody has used stays nobody's, so taking it later gives nothing.
const before = () => [...demo().people.filter((/** @type {any} */ p) => p.role === 'Admin' && users.known(p.id)).map((/** @type {any} */ p) => String(p.id)), users.owner()].filter((p) => !!p);
const maps = mapList({ openMap: (/** @type {any} */ o) => openMap({ ...o, installOwner: users.owner, before }), DIR, PROJECT, PROJECTS, mapName,
  adminsOf: (/** @type {any} */ state, /** @type {string} */ project) => adminsOf(state, { project: !!project, owner: users.owner(), before: before() }), DEMO });
const { deletedMaps, projects, mapCalled } = maps;

// a page, with the signed-in person written into it for the page's own script; the list of maps, which has no
// map to ask, is also told that person's role on the team
const page = (/** @type {any} */ res, /** @type {any} */ file, /** @type {any} */ who, access = 'edit', shared = false, role = '') => res.writeHead(200, { 'content-type': 'text/html', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' })
  .end(fs.readFileSync(path.join(DIR, file), 'utf8').replace('</head>', [who && `<meta name="lm-user" content="${who.replace(/[^\p{L}\p{N} ._-]/gu, '')}">`,
    role && `<meta name="lm-role" content="${role.replace(/[^\w .,-]/g, '')}">`, who && users.pictureOf(who) && `<meta name="lm-picture" content="${users.pictureOf(who)}">`, googleOn() && '<meta name="lm-google" content="1">', `<meta name="lm-access" content="${access}">`, shared && '<meta name="lm-shared" content="1">', '</head>'].filter(Boolean).join('\n')));
const cookieOf = (/** @type {any} */ req, /** @type {any} */ key) => (req.headers.cookie || '').split(/;\s*/).map((/** @type {any} */ c) => c.split('=')).find((/** @type {any} */ [k]) => k === key)?.[1] || '';
// a person's role on the team, which the list of maps and Settings show: no one map is there to ask
const teamRole = (/** @type {string} */ who) => who && who === users.owner() ? 'Owner' : '';
// what someone runs on this Mac for a link to choose a new password, when no email can carry one
const resetCommand = `node "${path.join(DIR, 'users.js')}" reset${PORT === 4323 ? '' : ` --port ${PORT}`}`;
const signIns = signInRoutes({ users, MIN, googleFinish, googleOn, googleStart, passwordCheck, page, cookieOf, PORT, recovery, roleOf: teamRole, mailReady, resetCommand });
const mapRoutes = mapsRoutes({ maps, DIR, PROJECT, PROJECTS, mapName, DEMO });
// the install's owner may draw a system map before any map makes them an Admin
const systemMaps = systemRoutes({ maps, team: () => { const owner = users.owner(); return owner ? [{ id: owner, role: 'Admin' }] : []; } });

const server = http.createServer(async (req, res) => {
  const url = new URL(/** @type {string} */ (req.url), 'http://x');
  // Signing in. Every page asks who you are; the first person on a new install creates the owner's account, and
  // everyone after joins by the owner's invite. The API stays open to this Mac's own tools, Claude's plans and the
  // listeners, since the server only answers on this Mac; a signed-in browser always acts as the person who signed in.
  const who = users.whoIs(cookieOf(req, 'lm_session'));
  if (await handleRecovery(req, res, { users, recovery, port: PORT, who })) return;
  /** @type {(code: any, data: any, cookie?: any) => any} */
  const json = (code, data, cookie) => res.writeHead(code, { 'content-type': 'application/json', ...(cookie ? { 'set-cookie': cookie } : {}) }).end(JSON.stringify(data));
  if (await signIns(req, res, url, who, json)) return;
  if (url.pathname === '/api/agent-login' && req.method === 'POST') return who ? json(200, { ok: await agent.signIn() }) : json(401, { ok: false });
  const isPage = req.method === 'GET' && !url.pathname.includes('/api/') && (url.pathname.endsWith('/') || url.pathname.endsWith('.html'));
  if (isPage && !who && !url.searchParams.has('share')) return res.writeHead(302, { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` }).end();
  const rootLinkAPI = DEMO && /^\/api\/(state|events|file|history(?:\/\w+)?|act)$/.test(url.pathname) && maps.main?.access(who, req);
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/version' && !who && !localTool(req) && !rootLinkAPI) return json(401, { error: 'Sign in first.' });
  // / lists every map to choose from: the code folders' own, then each named one; only the demo shows its story there
  if (!DEMO && url.pathname === '/') return page(res, 'maps.html', who, 'edit', false, teamRole(who));
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
  // a code folder's map that took its title's address answers to its folder's name too: pages move to the address,
  // and the API answers at both, for listeners and tools that name the map by its folder
  const alias = maps.aliases.get(first);
  if (alias && projects.has(alias) && req.method === 'GET' && !rest.startsWith('/api/')) return res.writeHead(302, { location: `/${alias}${rest || '/'}${url.search}` }).end();
  const own = projects.get(first) || (alias ? projects.get(alias) : undefined);
  const isMap = /^[a-z0-9-]+$/.test(first) && first !== 'api' && (own || !fs.existsSync(path.join(DIR, first)));
  // the page asks its API by relative address, so a map's address ends in a slash
  if (isMap && !rest) return res.writeHead(302, { location: `/${first}/${url.search}` }).end();
  const map = !isMap ? maps.main : own || mapCalled(first);
  const p = isMap ? rest : url.pathname;
  // the page's own modules are its code, the same for every map and visitor, so they load before any check of who
  // may see this map: a share link's key rides only on the page's own requests, never on the browser's imports
  if (PAGE_FILES.includes(p) && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(path.join(DIR, p.slice(1))));
  // with neither a project nor the demo, the server's own address holds no map: only the list and its pages
  const noMain = !isMap && !PROJECT && !DEMO;
  if (!map && !noMain) return json(410, { error: 'This map is in Trash. Restore it from the home page.' });
  if (map && await map.handle(req, res, p, who, users.pictureOf)) return;
  if (map && (p === '/' || p === '/index.html')) return page(res, 'index.html', who, map.access(who, req), url.searchParams.has('share') && map.access(who, req) !== 'owner');
  // Private map files and server sources are never browser assets.
  if (!['/login.html', '/maps.html', '/editing.js'].includes(p)) return res.writeHead(404).end('not here');
  const file = path.join(DIR, p.replace(/^\/+/, ''));
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end('not here');
  res.writeHead(200, { 'content-type': /** @type {Record<string, any>} */ (types)[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
});

// an update waits while Claude is at work on any map, so a restart never cuts a reply, an Action or a drawing short
const { VERSION, checkLatest, cannotUpdate, pull, restart, whenListening } = selfUpdate(server, () => maps.everyMap().some(([, m]) => m.busy?.()));
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => process.exit(0));
server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Living Map on http://localhost:${PORT}${PROJECT ? `  (${PROJECT})` : DEMO ? '  (demo)' : ''}`);
  await whenListening();
});

}
