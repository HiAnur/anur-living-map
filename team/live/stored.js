// A map as the server keeps it in memory, from what was stored. A map written by hand, or by an older copy of
// the app, may lack lists the server reads without checking (the log it adds to, the questions it counts), and
// the server stopped on the first request that touched one. Each starts empty instead; a map that has them is
// left as it is. A line whose box is no longer on its level goes: a box once left the map without its lines, and
// such a line draws nothing, yet still counts when the map is laid out or read.

import { graphsOf } from './map-walk.js';

const LISTS = ['nodes', 'edges', 'calls', 'prs', 'log', 'comments'];
const RECORDS = ['threads', 'answers'];

/** @param {any} state what was stored @returns {MapState} */
export function withDefaults(state) {
  const s = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  for (const k of LISTS) if (!Array.isArray(s[k])) s[k] = [];
  for (const k of RECORDS) if (!s[k] || typeof s[k] !== 'object' || Array.isArray(s[k])) s[k] = {};
  for (const level of graphsOf(s)) {
    if (!Array.isArray(level.edges) || !Array.isArray(level.nodes)) continue;
    const ids = new Set(level.nodes.map((/** @type {any} */ n) => n?.id));
    if (level.edges.some((/** @type {any} */ e) => !ids.has(e?.from) || !ids.has(e?.to))) level.edges = level.edges.filter((/** @type {any} */ e) => ids.has(e?.from) && ids.has(e?.to));
  }
  return s;
}
