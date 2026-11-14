// The centre of every level of a map: a small empty circle, ringed in orange, with the boxes hanging off it in a tree
// left and right. On a map's top level the circle is its start box (on a system map, the box code adds for the whole
// system, system-centre.js); inside a box, or where the start box holds what a circle has no room to show, it is a
// circle standing for the level, drawn but never stored as a box. Its name is already at the top of the page, so the
// circle carries none. The page draws a level, and project.js lays it out, from the same `levelGraph`, so Tidy up, a
// new box's place, folding and which lines are cross-links agree at every level. A page module (see page-modules.js).

/** How wide and how tall the circle is, in map pixels. */
export const HUB_SIZE = 28;
/** The id of a circle that stands for a level, no box of its own: no box id holds an at sign. */
export const LEVEL_CENTRE = '@centre';

/**
 * Whether a box is drawn as the centre circle: a level's own circle, or the start box of a map's top level, unless it
 * holds something the circle has no room to show (boxes inside it, a diagram, an Action).
 * @param {any} n the box
 * @param {{ start: string | null | undefined, top: boolean }} map where the map starts, and whether this is its top level
 */
export function isHub(n, { start, top }) {
  return !!n && (!!n.virtual || (top && !!start && n.id === start && !n.proposed && !n.inside && !n.diagram && !n.action));
}

/**
 * The box a level starts from: the one given, else of the boxes no line comes into, the one with the most boxes under
 * it, the first drawn on a tie, so the first box put on an empty map is the start.
 * @param {{ id: string }[]} nodes @param {{ from: string, to: string }[]} edges @param {string | null} [start]
 */
export function startOf(nodes, edges, start = null) {
  const ids = new Set(nodes.map((n) => n.id));
  if (start && ids.has(start)) return start;
  const out = new Map(), into = new Set();
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) { out.set(e.from, [...(out.get(e.from) || []), e.to]); into.add(e.to); }
  const reach = (/** @type {string} */ id) => { const seen = new Set([id]), q = [id]; while (q.length) for (const k of out.get(q.shift()) || []) if (!seen.has(k)) { seen.add(k); q.push(k); } return seen.size; };
  let best = null, most = 0;
  for (const n of nodes) if (!into.has(n.id)) { const r = reach(n.id); if (r > most) { best = n.id; most = r; } }
  return best;
}

/**
 * A level as the map draws it and lays it out. Its centre is the start box when that can be the circle (a map's top
 * level only); else a circle standing for the level, at `level.centre` (above the middle of its boxes until a Tidy up
 * places it), with a line to each box nothing leads to, and to one box of any loop those never reach. `lines` are what
 * the tree is made of: those, the level's own lines, and, for a box the centre still does not reach, its line out
 * turned round, so it hangs under the box it points to (a person under the repo they use). A tree is made from them
 * by following lines out from the centre, the first line to reach a box making it that box's child.
 * @param {{ nodes?: any[], edges?: any[], centre?: { x: number, y: number } }} level
 * @param {{ top: boolean, start?: string | null, label?: string }} o whether this is the map's top level, its start box, and the name of what the level stands for
 * @returns {{ nodes: any[], edges: any[], lines: any[], centre: string | null }} `edges` are the lines to draw: the level's own, and its circle's
 */
export function levelGraph(level, { top, start = null, label = '' }) {
  const nodes = level.nodes || [], edges = level.edges || [];
  if (!nodes.length) return { nodes, edges, lines: edges, centre: null };
  const ids = new Set(nodes.map((n) => n.id)), own = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const first = top ? startOf(nodes, own, start) : null, box = nodes.find((n) => n.id === first);
  /** @type {any[]} */
  const all = [...nodes], drawn = [];
  let centre = box && isHub(box, { start: first, top }) ? box.id : null;
  if (!centre) {
    const placed = nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), xs = placed.map((n) => n.x);
    const at = Number.isFinite(level.centre?.x) && Number.isFinite(level.centre?.y) ? { x: level.centre?.x, y: level.centre?.y }
      : placed.length ? { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round(Math.min(...placed.map((n) => n.y)) - 190) } : { x: 0, y: 0 };
    centre = LEVEL_CENTRE;
    all.unshift({ id: LEVEL_CENTRE, label, virtual: true, ...at });
    const into = new Set(own.map((e) => e.to));
    for (const n of nodes) if (!into.has(n.id)) drawn.push({ from: LEVEL_CENTRE, to: n.id, virtual: true });
  }
  const lines = [...drawn, ...own], flipped = [];
  for (;;) {
    const out = new Map(), seen = new Set([centre]), q = [centre];
    for (const e of [...lines, ...flipped]) out.set(e.from, [...(out.get(e.from) || []), e.to]);
    while (q.length) for (const k of out.get(q.shift()) || []) if (!seen.has(k)) { seen.add(k); q.push(k); }
    if (seen.size === all.length) break;
    // a box the tree does not reach yet: under the box it points to, else, on a circle's own level, off the circle
    const hang = own.find((e) => !seen.has(e.from) && seen.has(e.to));
    if (hang) { flipped.push({ ...hang, from: hang.to, to: hang.from, flip: `${hang.from}>${hang.to}` }); continue; }
    const loose = nodes.find((n) => !seen.has(n.id));
    if (centre !== LEVEL_CENTRE || !loose) break;
    const line = { from: LEVEL_CENTRE, to: loose.id, virtual: true };
    drawn.push(line); lines.unshift(line);
  }
  return { nodes: all, edges: [...drawn, ...edges], lines: [...lines, ...flipped], centre };
}

/**
 * The level a click on the circle folds the map to: the main topics (level 1), or on a system map, where every repo
 * already hangs right off the circle, the circle alone (level 0). When the map shows that much already, every box again.
 * @param {number} shown the level showing now @param {number} deepest the deepest level the map has @param {boolean} [code] whether the map is drawn from code
 */
export function hubLevel(shown, deepest, code = false) {
  const to = code ? 0 : 1;
  return shown === to && deepest > to ? deepest : to;
}

/**
 * What the circle says on hover, where a box would show its name: the map's start box's name, its description, and
 * what a click does.
 * @param {string} name @param {string} summary @param {boolean} folded whether the map is folded to what a click shows
 * @param {boolean} [code] whether the map is drawn from code, where a click folds it to the circle
 */
export function hubHint(name, summary, folded, code = false) {
  return [[name, summary].filter(Boolean).join('\n'), folded ? 'Click to show every box' : code ? 'Click to fold the map to this circle' : 'Click to show only the main topics'].join('\n\n');
}
