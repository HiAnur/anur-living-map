// Whether boxes and lines read as one tree from the box a map starts from: what a reorganize must leave before the
// map lays itself out again. Every box but the start hangs under one box: the one line with no words into it, else
// the first line into it, as movedUp in map-walk.js reads it. Other lines with words are cross-links and stay. Two
// lines with no words into one box, a box nothing leads to, or boxes that hang under each other in a loop are not a
// tree, and the layout would scatter them.

/**
 * @param {{ id: string, label?: string }[]} nodes the boxes on the level, as they would be
 * @param {{ from: string, to: string, label?: string }[]} edges the lines on that level, as they would be, in order
 * @param {string | null | undefined} start the box the map starts from
 * @param {(n: { id: string, label?: string }) => string} [name] how a box is named in the reasons
 * @returns {string[]} why the result is not one tree, in plain words; empty when it is
 */
export function notOneTree(nodes, edges, start, name = (n) => n.label || n.id) {
  const by = new Map(nodes.map((n) => [n.id, n])), said = (/** @type {string} */ id) => name(/** @type {any} */ (by.get(id)));
  if (!start || !by.has(start)) return ['it names no box on the map to start from'];
  /** @type {string[]} */
  const why = [];
  /** @type {Map<string, string>} each box's parent */
  const up = new Map();
  for (const n of nodes) {
    if (n.id === start) continue;
    const into = edges.filter((e) => e.to === n.id && e.from !== n.id && by.has(e.from));
    const bare = into.filter((e) => !String(e.label ?? '').trim());
    if (!into.length) why.push(`${said(n.id)} would hang under nothing`);
    else if (bare.length > 1) why.push(`${said(n.id)} would hang under ${bare.length} boxes (${bare.map((e) => said(e.from)).join(', ')})`);
    else up.set(n.id, (bare[0] || into[0]).from);
  }
  // going up from any box reaches the start, unless it comes back to a box it passed
  const looped = new Set();
  for (const id of up.keys()) {
    /** @type {string[]} */
    const path = [];
    let at = id;
    while (at !== start && up.has(at) && !path.includes(at)) { path.push(at); at = /** @type {string} */ (up.get(at)); }
    if (at === start || !path.includes(at) || looped.has(at)) continue;
    const ring = path.slice(path.indexOf(at));
    for (const x of ring) looped.add(x);
    why.push(`${ring.map(said).join(', ')} would hang under each other in a loop`);
  }
  return why;
}
