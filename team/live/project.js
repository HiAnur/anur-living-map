// The map of a real project folder, read from its files, not from a seed:
//
//   a box     each folder under apps/, services/, jobs/ with a README, and db/;
//             its name is the README's first heading, its words the next line
//   outside   each URL in .env.example with a comment above it that no box owns
//             (the payment provider, the email provider)
//   a line    a relative import into another box's folder, or a URL setting
//             (CORE_API_URL -> services/core-api, PAYMENT_PROVIDER_URL -> outside)
//   a person  "Customer", into every box under apps/
//
// Boxes sit in columns by how far they are from the customer, so the map reads
// left to right the way a request travels.

import fs from 'node:fs';
import path from 'node:path';

import { height as wordsHeight, width as wordsWidth } from './proposal-layout.js';

const KINDS = ['apps', 'services', 'jobs'];
/** @param {string} f */
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
/** @param {string} dir */
const files = (dir) => fs.readdirSync(dir, { recursive: true }).map(String)
  .filter((f) => /\.(ts|js|tsx|jsx)$/.test(f) && !f.includes('node_modules')).map((f) => path.join(dir, f));

/** @param {string} dir */
function readme(dir) {
  const lines = read(path.join(dir, 'README.md')).split('\n').map((l) => l.trim());
  const h = lines.find((l) => l.startsWith('# '));
  const p = lines.find((l) => l && !l.startsWith('#') && !l.startsWith('-'));
  return h ? { label: h.slice(2).trim(), desc: p || '' } : null;
}

/** @param {string} root */
export function readProject(root) {
  /** @type {any[]} boxes as they are found: their place comes from layout() */
  const nodes = [], /** @type {Line[]} */ edges = [];
  // the boxes: one per part of the system
  for (const kind of KINDS) {
    const top = path.join(root, kind);
    if (!fs.existsSync(top)) continue;
    for (const name of fs.readdirSync(top).sort()) {
      const dir = path.join(top, name), r = fs.statSync(dir).isDirectory() && readme(dir);
      if (r) nodes.push({ id: name, label: r.label, desc: r.desc, file: `${kind}/${name}/`, kind: undefined, dir, group: kind });
    }
  }
  const dbr = readme(path.join(root, 'db'));
  if (dbr) nodes.push({ id: 'db', label: dbr.label, desc: dbr.desc, file: 'db/', icon: 'db', dir: path.join(root, 'db'), group: 'db' });

  // outside services: commented URLs in .env.example that no box answers to
  const env = read(path.join(root, '.env.example')).split('\n');
  /** @type {Record<string, string>} */
  const urlTo = {};
  env.forEach((line, i) => {
    const m = line.match(/^([A-Z0-9_]+_URL)=/);
    if (!m) return;
    const slug = m[1].replace(/_URL$/, '').toLowerCase().replace(/_/g, '-');
    const own = nodes.find((n) => n.id === slug);
    if (own) { urlTo[m[1]] = own.id; return; }
    const note = (env[i - 1] || '').replace(/^#\s*/, '');
    if (!env[i - 1]?.startsWith('#')) return;
    const [label, desc = ''] = note.split(/:\s*/, 2);
    nodes.push({ id: slug, label: label.trim(), desc: desc.trim(), kind: 'ext', w: 150 });
    urlTo[m[1]] = slug;
  });

  // the lines: who imports or calls whom
  /** @param {string} file */
  const owner = (file) => nodes.find((n) => n.dir && file.startsWith(n.dir + path.sep));
  for (const n of nodes.filter((x) => x.dir)) {
    const to = new Set();
    for (const f of files(n.dir)) {
      const src = read(f);
      for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const o = owner(path.resolve(path.dirname(f), m[1]));
        if (o && o.id !== n.id) to.add(o.id);
      }
      for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+_URL)/g)) if (urlTo[m[1]] && urlTo[m[1]] !== n.id) to.add(urlTo[m[1]]);
    }
    for (const t of to) edges.push({ from: n.id, to: t });
  }
  // the person at the front door, named by the repo itself when it says so (package.json "livingMap": { "person": … }),
  // so a map started over from the code keeps the name the team gave it
  const pkg = (() => { try { return JSON.parse(read(path.join(root, 'package.json'))); } catch { return {}; } })();
  const apps = nodes.filter((n) => n.group === 'apps');
  if (apps.length) {
    nodes.unshift({ id: 'customer', label: pkg.livingMap?.person || 'Customer', kind: 'actor', desc: 'Anyone with an account.' });
    for (const a of apps) edges.unshift({ from: 'customer', to: a.id });
  }

  layout(nodes, edges);
  for (const n of nodes) { delete n.dir; delete n.group; }
  return { title: pkg.name || path.basename(root), desc: pkg.description || '', project: root, nodes, edges };
}

// The grid every box sits on: a 180-wide box keeps about 160 clear to its
// neighbour and 150 above and below, so lines, arrows and labels run between
// boxes with room to spare; the canvas is wide, so nothing is crammed.
export const COL = 340, ROW = 200;

