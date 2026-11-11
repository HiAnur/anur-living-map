import crypto from 'node:crypto';

import { localTool, managesAccess, removedFrom } from './access.js';
import { allBoxesOf } from './map-walk.js';

export { localTool };
/** @param {Shared} state @param {Req} req */
export function linkRole(state, req) {
  const token = new URL(req.url || '/', 'http://localhost').searchParams.get('share');
  const sharing = state.linkSharing;
  return token && sharing?.token === token && ['view', 'edit'].includes(sharing.mode) ? sharing.mode : null;
}
/** @param {Shared} state @param {Who} who @param {Req} req */
export function permission(state, who, req) {
  if (removedFrom(state, who)) return null;
  if (managesAccess(state, who)) return 'owner';
  const role = linkRole(state, req);
  if (role) return role;
  if (new URL(req.url || '/', 'http://localhost').searchParams.has('share')) return null;
  return who || localTool(req) ? 'edit' : null;
}
/** @param {Shared} state @param {Who} who @param {string} mode */
export function changeSharing(state, who, mode) {
  if (!managesAccess(state, who) || !['restricted', 'view', 'edit'].includes(mode)) return false;
  state.linkSharing = mode === 'restricted' ? { mode } : { mode, token: state.linkSharing?.token || crypto.randomBytes(32).toString('hex') };
  return true;
}
// the actions a guest with an edit link may take: the `link` standing in permissions.js
export { LINK_EDITS } from './permissions.js';
/** @type {(nodes: Box[]) => Box[]} */
export const withoutActions = (nodes) => nodes.map(({ action, task, ...n }) => ({ ...n, ...(n.inside ? {inside:{...n.inside,nodes:withoutActions(n.inside.nodes)}} : {}) }));
/**
 * The map as one person receives it: a guest without Actions or anyone's chats, and a member who sees one area
 * with only that area's content (forArea). `who` is the person, unset for a program on this Mac.
 * @param {MapState} state @param {boolean} [owner] @param {boolean} [guest] @param {string | null} [who]
 */
export function sharedState(state, owner = false, guest = false, who = null, hidden = NONE) {
  const result = withoutRepos({ ...state, linkSharing: owner ? state.linkSharing || { mode: 'restricted' } : { mode: state.linkSharing?.mode || 'restricted' } }, hidden);
  if (guest) {
    result.nodes = withoutActions(state.nodes || []);
  }
  if (guest) Object.assign(result, { archived: [], threads: {}, linked: [], said: {}, proposals: [], memory: [], removedPeople: [], contextMapIds: [], project: undefined });
  const sees = !guest && who ? state.people?.find((p) => p.id === who)?.sees : undefined;
  return sees && sees !== 'all' ? forArea(result, sees) : result;
}

/** @type {Set<string>} */
const NONE = new Set();
// what a box drawn from a repo the viewer may not read keeps: where it is, never what it is
const UNNAMED = ['id', 'x', 'y', 'w', 'h', 'moved'];
export const PRIVATE_REPO = 'A private repo';

/**
 * The map as someone who may not read some of its repos on GitHub receives it (#362). A box drawn from such a
 * repo keeps only its place and becomes "A private repo", unnamed, with nothing inside it; its lines keep their
 * ends but lose their words; and everything written about it or anything inside it (comments, questions, notes,
 * side chats, log lines, proposals) is left out. A version from History is cut the same way.
 * @param {any} state @param {Set<string>} hidden the repos, by name, this viewer may not read
 */
