// Removed members stay removed when they reconnect or the map restarts.
/** @param {Members} state @param {Who} who */
export const managesAccess = (state, who) => !!who && state.people?.some((p) => p.id === who && p.role === 'Admin');
/**
 * Who owns a map, as its Admins: you, the one person on this Mac (`me`), on every map here, and whoever made it,
 * under the name they had then. A map kept from before maps recorded who made them has the Admins it was stored
 * with, and `before`.
 * @param {Members} state @param {{ me?: string | null, before?: string[] }} [o]
 * @returns {string[]}
 */
export function adminsOf(state, { me = null, before = [] } = {}) {
  const own = Array.isArray(state.admins) ? state.admins : [...(state.people || []).filter((p) => p.role === 'Admin').map((p) => p.id), ...before];
  return [...new Set([...(me ? [me] : []), ...own])];
}
/** @param {Members} state @param {Who} who */
export const removedFrom = (state, who) => !!who && (state.removedPeople || []).includes(who);
// A request from a program on this Mac (Claude's tools, curl), not a browser page. Browsers mark every request with
// sec-fetch-site; Node's fetch sends sec-fetch-mode alone, so that header must not count. A page also sends origin
// when it posts, and any cookie it holds, and neither may pass as a tool.
/** @param {Req} req */
export const localTool = (req) => !req.headers.origin && !req.headers['sec-fetch-site'] && !req.headers.cookie;
// The address this map answers at on this Mac, with its port. Any other Host (a name that resolves here only to
// reach this server) never acts as you.
export const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/;
/**
 * A request from a page of this map in a browser on this Mac, which acts as you with no sign-in. Another site open
 * in the same browser never passes: its requests carry its own Origin or say they are cross-site. A link from it
 * may open a page, as a link from anywhere may, and it cannot read what opens.
 * @param {Req} req
 */
export function fromThisMac(req) {
  const host = String(req.headers.host || ''), origin = req.headers.origin, site = req.headers['sec-fetch-site'];
  if (!LOCAL_HOST.test(host) || (origin !== undefined && origin !== `http://${host}`)) return false;
  if (site === 'same-origin' || site === 'none') return true;
  const path = String(req.url || '/');
  if (site === 'cross-site' || site === 'same-site') return req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && !path.includes('/api/') && !path.startsWith('/auth/');
  // a browser too old to say where a request came from: only a post that names this page as its origin
  return !site && origin === `http://${host}`;
}
/** @param {Members} state @param {Who} who @param {unknown} person @param {boolean} [restore] */
export function changeAccess(state, who, person, restore = false) {
  if (!managesAccess(state, who) || typeof person !== 'string' || person === who) return false;
  if (restore) {
    if (!removedFrom(state, person)) return false;
    state.removedPeople = /** @type {string[]} */ (state.removedPeople).filter((p) => p !== person);
    return true;
  }
  const member = /** @type {Person[]} */ (state.people).find((p) => p.id === person);
  if (!member || member.role === 'Admin') return false;
  state.removedPeople = [...new Set([...(state.removedPeople || []), person])];
  state.people = /** @type {Person[]} */ (state.people).filter((p) => p.id !== person);
  return true;
}
/**
 * Whether someone is an Engineer of this map (#362): an Admin, someone an Admin marked Engineer, or someone whose
 * role says so. Engineers, with whoever drew it, may redraw a system map or stop its drawing.
 * @param {Members} state @param {Who} who
 */
export const isEngineer = (state, who) => !!who && (state.people || []).some((p) => p.id === who && (p.role === 'Admin' || /** @type {any} */ (p).engineer === true || /\bengineer\b/i.test(String(p.role || ''))));
/** An Admin marks a member Engineer, or not. @param {Members} state @param {Who} who @param {unknown} person @param {boolean} on */
export function setEngineer(state, who, person, on) {
  if (!managesAccess(state, who) || typeof person !== 'string') return false;
  const member = /** @type {any} */ ((state.people || []).find((p) => p.id === person));
  if (!member || member.role === 'Admin') return false;
  if (on) member.engineer = true; else delete member.engineer;
  return true;
}
/** @param {Members} state @param {Who} who @param {Req} req */
export function canAccess(state, who, req) {
  if (who) return !removedFrom(state, who);
  // The server is loopback-only. Local tools keep access; a signed-out browser cannot bypass a removal by omitting its cookie.
  return !(state.removedPeople || []).length || localTool(req);
}