// A grid where every line can run straight: the longest chain from the customer
// is the top row; each other box goes next to what it talks to (a database
// under its first caller, an outside service to the right of its caller, a box
// nobody calls beside as many of its targets as it can touch).
/** @param {LayoutBox[]} nodes @param {Line[]} edges */
function layout(nodes, edges) {
  /** @param {string} id */
  const outs = (id) => edges.filter((e) => e.from === id).map((e) => e.to);
  /** @param {string} id */
  const ins = (id) => edges.filter((e) => e.to === id).map((e) => e.from);
  /** @type {(id: string, seen?: Set<string>) => number} */
  const depth = (id, seen = new Set()) => seen.has(id) ? 0 : (seen.add(id), 1 + Math.max(0, ...outs(id).map((t) => depth(t, seen))));
  // each box's cell, by id: [column, row]
  const at = /** @type {Record<string, any>} */ ({}), taken = new Set(), /** @type {(...cell: number[]) => string} */ key = (c, r) => `${c},${r}`;
  /** @type {(id: string, ...cell: number[]) => void} */
  const put = (id, c, r) => { at[id] = [c, r]; taken.add(key(c, r)); };
  /** @param {number} c @param {number} r */
  const free = (c, r) => c >= 0 && r >= 0 && !taken.has(key(c, r));
  // the top row: follow the longest chain out of the customer
  let cur = nodes[0]?.id, c = 0;
  while (cur && !at[cur]) {
    put(cur, c++, 0);
    cur = outs(cur).filter((t) => !at[t]).sort((a, b) => depth(b) - depth(a))[0];
  }
  for (let guard = 0; guard < nodes.length * 4 && Object.keys(at).length < nodes.length; guard++) {
    for (const n of nodes) {
      if (at[n.id]) continue;
      const caller = ins(n.id).find((f) => at[f]);
      if (caller) {
        const [cc, cr] = at[caller];
        const tries = n.kind === 'ext' ? [[cc + 1, cr], [cc, cr + 1]] : [[cc, cr + 1], [cc + 1, cr]];
        const spot = tries.find(([x, y]) => free(x, y)) || (() => { let y = cr + 1; while (!free(cc, y)) y++; return [cc, y]; })();
        put(n.id, ...spot);
        continue;
      }
      const targets = outs(n.id).filter((t) => at[t]);
      if (!targets.length) continue;
      const cells = targets.flatMap((t) => { const [x, y] = at[t]; return [[x, y + 1], [x + 1, y], [x - 1, y], [x, y - 1]]; }).filter(([x, y]) => free(x, y));
      const touch = (/** @type {number[]} */ [x, y]) => targets.filter((t) => Math.abs(at[t][0] - x) + Math.abs(at[t][1] - y) === 1).length;
      const best = cells.sort((a, b) => touch(b) - touch(a) || a[1] - b[1])[0];
      if (best) put(n.id, ...best);
    }
  }
  // anything left (nothing calls it, it calls nothing) goes under the grid
  let spare = 0;
  const bottom = Math.max(0, ...Object.values(at).map(([, r]) => r)) + 1;
  for (const n of nodes) if (!at[n.id]) put(n.id, spare++, bottom);
  for (const n of nodes) { const [x, y] = at[n.id]; n.x = 90 + x * COL; n.y = 150 + y * ROW; }
}

// A box an agent adds without a place goes on the free grid spot where its
// lines, drawn the way the page draws them, pass through no other box, and
// are shortest. Mirrors route() in index.html.
/** @param {LayoutBox} n */
const BW = (n) => n.w || (n.kind === 'actor' ? 110 : 140), BH = 50;
// both shapes a line can take, natural one first
/** @param {LayoutBox} a @param {LayoutBox} b */
function shapes(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const sx = dx > 0 ? a.x + BW(a) / 2 : a.x - BW(a) / 2, tx = dx > 0 ? b.x - BW(b) / 2 : b.x + BW(b) / 2, mx = (sx + tx) / 2;
  const sy = dy > 0 ? a.y + BH / 2 : a.y - BH / 2, ty = dy > 0 ? b.y - BH / 2 : b.y + BH / 2, my = (sy + ty) / 2;
  const side = [[sx, a.y], [mx, a.y], [mx, b.y], [tx, b.y]], updown = [[a.x, sy], [a.x, my], [b.x, my], [b.x, ty]];
  /** @param {number[][]} pts */
  const segs = (pts) => pts.slice(1).map((p, i) => [pts[i], p]);
  return Math.abs(dx) >= Math.abs(dy) ? [segs(side), segs(updown)] : [segs(updown), segs(side)];
}
/** @param {number[][]} seg @param {LayoutBox} n */
const hits = ([[x1, y1], [x2, y2]], n) => {
  const l = n.x - BW(n) / 2 - 6, r = n.x + BW(n) / 2 + 6, t = n.y - BH / 2 - 6, b = n.y + BH / 2 + 6;
  return Math.max(x1, x2) > l && Math.min(x1, x2) < r && Math.max(y1, y2) > t && Math.min(y1, y2) < b;
};

// how many boxes the lines run through, each line taking the shape the page draws
/** @param {LayoutBox[]} nodes @param {Line[]} edges */
export function crossings(nodes, edges) {
  const by = new Map(nodes.map((n) => [n.id, n]));
  let k = 0;
  for (const e of edges) {
    const a = by.get(e.from), b = by.get(e.to); if (!a || !b) continue;
    const others = nodes.filter((n) => n !== a && n !== b);
    const [one, two] = shapes(a, b).map((segs) => segs.reduce((s, seg) => s + others.filter((n) => hits(seg, n)).length, 0));
    k += one && two < one ? two : one;
  }
  return k;
}

