// The PM view: a map drawn as a classic mind map. The level's start sits on the left as a filled pill, its main topics
// to its right as outlined boxes on thick curved branches, and every deeper topic as words on a thin underline, joined
// to its parent by a thin bracket curve, siblings lined up in one column. It draws the same boxes and the same tree as
// the Engineer view (the lines `levelGraph` hands the page); only where each sits and how it looks change, so nothing
// here is stored and a teammate in the Engineer view sees no difference. Only the tree's own lines are drawn: a line
// between topics that are not parent and child shows in the Engineer view alone. A page module (see page-modules.js).

/** Where this browser keeps which view its person picked. */
export const MIND_VIEW_KEY = 'lm.view';

/** The view a saved choice names: 'pm', else the Engineer view, the default. @param {unknown} saved */
export function mindView(saved) {
  return saved === 'pm' ? 'pm' : 'engineer';
}

// how much room a topic takes beyond its words, at each depth, and the gaps between columns and between siblings
const MIND_PAD = [48, 32, 12], MIND_TALL = [48, 38, 28], MIND_COL = [64, 44, 36], MIND_ROW = [0, 22, 6];
const mindAt = (/** @type {number[]} */ list, /** @type {number} */ depth) => list[Math.min(depth, list.length - 1)];

/**
 * Where every topic of a level sits in the PM view. The tree is the one the Engineer view draws: lines followed out
 * from the level's centre, the first line to reach a box making it that box's child; a box no line reaches hangs off
 * the centre. Siblings keep the Engineer view's order, top to bottom (those left of their parent after those right of
 * it). Each topic's `x`, `y` is its middle, like a box's.
 * @param {{ nodes: any[], lines: any[], centre: string | null }} level
 * @param {(n: any, depth: number) => number} words how wide a topic's name is, at its depth, in map pixels
 * @returns {{ at: Map<string, { x: number, y: number, w: number, h: number, depth: number }>, parent: Map<string, string>, via: Map<string, any> }}
 *   `via` is the line that made each topic its parent's child
 */
export function mindLayout({ nodes, lines, centre }, words) {
  /** @type {Map<string, any>} */
  const at = new Map(), parent = new Map(), via = new Map();
  const by = new Map(nodes.map((n) => [n.id, n]));
  const root = centre && by.has(centre) ? centre : nodes[0]?.id;
  if (!root) return { at, parent, via };
  /** @type {Map<string, string[]>} */
  const kids = new Map(), out = new Map(), seen = new Set([root]), q = [root];
  for (const e of lines) if (by.has(e.from) && by.has(e.to) && e.from !== e.to) out.set(e.from, [...(out.get(e.from) || []), e]);
  const adopt = (/** @type {string} */ from, /** @type {string} */ to, /** @type {any} */ line) => {
    seen.add(to); parent.set(to, from); via.set(to, line); kids.set(from, [...(kids.get(from) || []), to]); q.push(to);
  };
  while (q.length) {
    const id = /** @type {string} */ (q.shift());
    for (const e of out.get(id) || []) if (!seen.has(e.to)) adopt(id, e.to, e);
    if (!q.length) { const loose = nodes.find((n) => !seen.has(n.id)); if (loose) adopt(root, loose.id, null); }
  }
  const depth = new Map([[root, 0]]);
  for (const id of [...parent.keys()]) {
    let d = 0, up = id;
    while (parent.has(up)) { up = /** @type {string} */ (parent.get(up)); d++; }
    depth.set(id, d);
  }
  const num = (/** @type {any} */ v) => (Number.isFinite(v) ? v : 0);
  for (const [from, list] of kids) {
    const p = by.get(from);
    list.sort((a, b) => {
      const A = by.get(a), B = by.get(b), sa = num(A.x) < num(p.x) ? 1 : 0, sb = num(B.x) < num(p.x) ? 1 : 0;
      return sa - sb || num(A.y) - num(B.y);
    });
  }
  /** @type {Map<string, any>} */
  const size = new Map(nodes.filter((n) => depth.has(n.id)).map((n) => {
    const d = /** @type {number} */ (depth.get(n.id));
    return [n.id, { w: Math.ceil(words(n, d)) + mindAt(MIND_PAD, d), h: mindAt(MIND_TALL, d), depth: d }];
  }));
  // how tall each topic's branch is: the topic itself, or its children stacked with a gap between them
  /** @type {Map<string, number>} */
  const tall = new Map();
  const tallOf = (/** @type {string} */ id) => tall.get(id) || 0;
  const measure = (/** @type {string} */ id) => {
    const list = kids.get(id) || [], gap = list.length ? mindAt(MIND_ROW, size.get(list[0]).depth) : 0;
    const under = list.reduce((s, k) => s + measure(k), 0) + gap * Math.max(0, list.length - 1);
    const t = Math.max(size.get(id).h, under);
    tall.set(id, t); return t;
  };
  measure(root);
  const place = (/** @type {string} */ id, /** @type {number} */ left, /** @type {number} */ top) => {
    const s = size.get(id), list = kids.get(id) || [];
    const x = left + s.w / 2;
    let y = top + tallOf(id) / 2;
    if (list.length) {
      const gap = mindAt(MIND_ROW, size.get(list[0]).depth);
      const under = list.reduce((sum, k) => sum + tallOf(k), 0) + gap * (list.length - 1);
      let t = top + (tallOf(id) - under) / 2;
      const next = left + s.w + mindAt(MIND_COL, s.depth);
      for (const k of list) { place(k, next, t); t += tallOf(k) + gap; }
      y = (at.get(list[0]).y + at.get(list[list.length - 1]).y) / 2;
    }
    at.set(id, { x: Math.round(x), y: Math.round(y), ...s });
  };
  const r = size.get(root);
  place(root, -r.w / 2, -tallOf(root) / 2);
  // the start stays where it is, at the middle of the map, whatever grows under it
  const dy = at.get(root).y;
  if (dy) for (const p of at.values()) p.y -= dy;
  return { at, parent, via };
}

/**
 * The curve from a topic to one of its children. Out of the start, a thick branch fans to the main topic's left side;
 * deeper, a thin bracket leaves the parent (a box's right side, or the end of a topic's underline), turns evenly
 * halfway across the gap, and carries on as the child's underline, one stroke, so line and underline always meet.
 * @param {{ x: number, y: number, w: number, h: number, depth: number }} a the parent
 * @param {{ x: number, y: number, w: number, h: number, depth: number }} b the child
 */
export function mindBranch(a, b) {
  const r = (/** @type {number} */ v) => Math.round(v * 10) / 10;
  if (b.depth <= 1) {
    const sx = a.x + a.w / 2 - Math.min(24, a.w / 4), sy = a.y, ex = b.x - b.w / 2, ey = b.y, dx = ex - sx;
    return `M${r(sx)} ${r(sy)}C${r(sx + dx * 0.25)} ${r(sy + (ey - sy) * 0.8)} ${r(sx + dx * 0.45)} ${r(ey)} ${r(ex)} ${r(ey)}`;
  }
  const sx = a.x + a.w / 2, sy = a.depth >= 2 ? a.y + a.h / 2 : a.y, ex = b.x - b.w / 2, ey = b.y + b.h / 2, mid = sx + (ex - sx) / 2;
  return `M${r(sx)} ${r(sy)}C${r(mid)} ${r(sy)} ${r(mid)} ${r(ey)} ${r(ex)} ${r(ey)}H${r(b.x + b.w / 2)}`;
}
