// Removed members stay removed when they reconnect or the map restarts.
export const managesAccess = (state, who) => !!who && state.people?.some((p) => p.id === who && p.role === 'Admin');
export const removedFrom = (state, who) => !!who && (state.removedPeople || []).includes(who);
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
  // The server is loopback-only. Existing local command-line map tools keep access;
  // signed-out browser requests cannot bypass a removal by omitting their cookie.
  return !(state.removedPeople || []).length || !req.headers.origin && !req.headers['sec-fetch-mode'] && !req.headers.cookie;
}