/** @param {LayoutBox} n */
const placed = (n) => Number.isFinite(n.x) && Number.isFinite(n.y);

// A new box on a topic map goes where Tidy up would put it (on its parent's side, beside the boxes it belongs
// with, after the box drawn before it), without moving a box already there; on any other map, the free grid
// spot where its lines cross the fewest boxes and are shortest.
/** @param {LayoutBox[]} nodes @param {Line[]} edges @param {string | null} [start] */
export function placeNew(nodes, edges, start = null) {
  if (!nodes.some((n) => !placed(n))) return;
  // the tree's new boxes take their places in it; a new box no line joins to the tree takes a free grid spot
  placeInTree(nodes, edges, start);
  for (const n of nodes) {
    if (placed(n)) continue;
    const others = nodes.filter((o) => o !== n && placed(o));
    const links = edges.filter((e) => e.from === n.id || e.to === n.id)
      .map((e) => others.find((o) => o.id === (e.from === n.id ? e.to : e.from))).filter(Boolean);
    const cols = others.map((o) => Math.round((o.x - 90) / COL)), rows = others.map((o) => Math.round((o.y - 150) / ROW));
    let best = null;
    for (let r = Math.min(...rows) - 1; r <= Math.max(...rows) + 1; r++)
      for (let c = Math.min(...cols) - 1; c <= Math.max(...cols) + 1; c++) {
        const x = 90 + c * COL, y = 150 + r * ROW;
        if (others.some((o) => Math.abs(o.x - x) < COL - 30 && Math.abs(o.y - y) < ROW - 20)) continue;
        // its own lines through other boxes, and lines already drawn through it, both count
        const all = [...others, { ...n, x, y }], ids = new Set(all.map((o) => o.id));
        const cross = crossings(all, edges.filter((e) => ids.has(e.from) && ids.has(e.to)));
        const len = links.reduce((l, o) => l + Math.abs(o.x - x) + Math.abs(o.y - y), 0);
        const score = cross * 10000 + len;
        if (!best || score < best.score) best = { x, y, score };
      }
    n.x = best ? best.x : 90; n.y = best ? best.y : 150;
  }
}

// Each new box takes the column and order a tidied copy of the map gives it, at the free height nearest that
// copy's, kept between the siblings it sits between there, so the next Tidy up keeps its side and its order.
// Only on a map laid out as a mind map (most boxes already in the copy's columns): a map still on the grid, such
// as one read from a project's folders, keeps the grid until someone presses Tidy up.
/** @param {LayoutBox[]} nodes @param {Line[]} edges @param {string | null} start */
function placeInTree(nodes, edges, start) {
  const tree = treeOf(nodes, edges, start);
  if (!tree) return false;
  const { root, kids, parent, ring } = tree;
  if (!placed(root) && nodes.some(placed)) return false;
  const twin = new Map(nodes.map((n) => [n.id, { ...n, ...(placed(root) ? {} : n === root ? { x: 90, y: 150 } : {}) }]));
  tidyTree([...twin.values()], edges, null, placed, start);
  const sat = nodes.filter((n) => n !== root && ring.has(n.id) && placed(n));
  if (sat.filter((n) => n.x === twin.get(n.id).x).length * 2 < sat.length) return false;
  if (!placed(root)) { root.x = 90; root.y = 150; }
  /** @param {LayoutBox} n @param {number} y */
  const clear = (n, y) => !nodes.some((o) => o !== n && placed(o) && Math.abs(o.x - n.x) < (BW(o) + BW(n)) / 2 + 20 && Math.abs(o.y - y) < BH + ROW_GAP);
  const fresh = nodes.filter((n) => ring.has(n.id) && !placed(n)).sort((a, b) => ring.get(a.id) - ring.get(b.id) || twin.get(a.id).y - twin.get(b.id).y);
  for (const n of fresh) {
    const t = twin.get(n.id), sibs = kids.get(parent.get(n.id)).filter((/** @type {any} */ s) => s !== n && placed(s) && Math.sign(twin.get(s.id).x - root.x) === Math.sign(t.x - root.x));
    const prev = sibs.filter((/** @type {any} */ s) => twin.get(s.id).y < t.y).sort((/** @type {any} */ a, /** @type {any} */ b) => twin.get(b.id).y - twin.get(a.id).y)[0];
    const next = sibs.filter((/** @type {any} */ s) => twin.get(s.id).y > t.y).sort((/** @type {any} */ a, /** @type {any} */ b) => twin.get(a.id).y - twin.get(b.id).y)[0];
    const anchor = prev || next || tree.by.get(parent.get(n.id)), want = Math.round(t.y + anchor.y - twin.get(anchor.id).y);
    const lo = prev ? prev.y : -Infinity, hi = next ? next.y : Infinity;
    n.x = t.x;
    const tries = [0]; for (let d = 25; d <= 40 * SLOT; d += 25) tries.push(d, -d);
    const y = tries.map((d) => want + d).find((v) => v > lo && v < hi && clear(n, v)) ?? tries.map((d) => want + d).find((v) => clear(n, v));
    n.y = y ?? want;
  }
  return true;
}

