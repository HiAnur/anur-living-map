// The PM view: a map drawn as a classic mind map. The level's start is an outlined title box, its main topics
// on either side as outlined boxes on thick curved branches, and deeper information as words on a thin underline, joined
// to its parent by a thin bracket curve, siblings lined up in one column. Actions stay boxes at every depth. It draws the same tree as
// the Engineer view (the lines `levelGraph` hands the page); only where each sits and how it looks change, so nothing
// here is stored and a teammate in the Engineer view sees no difference. Only the tree's own lines are drawn: a line
// between topics that are not parent and child shows in the Engineer view alone. A page module (see page-modules.js).

/** Where this browser keeps which view its person picked. */
export const MIND_VIEW_KEY = 'lm.view';

export const MIND_LAYOUTS = [
  ['clockwise', 'Clockwise'], ['counterclockwise', 'Counterclockwise'],
  ['balanced', 'Both sides'], ['right', 'Right'], ['left', 'Left'],
];

/** @param {unknown} saved */
export function mindLayoutChoice(saved) {
  return MIND_LAYOUTS.some(([id]) => id === saved) ? String(saved) : 'right';
}

/** Small diagrams show the direction and reading order before the map moves. @param {string} layout */
export function mindLayoutIcon(layout) {
  const box = (/** @type {number} */ x, /** @type {number} */ y, w = 13, h = 8, root = false) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5" fill="${root ? 'var(--flag-orange)' : 'currentColor'}"/>`;
  const branch = (/** @type {string} */ d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
  let drawing;
  if (layout === 'right' || layout === 'left') {
    drawing = branch('M25 24H33M33 8V40M33 8H42M33 24H42M33 40H42') +
      [4, 20, 36].map((y) => box(42, y)).join('') + box(3, 17, 22, 14, true);
    if (layout === 'left') drawing = `<g transform="translate(64 0) scale(-1 1)">${drawing}</g>`;
  } else {
    drawing = branch('M25 22C17 22 23 8 12 8M25 26C17 26 23 40 12 40M39 22C47 22 41 8 52 8M39 26C47 26 41 40 52 40') +
      [5, 46].flatMap((x) => [4, 36].map((y) => box(x, y))).join('') + box(21, 17, 22, 14, true);
    const arrow = (/** @type {number} */ x, /** @type {boolean} */ up) =>
      `<path d="M${x} ${up ? 30 : 18}v${up ? -9 : 9}m-3 ${up ? 3 : -3} 3 ${up ? -3 : 3} 3 ${up ? 3 : -3}" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
    drawing += arrow(10, layout === 'clockwise') + arrow(54, layout === 'counterclockwise');
  }
  return `<svg viewBox="0 0 64 48" aria-hidden="true">${drawing}</svg>`;
}

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
 * @param {(n: any) => number} [actionHeight] an Action’s height after wrapping its title, or zero for information
 * @param {string} [layout] the branches' direction and reading order
 * @param {(n: any, depth: number) => number} [wrappedHeight] extra height for a topic's title beyond its first line
 * @returns {{ at: Map<string, { x: number, y: number, w: number, h: number, depth: number, boxed: boolean }>, parent: Map<string, string>, via: Map<string, any> }}
 *   `via` is the line that made each topic its parent's child
 */
export function mindLayout({ nodes, lines, centre }, words, actionHeight = () => 0, layout = 'right', wrappedHeight = () => 0) {
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
    const h = actionHeight(n);
    return [n.id, { w: Math.ceil(words(n, d)) + (h ? 26 : mindAt(MIND_PAD, d)), h: h || mindAt(MIND_TALL, d) + wrappedHeight(n, d), depth: d, boxed: h > 0 }];
  }));
  // The ready Action's Execute button sits below it. Its siblings leave room for that existing control.
  const gapOf = (/** @type {string[]} */ list) => list.length ? Math.max(mindAt(MIND_ROW, size.get(list[0]).depth), list.some((id) => size.get(id).boxed && by.get(id).action?.stage === 'ready') ? 36 : 0) : 0;
  // how tall each topic's branch is: the topic itself, or its children stacked with a gap between them
  /** @type {Map<string, number>} */
  const tall = new Map();
  const tallOf = (/** @type {string} */ id) => tall.get(id) || 0;
  const measure = (/** @type {string} */ id) => {
    const list = kids.get(id) || [], gap = gapOf(list);
    const under = list.reduce((s, k) => s + measure(k), 0) + gap * Math.max(0, list.length - 1);
    const t = Math.max(size.get(id).h, under);
    tall.set(id, t); return t;
  };
  measure(root);
  const place = (/** @type {string} */ id, /** @type {number} */ left, /** @type {number} */ top, direction = 1) => {
    const s = size.get(id), list = kids.get(id) || [];
    const x = left + direction * s.w / 2;
    let y = top + tallOf(id) / 2;
    if (list.length) {
      const gap = gapOf(list);
      const under = list.reduce((sum, k) => sum + tallOf(k), 0) + gap * (list.length - 1);
      let t = top + (tallOf(id) - under) / 2;
      const next = left + direction * (s.w + mindAt(MIND_COL, s.depth));
      for (const k of list) { place(k, next, t, direction); t += tallOf(k) + gap; }
      y = (at.get(list[0]).y + at.get(list[list.length - 1]).y) / 2;
    }
    at.set(id, { x: Math.round(x), y: Math.round(y), ...s });
  };
  const r = size.get(root);
  layout = mindLayoutChoice(layout);
  if (layout === 'right' || layout === 'left') {
    const direction = layout === 'left' ? -1 : 1;
    place(root, -direction * r.w / 2, -tallOf(root) / 2, direction);
  } else {
    // Split whole branches, so a topic and all its descendants always grow on the same side.
    const list = kids.get(root) || [], half = Math.ceil(list.length / 2);
    const first = list.slice(0, half), second = list.slice(half);
    const right = layout === 'counterclockwise' ? [...second].reverse() : first;
    const left = layout === 'clockwise' ? [...second].reverse() : layout === 'counterclockwise' ? first : second;
    for (const [direction, group] of /** @type {[number, string[]][]} */ ([[1, right], [-1, left]])) {
      const gap = mindAt(MIND_ROW, 1);
      let top = -(group.reduce((sum, id) => sum + tallOf(id), 0) + gap * Math.max(0, group.length - 1)) / 2;
      for (const id of group) {
        place(id, direction * (r.w / 2 + mindAt(MIND_COL, 0)), top, direction);
        top += tallOf(id) + gap;
      }
    }
    at.set(root, { x: 0, y: 0, ...r });
  }
  // the start stays where it is, at the middle of the map, whatever grows under it
  const dy = at.get(root).y;
  if (dy) for (const p of at.values()) p.y -= dy;
  return { at, parent, via };
}

/**
 * The curve from a topic to one of its children. Out of the start, a thick branch fans to the main topic's left side;
 * deeper, a thin bracket leaves the parent (a box's right side, or the end of a topic's underline), turns evenly
 * halfway across the gap, and carries on as the child's underline, one stroke, so line and underline always meet.
 * @param {{ x: number, y: number, w: number, h: number, depth: number, boxed?: boolean }} a the parent
 * @param {{ x: number, y: number, w: number, h: number, depth: number, boxed?: boolean }} b the child
 */
export function mindBranch(a, b) {
  const r = (/** @type {number} */ v) => Math.round(v * 10) / 10;
  const direction = b.x < a.x ? -1 : 1;
  if (b.depth <= 1) {
    const sx = a.x + direction * (a.w / 2 - Math.min(24, a.w / 4)), sy = a.y, ex = b.x - direction * b.w / 2, ey = b.y, dx = ex - sx;
    return `M${r(sx)} ${r(sy)}C${r(sx + dx * 0.25)} ${r(sy + (ey - sy) * 0.8)} ${r(sx + dx * 0.45)} ${r(ey)} ${r(ex)} ${r(ey)}`;
  }
  const sx = a.x + direction * a.w / 2, sy = a.depth >= 2 && !a.boxed ? a.y + a.h / 2 : a.y, ex = b.x - direction * b.w / 2, ey = b.boxed ? b.y : b.y + b.h / 2, mid = sx + (ex - sx) / 2;
  return `M${r(sx)} ${r(sy)}C${r(mid)} ${r(sy)} ${r(mid)} ${r(ey)} ${r(ex)} ${r(ey)}${b.boxed ? '' : `H${r(b.x + direction * b.w / 2)}`}`;
}
