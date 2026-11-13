// The centre of a system map: one box code adds for the system as a whole, named after the map, that the map starts
// from. Every repo hangs off it by a line with no words, as does an outside system nothing on the map calls; one that
// is called hangs under what calls it, and the people who use the system are not its parts and get no line from it.
// The page draws it as the empty circle with the system's parts around it, the way every level starts (page-hub.js).
// It stands for no code: it cites no facts, so checks, traces and a redraw's list of changes pass it by, and it is no
// repo, so hiding a repo someone may not read never hides it. A map drawn before it existed gets it when it is opened,
// and each level of a map whose levels were laid out in rows, and that nobody has moved a box on, is laid out again
// round its circle, once (`withTreeLayout`).

import { graphsOf } from './map-walk.js';
import { placeLevel, tidyLevel } from './project.js';

/** The centre's id. Every other box on a system map's top level is `system-<slug>`, so none can take it. */
export const CENTRE = 'system';
const SUB = 'The whole system: every repo and outside system on this map';
const DESC = `${SUB} hangs off it. Code adds it; it is not a repo and holds no code of its own.`;

/** Whether a box is the centre of a system map. @param {any} n */
export const isCentre = (n) => n?.id === CENTRE && n.origin === 'code';

/** Whether a line is one of the centre's own, which code keeps in step with the boxes. @param {any} e */
export const fromCentre = (e) => e?.from === CENTRE && e.origin === 'code';

/**
 * Gives a system map's top level its centre, and the centre a line to each repo, and each outside system nothing
 * calls, that code drew there and has none, taking away its own line to a person or to an outside system something
 * calls. A box someone drew by hand gets no line of its own; they may draw one. The centre is placed above the top
 * level's boxes, in the middle, when it has no place yet.
 * @param {{ nodes?: any[], edges?: any[], start?: string }} map the top level of a system map, changed in place
 * @param {string} [title] the map's title, the centre's name when it is added
 * @returns {boolean} whether anything changed
 */
export function withCentre(map, title = '') {
  const nodes = (map.nodes ||= []), edges = (map.edges ||= []);
  // drawn by code: marked so, or, on a map drawn before boxes were marked, standing for code
  const drawn = (/** @type {any} */ n) => n !== centre && (n.origin === 'code' || n.source?.kind === 'code');
  let changed = false, centre = nodes.find((n) => n?.id === CENTRE);
  if (!centre) {
    centre = { id: CENTRE, label: String(title || '').trim().slice(0, 80) || 'System', sub: SUB, desc: DESC, origin: 'code' };
    nodes.unshift(centre); changed = true;
  }
  if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) {
    const placed = nodes.filter((n) => drawn(n) && Number.isFinite(n.x) && Number.isFinite(n.y));
    const xs = placed.map((n) => n.x), top = Math.min(...placed.map((n) => n.y));
    Object.assign(centre, placed.length ? { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round(top - 190) } : { x: 0, y: 0 });
    changed = true;
  }
  const called = new Set(edges.filter((e) => e.from !== CENTRE && e.from !== e.to).map((e) => e.to));
  const off = (/** @type {any} */ n) => drawn(n) && n.kind !== 'actor' && (!!n.source?.repo || !called.has(n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kept = edges.filter((e) => !(fromCentre(e) && byId.has(e.to) && drawn(byId.get(e.to)) && !off(byId.get(e.to))));
  if (kept.length < edges.length) { edges.splice(0, edges.length, ...kept); changed = true; }
  const has = new Set(edges.filter((e) => e.from === CENTRE).map((e) => e.to));
  for (const n of nodes) if (off(n) && !has.has(n.id)) { edges.push({ from: CENTRE, to: n.id, origin: 'code' }); changed = true; }
  if (map.start !== CENTRE) { map.start = CENTRE; changed = true; }
  return changed;
}

/**
 * A renamed system map renames its centre too, unless someone gave the centre a name of its own.
 * @param {{ nodes?: any[] }} map @param {string} was the title before @param {string} title the title now
 */
export function renameCentre(map, was, title) {
  const centre = (map.nodes || []).find(isCentre);
  if (centre && centre.label === was) centre.label = title;
}

/**
 * Lays each level of a system map out round its circle, as Tidy up does, where it was laid out some other way (it
 * keeps no `centre`) and nobody has moved a box on it: a box someone moved stays where they put it, and so does the
 * rest of its level.
 * @param {any} state a system map, changed in place @returns {boolean} whether anything moved
 */
export function withTreeLayout(state) {
  let changed = false;
  /** @type {Map<any, string>} */
  const names = new Map();
  for (const g of graphsOf(state)) for (const n of g.nodes || []) if (n.inside) names.set(n.inside, String(n.label || ''));
  for (const level of graphsOf(state)) {
    if (level.centre || !(level.nodes || []).length || level.nodes.some((/** @type {any} */ n) => n.moved)) continue;
    const where = level === state ? { top: true, start: state.start, label: state.title } : { top: false, label: names.get(level) || '' };
    if (tidyLevel(level, where)) { placeLevel(level, where); changed = true; }
  }
  return changed;
}
