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
export function sharedState(state, owner = false, guest = false, who = null) {
  const result = { ...state, linkSharing: owner ? state.linkSharing || { mode: 'restricted' } : { mode: state.linkSharing?.mode || 'restricted' } };
  if (guest) {
    result.nodes = withoutActions(state.nodes || []);
  }
  if (guest) Object.assign(result, { archived: [], threads: {}, linked: [], said: {}, proposals: [], memory: [], removedPeople: [], contextMapIds: [], project: undefined });
  const sees = !guest && who ? state.people?.find((p) => p.id === who)?.sees : undefined;
  return sees && sees !== 'all' ? forArea(result, sees) : result;
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
