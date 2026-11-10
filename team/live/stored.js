// A map as the server keeps it in memory, from what was stored. A map written by hand, or by an older copy of
// the app, may lack lists the server reads without checking (the log it adds to, the questions it counts), and
// the server stopped on the first request that touched one. Each starts empty instead; nothing stored is
// changed or moved, and a map that has them is left as it is.

const LISTS = ['nodes', 'edges', 'calls', 'prs', 'log', 'comments'];
const RECORDS = ['threads', 'answers'];

/** @param {any} state what was stored @returns {MapState} */
export function withDefaults(state) {
  const s = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  for (const k of LISTS) if (!Array.isArray(s[k])) s[k] = [];
  for (const k of RECORDS) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
  return s;
}
