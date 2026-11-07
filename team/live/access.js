// Removed members stay removed when they reconnect or the map restarts.
export const managesAccess = (state, who) => !!who && state.people?.some((p) => p.id === who && p.role === 'Admin');
export const removedFrom = (state, who) => !!who && (state.removedPeople || []).includes(who);
// A request from a program on this Mac (Claude's tools, curl), not a browser page. Browsers mark every request with
// sec-fetch-site; Node's fetch sends sec-fetch-mode alone, so that header must not count. A page also sends origin
// when it posts and cookie when signed in, and neither may pass as a tool.
export const localTool = (req) => !req.headers.origin && !req.headers['sec-fetch-site'] && !req.headers.cookie;
export function changeAccess(state, who, person, restore = false) {
  if (!managesAccess(state, who) || typeof person !== 'string' || person === who) return false;
  if (restore) {
    if (!removedFrom(state, person)) return false;
    state.removedPeople = state.removedPeople.filter((p) => p !== person);
    return true;
  }
  const member = state.people.find((p) => p.id === person);
  if (!member || member.role === 'Admin') return false;
  state.removedPeople = [...new Set([...(state.removedPeople || []), person])];
  state.people = state.people.filter((p) => p.id !== person);
  return true;
}
export function canAccess(state, who, req) {
  if (who) return !removedFrom(state, who);
  // The server is loopback-only. Local tools keep access; a signed-out browser cannot bypass a removal by omitting its cookie.
  return !(state.removedPeople || []).length || localTool(req);
}