// Tidy up, after people have dragged boxes around. A box already on the grid stays where it is, so pressing it
// twice moves nothing the second time; a box off the grid goes to the nearest free cell. While most boxes are
// still off the grid (a map drawn by hand, or laid out on other spacing), the ones off it that sit roughly in one
// column or row share it, empty rows and columns between them close up, left of stays left of and above stays above. Then no line runs through a box: while one does, of the boxes that were off the
// grid, the one whose move frees the most lines goes to the nearest free cell that does it. Only the boxes in
// `shown` move; the others keep their cells.
/** @param {LayoutBox[]} nodes @param {Line[]} [edges] */
export function tidy(nodes, edges = [], /** @type {any} */ shown = null) {
  const list = nodes.filter(placed);
  if (!list.length) return;
  const /** @type {(...cell: number[]) => number[]} */ spot = (c, r) => [90 + c * COL, 150 + r * ROW], /** @type {(...cell: number[]) => string} */ key = (c, r) => `${c},${r}`;
  /** @param {LayoutBox} n */
  const cell = (n) => [Math.round((n.x - 90) / COL), Math.round((n.y - 150) / ROW)];
  /** @param {LayoutBox} n */
  const onGrid = (n) => { const [x, y] = spot(...cell(n)); return n.x === x && n.y === y; };
  /** @param {LayoutBox} n */
  const may = (n) => !shown || shown.has(n.id);
  const taken = new Set(), loose = [];
  for (const n of list.filter(onGrid)) { const k = key(...cell(n)); if (!taken.has(k)) taken.add(k); else if (may(n)) loose.push(n); }
  for (const n of list.filter((m) => !onGrid(m))) if (may(n)) loose.push(n); else taken.add(key(...cell(n)));
  const anchored = list.length - loose.length >= loose.length;
  // values within half a step of the first in their band are one column (or row)
  /** @param {number[]} vals @param {number} step */
  const bands = (vals, step) => {
    const band = new Map(); let i = -1, start = -Infinity;
    for (const v of [...new Set(vals)].sort((a, b) => a - b)) { if (v - start > step / 2) { i++; start = v; } band.set(v, i); }
    return band;
  };
  const cb = bands(loose.map((n) => n.x), COL), rb = bands(loose.map((n) => n.y), ROW);
  const c0 = Math.round((Math.min(...loose.map((n) => n.x)) - 90) / COL), r0 = Math.round((Math.min(...loose.map((n) => n.y)) - 150) / ROW);
  const want = loose.map((n) => {
    const [c, r] = anchored ? cell(n) : [c0 + cb.get(n.x), r0 + rb.get(n.y)], [x, y] = spot(c, r);
    return { n, c, r, off: Math.hypot(n.x - x, n.y - y) };
  }).sort((a, b) => a.off - b.off);
  for (const w of want) {
    let [c, r] = [w.c, w.r];
    // a cell already held: the nearest free one, same row first
    for (let d = 1; taken.has(key(c, r)); d++) {
      const ring = [];
      for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) if (Math.max(Math.abs(dr), Math.abs(dc)) === d) ring.push([dc, dr]);
      const free = ring.sort(([ac, ar], [bc, br]) => Math.abs(ar) - Math.abs(br) || Math.abs(ac) - Math.abs(bc) || bc - ac)
        .find(([dc, dr]) => !taken.has(key(w.c + dc, w.r + dr)));
      if (free) [c, r] = [w.c + free[0], w.r + free[1]];
    }
    taken.add(key(c, r));
    [w.n.x, w.n.y] = spot(c, r);
  }
  const seen = list.filter(may), ids = new Set(seen.map((n) => n.id));
  const lines = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  for (let round = 0; round < 40 && loose.length; round++) {
    const now = crossings(seen, lines);
    if (!now) break;
    const held = new Set(list.map((n) => key(...cell(n))));
    const cs = list.map((n) => cell(n)[0]), rs = list.map((n) => cell(n)[1]);
    let best = null;
    for (const n of loose) {
      const [c, r] = cell(n), was = [n.x, n.y];
      for (let r2 = Math.min(...rs) - 1; r2 <= Math.max(...rs) + 1; r2++)
        for (let c2 = Math.min(...cs) - 1; c2 <= Math.max(...cs) + 1; c2++) {
          if (held.has(key(c2, r2))) continue;
          [n.x, n.y] = spot(c2, r2);
          const k = crossings(seen, lines), d = Math.abs(c2 - c) + Math.abs(r2 - r);
          if (k < now && (!best || k < best.k || (k === best.k && d < best.d))) best = { n, c: c2, r: r2, k, d };
        }
      [n.x, n.y] = was;
    }
    if (!best) break;
    [best.n.x, best.n.y] = spot(best.c, best.r);
  }
}

// The groups of boxes that lines join, a box with no line a group of its own: the group drawn first comes first,
// and each keeps its boxes in the order they were drawn.
/** @param {LayoutBox[]} nodes @param {Line[]} edges @returns {LayoutBox[][]} */
function joined(nodes, edges) {
  const near = new Map(nodes.map((n) => [n.id, /** @type {string[]} */ ([])])), group = new Map();
  for (const e of edges) if (near.has(e.from) && near.has(e.to) && e.from !== e.to) { near.get(e.from)?.push(e.to); near.get(e.to)?.push(e.from); }
  /** @type {LayoutBox[][]} */
  const groups = [];
  for (const n of nodes) {
    if (group.has(n.id)) continue;
    const g = groups.length, q = [n.id];
    group.set(n.id, g); groups.push([]);
    while (q.length) for (const t of near.get(/** @type {string} */ (q.shift())) || []) if (!group.has(t)) { group.set(t, g); q.push(t); }
  }
  for (const n of nodes) groups[group.get(n.id)].push(n);
  return groups;
}

