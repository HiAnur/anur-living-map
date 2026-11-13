// What a drawing (the plan and edit actions, and an applied proposal) may change. A drawing writes a box's content:
// its words, place, size and what it opens into. The map's own record of a box is never a drawing's to write:
// its Action, who made it and when, and, for a box already on the map, what it holds inside and its planned task.
// A box's area only a sender who sees the whole map may set; a one-area member draws only on boxes in their
// area, and a new box takes it. Lines and removals follow the same areas. A drawing asks questions and may reword
// one still open, but never answers one: answering is the call action's, which records who answered and applies
// what the answer changes, and those changes reach only boxes the sender may change.

// set only by the map, never by a drawing
// (an action item's `for`, the words it came from and the box a person's items go under are action-items.js's)
const OWNED = ['action', 'by', 'source', 'createdAt', 'updatedAt', 'updatedBy', 'proposed', 'archived', 'for', 'from', 'itemsFor'];
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

// a question's answer, set only by the call action; and, once asked, who it is for and the box it is on
const ANSWERED = ['status', 'pickedId', 'picked', 'said', 'by', 'at'];
const ASKED = ['for', 'node'];

/**
 * A question as a drawing may write it, or null. `mine` says whether a box is one the sender may change.
 * @param {any} c @param {any} had the question on the map with its id @param {(id: any) => boolean} mine
 */
function askable(c, had, mine) {
  if (!c || typeof c !== 'object' || Array.isArray(c) || !c.id) return null;
  if (had ? had.status !== 'open' || !mine(had.node) : !mine(c.node)) return null;
  // what an answer changes: a box's line or state, or a line's state
  const reaches = (/** @type {any} */ fx) => !fx || typeof fx !== 'object' || ((!fx.node || mine(fx.node)) && (!fx.edge || String(fx.edge).split('>').every(mine)));
  const call = Object.fromEntries(Object.entries(c).filter(([k]) => !ANSWERED.includes(k) && !(had && ASKED.includes(k))));
  if (!had) call.status = 'open';
  for (const k of ['yes', 'no', 'confirm', 'dispute']) if (!reaches(call[k])) delete call[k];
  if (Array.isArray(call.options)) call.options = call.options.filter(reaches);
  return call;
}

/**
 * The part of a drawing this sender may make: boxes cut to what a drawing writes, lines, removals and unlinks only
 * between boxes in their area (a line to a box the same drawing adds counts as theirs), and questions asked, never
 * answered.
 * @param {{ nodes?: any[], edges?: any[], remove?: any[], unlink?: any[], calls?: any[] }} p @param {(id: any) => Box | undefined} nodeOf @param {string} sees
 * @param {(id: any) => any} [callOf] the map's question with an id
 */
export function guardDrawing(p, nodeOf, sees, callOf = () => undefined) {
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
    ...(Array.isArray(p.calls) ? { calls: p.calls.map((c) => askable(c, c && callOf(c.id), mine)).filter(Boolean) } : {}),
  };
}
