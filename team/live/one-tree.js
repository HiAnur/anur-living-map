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

/**
 * The map's own level (what a tidy lays out) as a change would leave it: boxes taken off and lines cut, boxes and
 * lines added or changed, new boxes being those not on the map at any depth.
 * @param {{ nodes?: any[], edges?: any[] }} level the map as it is
 * @param {{ nodes?: any[], edges?: any[], unlink?: any[], remove?: string[] }} change
 * @param {(id: string) => boolean} exists whether a box is on the map at any depth
 */
export function levelAfter(level, { nodes = [], edges = [], unlink = [], remove = [] }, exists) {
  const going = new Set(remove), cut = new Set(unlink.map((e) => `${e?.from}>${e?.to}`));
  const boxes = [...(level.nodes || []).filter((n) => !going.has(n.id)).map((n) => ({ ...n, ...nodes.find((m) => m?.id === n.id) })),
    ...nodes.filter((n) => n && !exists(n.id))];
  const ids = new Set(boxes.map((n) => n.id));
  /** @type {any[]} */
  const lines = (level.edges || []).filter((e) => !cut.has(`${e.from}>${e.to}`)).map((e) => ({ ...e }));
  for (const e of edges) { if (!e) continue; const had = lines.find((x) => x.from === e.from && x.to === e.to); if (had) Object.assign(had, e); else lines.push({ ...e }); }
  return { nodes: boxes, edges: lines.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

/** The reasons as one line a person or Claude reads. @param {string[]} trouble */
export const treeSaid = (trouble) => `it would not leave one tree: ${trouble.slice(0, 3).join('; ')}${trouble.length > 3 ? `; and ${trouble.length - 3} more` : ''}`;