// The tree under the one box no line comes into, ring by ring: the first line to reach a box makes it that box's
// child, and a box's children keep the order their lines were drawn in. Given the box the map starts from
// (`start`), the tree hangs under it and lines into it are cross-links. The tree is looked for in the largest
// group of boxes that lines join (the first drawn on a tie), so a map of several groups that is mostly not a tree
// is never taken for one; the boxes no line joins to that group are `loose`, and never stop it being a tree.
// Null when there is no single such box or it does not reach every box joined to it.
/** @param {LayoutBox[]} nodes @param {Line[]} edges @param {string | null} [start] */
export function treeOf(nodes, edges, start = null) {
  const groups = joined(nodes, edges);
  if (!groups.length) return null;
  const main = groups.reduce((b, g) => (g.length > b.length ? g : b));
  const by = new Map(main.map((n) => [n.id, n])), out = new Map(), into = new Set();
  for (const e of edges) {
    if (!by.has(e.from) || !by.has(e.to) || e.from === e.to || e.to === start) continue;
    if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e.to); into.add(e.to);
  }
  const roots = by.has(start) ? [by.get(start)] : main.filter((n) => !into.has(n.id));
  if (main.length < 2 || roots.length !== 1) return null;
  const root = roots[0], kids = new Map(), parent = new Map(), seen = new Set([root.id]), q = [root.id], ring = /** @type {Map<any, any>} */ (new Map([[root.id, 0]]));
  while (q.length) {
    const id = q.shift();
    for (const t of out.get(id) || []) if (!seen.has(t)) {
      seen.add(t); q.push(t); ring.set(t, ring.get(id) + 1); parent.set(t, id);
      if (!kids.has(id)) kids.set(id, []); kids.get(id).push(by.get(t));
    }
  }
  return seen.size === main.length ? { root, by, out, kids, parent, ring, loose: nodes.filter((n) => !by.has(n.id)) } : null;
}

// A map drawn from code is rarely one tree: several boxes nothing leads to, boxes many others lead to, lines that
// loop. It reads best in rows, the way a layered system drawing does: each box one row below the lowest box that
// leads to it (a line that closes a loop left out of that count), so what calls sits above what is called. Within
// a row the boxes take the order that keeps them nearest the boxes they join, each as near the middle of those
// boxes as its neighbours leave room for, so most lines run straight down. A row longer than WIDE wraps into more
// rows, and boxes with no line sit in rows under the rest.
// The places come from the lines, the sizes and the order the boxes come in, never from where they sit, with the
// top left corner at 0,0: the same boxes and lines always get the same places.
const WIDE = 8, ACROSS = 70, DOWN = 150;
/**
 * @template {{ id: string }} B
 * @param {B[]} list @param {{ from: string, to: string }[]} edges
 * @param {(n: B) => number} w @param {(n: B) => number} h
 * @returns {Map<string, { x: number, y: number }>} each box's middle
 */
