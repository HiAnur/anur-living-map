// What a drawing (the plan and edit actions, and an applied proposal) may change. A drawing writes a box's content:
// its words, place, size and what it opens into. The map's own record of a box is never a drawing's to write:
// its Action, who made it and when, and, for a box already on the map, what it holds inside and its planned task.
// A box's area only a sender who sees the whole map may set; a one-area member draws only on boxes in their
// area, and a new box takes it. Lines and removals follow the same areas.

// set only by the map, never by a drawing
const OWNED = ['action', 'by', 'source', 'createdAt', 'updatedAt', 'updatedBy', 'proposed', 'archived'];
// what a new box may bring and a box already on the map keeps as it is
const AT_BIRTH = ['inside', 'boxType', 'task'];

/**
 * A box as a drawing may write it, or null when the sender may not touch it. Boxes inside a new box are new too.
 * @param {any} n @param {Box | undefined} had the box on the map with its id @param {string} sees
 */
function drawable(n, had, sees) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return null;
  if (had && sees !== 'all' && had.area !== sees) return null;
  const box = Object.fromEntries(Object.entries(n).filter(([k]) => !OWNED.includes(k) && !(had && AT_BIRTH.includes(k)) && (k !== 'area' || sees === 'all')));
  if (!had && sees !== 'all') box.area = sees;
  if (box.inside) {
    const nodes = Array.isArray(box.inside.nodes) ? box.inside.nodes.map((/** @type {any} */ x) => drawable(x, undefined, sees)).filter(Boolean) : [];
    box.inside = { nodes, edges: Array.isArray(box.inside.edges) ? box.inside.edges : [] };
  }
  return box;
}

/**
 * The part of a drawing this sender may make: boxes cut to what a drawing writes, and lines, removals and unlinks
 * only between boxes in their area (a line to a box the same drawing adds counts as theirs).
 * @param {{ nodes?: any[], edges?: any[], remove?: any[], unlink?: any[] }} p @param {(id: any) => Box | undefined} nodeOf @param {string} sees
 */
export function guardDrawing(p, nodeOf, sees) {
  const nodes = (Array.isArray(p.nodes) ? p.nodes : []).map((n) => drawable(n, n && nodeOf(n.id), sees)).filter(Boolean);
  const drawn = new Set(nodes.map((/** @type {any} */ n) => n.id));
  const mine = (/** @type {any} */ id) => sees === 'all' || drawn.has(id) || nodeOf(id)?.area === sees;
  const line = (/** @type {any} */ e) => e && mine(e.from) && mine(e.to);
  return {
    ...p,
    nodes,
    ...(Array.isArray(p.edges) ? { edges: p.edges.filter(line) } : {}),
    ...(Array.isArray(p.unlink) ? { unlink: p.unlink.filter(line) } : {}),
    ...(Array.isArray(p.remove) ? { remove: p.remove.filter(mine) } : {}),
  };
}
