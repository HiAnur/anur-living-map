import crypto from 'node:crypto';

import { localTool, managesAccess, removedFrom } from './access.js';

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
export const LINK_EDITS = new Set(['move', 'reparent', 'tidy', 'add', 'connect', 'remove', 'unlink', 'resize', 'relabel', 'renamebox', 'describebox', 'rename', 'undo', 'redo', 'comment', 'reply', 'resolve', 'cursor']);
/** @type {(nodes: Box[]) => Box[]} */
export const withoutActions = (nodes) => nodes.map(({ action, task, ...n }) => ({ ...n, ...(n.inside ? {inside:{...n.inside,nodes:withoutActions(n.inside.nodes)}} : {}) }));
/** @param {MapState} state @param {boolean} [owner] @param {boolean} [guest] */
export function sharedState(state, owner = false, guest = false) {
  const result = { ...state, linkSharing: owner ? state.linkSharing || { mode: 'restricted' } : { mode: state.linkSharing?.mode || 'restricted' } };
  if (guest) {
    result.nodes = withoutActions(state.nodes || []);
  }
  if (guest) Object.assign(result, { threads: {}, linked: [], said: {}, proposals: [], memory: [], removedPeople: [], contextMapIds: [], project: undefined });
  return result;
}