export function layerPlaces(list, edges, w, h) {
  const by = new Map(list.map((n) => [n.id, n]));
  const lines = edges.filter((e) => by.has(e.from) && by.has(e.to) && e.from !== e.to);
  const out = new Map(list.map((n) => [n.id, /** @type {string[]} */ ([])])), into = new Set(lines.map((e) => e.to));
  for (const e of lines) out.get(e.from)?.push(e.to);
  // a line back to a box still being walked closes a loop; the walk starts at the boxes nothing leads to
  const state = new Map(), loop = new Set();
  /** @param {string} id */
  const walk = (id) => {
    state.set(id, 1);
    for (const t of out.get(id) || []) { if (state.get(t) === 1) loop.add(`${id}>${t}`); else if (!state.has(t)) walk(t); }
    state.set(id, 2);
  };
  for (const n of [...list.filter((m) => !into.has(m.id)), ...list]) if (!state.has(n.id)) walk(n.id);
  const forward = lines.filter((e) => !loop.has(`${e.from}>${e.to}`)), depth = /** @type {Map<string, number>} */ (new Map(list.map((n) => [n.id, 0])));
  /** @param {string} id */
  const d = (id) => depth.get(id) || 0;
  for (let i = 0; i < list.length; i++) {
    let grew = false;
    for (const e of forward) if (d(e.to) < d(e.from) + 1) { depth.set(e.to, d(e.from) + 1); grew = true; }
    if (!grew) break;
  }
  const linked = new Set(lines.flatMap((e) => [e.from, e.to]));
  /** @type {B[][]} */
  const layers = [];
  for (const n of list) if (linked.has(n.id)) (layers[d(n.id)] ||= []).push(n);
  /** @param {B} n */
  const joins = (n) => lines.flatMap((e) => (e.from === n.id ? [e.to] : e.to === n.id ? [e.from] : []));
  // each row in turn takes the order of the boxes its boxes join in the rows above it, then in the rows below
  const order = /** @type {Map<string, number>} */ (new Map());
  layers.forEach((l) => l.forEach((n, i) => order.set(n.id, i)));
  /** @param {B[]} layer @param {number} side */
  const sort = (layer, side) => {
    const at = d(layer[0].id);
    /** @param {B} n */
    const mid = (n) => {
      const near = joins(n).filter((id) => Math.sign(d(id) - at) === side).map((id) => order.get(id) || 0);
      return near.length ? near.reduce((a, b) => a + b, 0) / near.length : order.get(n.id) || 0;
    };
    const keys = new Map(layer.map((n) => [n.id, mid(n)]));
    layer.sort((a, b) => (keys.get(a.id) || 0) - (keys.get(b.id) || 0) || (order.get(a.id) || 0) - (order.get(b.id) || 0));
    layer.forEach((n, i) => order.set(n.id, i));
  };
  for (let pass = 0; pass < 4; pass++) {
    for (const l of layers) if (l) sort(l, -1);
    for (const l of [...layers].reverse()) if (l) sort(l, 1);
  }
  /** @type {B[][]} */
  const rows = layers.filter(Boolean).flatMap((l) => Array.from({ length: Math.ceil(l.length / WIDE) }, (_, i) => l.slice(i * WIDE, (i + 1) * WIDE)));
  const loose = list.filter((n) => !linked.has(n.id));
  const rowOf = new Map(rows.flatMap((r, i) => r.map((n) => /** @type {[string, number]} */ ([n.id, i]))));
  const x = /** @type {Map<string, number>} */ (new Map());
  /** the middle of the boxes a box joins in the rows from `from` up to `to`, once they have places @param {B} n @param {number} from @param {number} to */
  const middle = (n, from, to) => {
    const near = joins(n).filter((id) => { const r = rowOf.get(id); return r !== undefined && r >= from && r < to && x.has(id); }).map((id) => x.get(id) || 0);
    return near.length ? near.reduce((a, b) => a + b, 0) / near.length : null;
  };
  rows.forEach((row, r) => {
    let floor = 0;
    for (const n of row) {
      const c = Math.max(floor + w(n) / 2, middle(n, 0, r) ?? -Infinity);
      x.set(n.id, c); floor = c + w(n) / 2 + ACROSS;
    }
  });
  // back up from the last row, a box with room beside it moves over the boxes it leads to
  for (let r = rows.length - 2; r >= 0; r--) {
    let roof = Infinity;
    for (const n of [...rows[r]].reverse()) {
      const want = middle(n, r + 1, rows.length), c = x.get(n.id) || 0;
      const to = want === null ? Math.min(c, roof - w(n) / 2) : Math.min(roof - w(n) / 2, Math.max(c, want));
      x.set(n.id, to); roof = to - w(n) / 2 - ACROSS;
    }
  }
  const places = new Map();
  let top = 0;
  for (const row of rows) {
    const tall = Math.max(...row.map(h));
    for (const n of row) places.set(n.id, { x: x.get(n.id) || 0, y: top + tall / 2 });
    top += tall + DOWN;
  }
  for (let i = 0; i < loose.length; i += WIDE) {
    const row = loose.slice(i, i + WIDE), tall = Math.max(...row.map(h));
    let left = 0;
    for (const n of row) { places.set(n.id, { x: left + w(n) / 2, y: top + tall / 2 }); left += w(n) + ACROSS; }
    top += tall + DOWN;
  }
  const edge = Math.min(0, ...list.map((n) => (places.get(n.id)?.x || 0) - w(n) / 2));
  for (const p of places.values()) p.x -= edge;
  return places;
}

// Tidy up on a map drawn from code that is not one tree, and on what any of its boxes opens into: the showing
// boxes go into rows (layerPlaces) and keep their top left corner, so pressing it twice moves nothing the second
// time. Only the boxes in `shown` move. False, and nothing moves, when no line joins two showing boxes.
/** @param {LayoutBox[]} nodes @param {Line[]} edges */
export function tidyLayers(nodes, edges, /** @type {any} */ shown = null, sizes = new Map()) {
  const list = nodes.filter((n) => placed(n) && (!shown || shown.has(n.id))), ids = new Set(list.map((n) => n.id));
  if (!edges.some((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)) return false;
  // the page sends each box's measured size; a tidy asked for without the page goes by the box's words
  /** @param {LayoutBox} n */
  const w = (n) => sizes.get(n.id)?.w || n.w || wordsWidth(n), /** @param {LayoutBox} n */ h = (n) => sizes.get(n.id)?.h || wordsHeight(n);
  // the corner as whole pixels: a box's middle is rounded, so its edge may sit half a pixel off where it was put
  const x0 = Math.ceil(Math.min(...list.map((n) => n.x - w(n) / 2)) - 0.5), y0 = Math.ceil(Math.min(...list.map((n) => n.y - h(n) / 2)) - 0.5);
  const places = layerPlaces(list, edges, w, h);
  for (const n of list) { const p = /** @type {{ x: number, y: number }} */ (places.get(n.id)); n.x = Math.round(x0 + p.x); n.y = Math.round(y0 + p.y); }
  return true;
}

// Siblings that belong together, from what the map already says: the same area, a line to the same box, or
// the same words on the lines from their parent. Returns each box's group.
/** @param {LayoutBox[]} list @param {string} from @param {Line[]} edges @param {Map<string, string[]>} out */
function groupsOf(list, from, edges, out) {
  const up = new Map(list.map((n) => [n.id, n.id]));
  /** @type {(id: string) => string} */
  const find = (id) => (up.get(id) === id ? id : find(up.get(id)));
  /** @param {LayoutBox} n */
  const words = (n) => edges.find((e) => e.from === from && e.to === n.id)?.label;
  list.forEach((a, i) => list.slice(i + 1).forEach((b) => {
    const to = new Set(out.get(a.id) || []);
    if ((a.area && a.area === b.area) || (words(a) && words(a) === words(b)) || (out.get(b.id) || []).some((t) => to.has(t))) up.set(find(a.id), find(b.id));
  }));
  return (/** @type {any} */ n) => find(n.id);
}

// One column of siblings, top to bottom: as they sit now, with boxes that belong together next to each other
// (the group where its highest box is). Boxes with no place yet follow in the order they were drawn, each beside
// the boxes it belongs with or else at the end of the column; `up` makes the end the top.
/** @param {LayoutBox[]} list @param {(n: LayoutBox) => string} group @param {(n: LayoutBox) => number} drawn @param {boolean} up @param {(n: LayoutBox) => boolean} [chosen] */
function arrange(list, group, drawn, up, chosen = placed) {
  /** @type {any[]} */
  const seq = [], sit = list.filter(chosen).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const n of sit) if (!seq.includes(n)) seq.push(...sit.filter((m) => group(m) === group(n)));
  for (const n of list.filter((m) => !chosen(m)).sort((a, b) => drawn(a) - drawn(b))) {
    const mates = seq.filter((m) => group(m) === group(n));
    seq.splice(mates.length ? (up ? seq.indexOf(mates[0]) : seq.indexOf(mates.at(-1)) + 1) : up ? 0 : seq.length, 0, n);
  }
  return seq;
}