export function withoutRepos(state, hidden) {
  if (!hidden?.size) return state;
  /** @type {Set<string>} */
  const away = new Set();
  /** @param {any[]} nodes @param {boolean} inHidden */
  const mark = (nodes, inHidden) => { for (const n of nodes || []) { const here = inHidden || hidden.has(n?.source?.repo); if (here) away.add(n.id); mark(n.inside?.nodes, here); } };
  mark(state.nodes, false);
  if (!away.size) return state;
  const line = (/** @type {any} */ e) => away.has(e.from) || away.has(e.to) ? (({ label: _, ...rest }) => rest)(e) : e;
  /** @param {any} n @returns {any} */
  const box = (n) => away.has(n.id) ? { ...Object.fromEntries(UNNAMED.filter((k) => k in n).map((k) => [k, n[k]])), label: PRIVATE_REPO, hiddenRepo: true }
    : n.inside ? { ...n, inside: { ...n.inside, nodes: (n.inside.nodes || []).map(box), edges: (n.inside.edges || []).map(line) } } : n;
  const near = (/** @type {any} */ id) => !id || !away.has(id);
  const callOn = new Map((state.calls || []).map((/** @type {any} */ c) => [c.id, c.node]));
  return {
    ...state,
    nodes: (state.nodes || []).map(box),
    edges: (state.edges || []).map(line),
    comments: (state.comments || []).filter((/** @type {any} */ c) => near(c.node) && (c.view === 'system' || near(c.view))),
    calls: (state.calls || []).filter((/** @type {any} */ c) => near(c.node)),
    memory: (state.memory || []).filter((/** @type {any} */ m) => near(m.box)),
    log: (state.log || []).filter((/** @type {any} */ l) => near(l.node) && near(callOn.get(l.call))),
    archived: (state.archived || []).filter((/** @type {any} */ x) => near(x.box?.id) && !hidden.has(x.box?.source?.repo)),
    threads: Object.fromEntries(Object.entries(state.threads || {}).filter(([k]) => near(k.split('>')[1]))),
    proposals: (state.proposals || []).filter((/** @type {any} */ p) => [...(p.plan?.nodes || []).map((/** @type {any} */ n) => n.id), ...(p.plan?.remove || [])].every(near)),
    ...(state.start && away.has(state.start) ? { start: undefined } : {}),
  };
}

// what the page needs to draw a box outside your area, locked, under its name
const OUTLINE = ['id', 'label', 'x', 'y', 'w', 'h', 'area', 'kind', 'icon', 'moved'];

/**
 * The map as someone who sees one area receives it. A box outside it is only its outline: its name and place, so
 * the page can draw it locked. What is written about such a box (a line's words, its comments, questions, notes,
 * Action, side chats, log lines, an archived Action) is left out. A version from History is cut the same way.
 * @param {any} state @param {string} sees
 */
export function forArea(state, sees) {
  const all = allBoxesOf(state);
  const away = new Set(all.filter((/** @type {any} */ n) => n.area !== sees).map((/** @type {any} */ n) => n.id));
  const line = (/** @type {any} */ e) => away.has(e.from) || away.has(e.to) ? (({ label: _, ...rest }) => rest)(e) : e;
  /** @param {any} n @returns {any} */
  const box = (n) => away.has(n.id) ? Object.fromEntries(OUTLINE.filter((k) => k in n).map((k) => [k, n[k]]))
    : n.inside ? { ...n, inside: { ...n.inside, nodes: (n.inside.nodes || []).map(box), edges: (n.inside.edges || []).map(line) } } : n;
  const near = (/** @type {any} */ id) => !id || !away.has(id);
  const callOn = new Map((state.calls || []).map((/** @type {any} */ c) => [c.id, c.node]));
  return {
    ...state,
    nodes: (state.nodes || []).map(box),
    edges: (state.edges || []).map(line),
    comments: (state.comments || []).filter((/** @type {any} */ c) => near(c.node) && (c.view === 'system' || near(c.view))),
    calls: (state.calls || []).filter((/** @type {any} */ c) => near(c.node)),
    memory: (state.memory || []).filter((/** @type {any} */ m) => near(m.box)),
    log: (state.log || []).filter((/** @type {any} */ l) => near(l.node) && near(callOn.get(l.call))),
    archived: (state.archived || []).filter((/** @type {any} */ x) => x.box?.area === sees),
    threads: Object.fromEntries(Object.entries(state.threads || {}).filter(([k]) => near(k.split('>')[1]))),
    proposals: (state.proposals || []).filter((/** @type {any} */ p) => [...(p.plan?.nodes || []).map((/** @type {any} */ n) => n.id), ...(p.plan?.remove || [])].every(near)),
  };
}