// A topic map (one box everything hangs off) tidies the way a mind map does, the first box keeping its place and
// each ring one column further out, every box centred beside the boxes under it so the lines fan out and never
// cross. What people chose stays: a box keeps the side it sits on and its order among its siblings, so pressing
// Tidy up again moves nothing. Siblings that belong together (groupsOf) sit next to each other. A box with no
// side yet (no place, or straight above or below the first box) joins the side of a box it belongs with; the
// rest split in the order they were drawn, the first ones on the right, top to bottom, the others on the left,
// bottom to top (clockwise, as XMind and MindManager place them), where the two sides weigh nearest the same in
// boxes at the ends. A box with lines from two boxes hangs under the one nearer the first box; its other line is
// a cross-link, drawn but left out of the layout, the way XMind and MindNode treat theirs. Only the boxes in
// `shown` (all, without it) take room; what is folded away under a showing box lines up beside it, ready for
// when it unfolds. Boxes no line joins to the tree are loose: they keep their places, each group of them that is a
// tree of its own laid out the same way around its own first box. False, and nothing moves, when the largest
// group of joined boxes has no single box that reaches all of it.
// Room: 35px clear between branches; a taller box reserves more room for its whole branch. The page supplies
// its measured box sizes when tidying. Across, 70px between a column's widest box and the next, or more when the
// words on the lines into that column need it. The shared stem sits 14px outside the column, so reserve one
// label width plus 32px for the stem, arrow and padding, not twice the label width.
// `chosen` says which boxes sit where someone put them (all placed boxes, by default); the server passes the boxes
// a person dragged or drew, so every box Claude placed is regrouped and rebalanced on each press. `start` is the
// box the map starts from, when one was chosen.
const ROW_GAP = 35, SLOT = BH + ROW_GAP, GAP = 70, CHAR = 6.8, CLEAR = 16;
/** @param {LayoutBox[]} nodes @param {Line[]} edges */
export function tidyTree(nodes, edges, /** @type {any} */ shown = null, chosen = placed, /** @type {any} */ start = null, sizes = new Map()) {
  const tree = treeOf(nodes, edges, start);
  if (!tree || (shown && !shown.has(tree.root.id))) return false;
  const { root, kids, ring, out, loose } = tree;
  if (!placed(root)) return false;
  // how far out each ring's column sits from the first box
  /** @type {number[]} */
  const wide = [], /** @type {number[]} */ words = [];
  for (const n of nodes) { const r = ring.get(n.id); if (r !== undefined) wide[r] = Math.max(wide[r] || 0, sizes.get(n.id)?.w || BW(n)); }
  for (const e of edges) {
    const r = ring.get(e.to);
    if (e.label && r && ring.get(e.from) === r - 1) words[r] = Math.max(words[r] || 0, String(e.label).length * CHAR);
  }
  const reach = [0];
  for (let r = 1; r < wide.length; r++) reach[r] = reach[r - 1] + wide[r - 1] / 2 + Math.max(GAP, (words[r] || 0) + 32) + wide[r] / 2;
  /** @param {LayoutBox} n */
  const vis = (n) => !shown || shown.has(n.id);
  /** @type {(n: LayoutBox, every: boolean) => number} */
  const leaves = (n, every) => { const k = (kids.get(n.id) || []).filter((/** @type {any} */ c) => every || vis(c)); return k.length ? k.reduce((/** @type {number} */ s, /** @type {any} */ c) => s + leaves(c, every), 0) : 1; };
  /** @param {LayoutBox[]} list @param {boolean} every */
  const weight = (list, every) => list.reduce((s, c) => s + leaves(c, every), 0);
  const spans = [new Map(), new Map()];
  /** @type {(n: LayoutBox, every: boolean) => number} */
  const span = (n, every) => {
    const cache = spans[every ? 1 : 0];
    if (!cache.has(n.id)) {
      const children = (kids.get(n.id) || []).filter((/** @type {any} */ c) => every || vis(c));
      cache.set(n.id, Math.max((sizes.get(n.id)?.h || BH) + ROW_GAP, children.reduce((/** @type {number} */ s, /** @type {any} */ c) => s + span(c, every), 0)));
    }
    return cache.get(n.id);
  };
  /** @param {string} from */
  const drawnIn = (from) => { const ks = kids.get(from) || []; return (/** @type {any} */ n) => ks.indexOf(n); };
  // a box's children in the next column out, stacked top to bottom in `seq` order, centred on it
  /** @type {(n: LayoutBox, seq: LayoutBox[], side: number, every: boolean) => void} */
  const stack = (n, seq, side, every) => {
    let top = n.y - seq.reduce((s, c) => s + span(c, every), 0) / 2;
    for (const c of seq) {
      const height = span(c, every), ks = kids.get(c.id) || [], open = ks.filter(vis), all = every || !open.length, list = all ? ks : open;
      const next = arrange(list, groupsOf(list, c.id, edges, out), drawnIn(c.id), false, chosen);
      c.x = Math.round(root.x + side * reach[ring.get(c.id)]); c.y = Math.round(top + height / 2); top += height;
      stack(c, next, side, all);
    }
  };
  const all = kids.get(root.id) || [], open = all.filter(vis), every = !open.length, first = every ? all : open;
  const group = groupsOf(first, root.id, edges, out), drawn = drawnIn(root.id), side = new Map();
  for (const c of first) if (chosen(c) && Math.abs(c.x - root.x) > 1) side.set(c.id, c.x < root.x ? -1 : 1);
  for (const c of first.filter((/** @type {any} */ m) => !side.has(m.id))) {
    const mate = first.find((/** @type {any} */ m) => side.has(m.id) && group(m) === group(c));
    if (mate) side.set(c.id, side.get(mate.id));
  }
  // the boxes with no side yet, whole groups in the order they were drawn: the first k on the right
  /** @type {any[]} */
  const units = [];
  for (const c of first.filter((/** @type {any} */ m) => !side.has(m.id))) {
    const u = units.find((v) => v.g === group(c));
    if (u) { u.list.push(c); u.w += leaves(c, every); } else units.push({ g: group(c), list: [c], w: leaves(c, every) });
  }
  /** @param {number} s */
  const sideWeight = (s) => weight(first.filter((/** @type {any} */ c) => side.get(c.id) === s), every);
  const wr = sideWeight(1), wl = sideWeight(-1), total = units.reduce((s, u) => s + u.w, 0);
  let k = 0, best = null;
  for (let i = 0, r = wr; i <= units.length; r += units[i]?.w || 0, i++) {
    const l = wl + total - (r - wr), score = [Math.abs(r - l), r >= l ? 0 : 1];
    if (!best || score[0] < best[0] || (score[0] === best[0] && score[1] < best[1])) { best = score; k = i; }
  }
  units.forEach((u, i) => u.list.forEach((/** @type {any} */ c) => side.set(c.id, i < k ? 1 : -1)));
  stack(root, arrange(first.filter((/** @type {any} */ c) => side.get(c.id) === -1), group, drawn, true, chosen), -1, every);
  stack(root, arrange(first.filter((/** @type {any} */ c) => side.get(c.id) === 1), group, drawn, false, chosen), 1, every);
  // A loose box stays where it was put. A group of loose boxes that is a tree of its own is laid out around its
  // own first box, any other group keeps its boxes where they are; a group left on top of boxes already
  // settled moves, whole, straight up or down to the nearest clear place, the way a box dropped onto another lands.
  /** @param {LayoutBox} n */
  const w = (n) => sizes.get(n.id)?.w || BW(n), /** @param {LayoutBox} n */ h = (n) => sizes.get(n.id)?.h || BH;
  const settled = nodes.filter((n) => ring.has(n.id) && placed(n) && vis(n));
  for (const set of joined(loose, edges)) {
    if (set.length > 1) tidyTree(set, edges, shown, chosen, start, sizes);
    const mine = set.filter((n) => placed(n) && vis(n)), /** @type {number[][]} */ spans = [];
    for (const n of mine) for (const o of settled) {
      if (Math.abs(n.x - o.x) >= (w(n) + w(o)) / 2 + CLEAR) continue;
      const room = (h(n) + h(o)) / 2 + CLEAR;
      spans.push([o.y - n.y - room, o.y - n.y + room]);
    }
    /** @type {number[][]} */
    const blocks = [];
    for (const span of spans.sort((a, b) => a[0] - b[0])) {
      const last = blocks.at(-1);
      if (last && span[0] < last[1]) last[1] = Math.max(last[1], span[1]); else blocks.push([...span]);
    }
    const block = blocks.find(([lo, hi]) => lo < 0 && hi > 0);
    if (block) { const dy = -block[0] < block[1] ? Math.floor(block[0]) : Math.ceil(block[1]); for (const n of set.filter(placed)) n.y += dy; }
    settled.push(...mine);
  }
  return true;
}

// node project.js <folder>: print what the map would draw
if (import.meta.main) {
  const m = readProject(path.resolve(process.argv[2] || '.'));
  for (const n of /** @type {any[]} */ (m.nodes)) console.log(`${n.label.padEnd(18)} ${n.kind || ''}`.padEnd(26), `x ${n.x} y ${n.y}`);
  for (const e of m.edges) console.log(`  ${e.from} -> ${e.to}`);
}
