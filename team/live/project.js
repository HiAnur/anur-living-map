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

const KINDS = ['apps', 'services', 'jobs'];
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const files = (dir) => fs.readdirSync(dir, { recursive: true }).map(String)
  .filter((f) => /\.(ts|js|tsx|jsx)$/.test(f) && !f.includes('node_modules')).map((f) => path.join(dir, f));

function readme(dir) {
  const lines = read(path.join(dir, 'README.md')).split('\n').map((l) => l.trim());
  const h = lines.find((l) => l.startsWith('# '));
  const p = lines.find((l) => l && !l.startsWith('#') && !l.startsWith('-'));
  return h ? { label: h.slice(2).trim(), desc: p || '' } : null;
}

export function readProject(root) {
  const nodes = [], edges = [];
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
function layout(nodes, edges) {
  const outs = (id) => edges.filter((e) => e.from === id).map((e) => e.to);
  const ins = (id) => edges.filter((e) => e.to === id).map((e) => e.from);
  const depth = (id, seen = new Set()) => seen.has(id) ? 0 : (seen.add(id), 1 + Math.max(0, ...outs(id).map((t) => depth(t, seen))));
  const at = {}, taken = new Set(), key = (c, r) => `${c},${r}`;
  const put = (id, c, r) => { at[id] = [c, r]; taken.add(key(c, r)); };
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
      const touch = ([x, y]) => targets.filter((t) => Math.abs(at[t][0] - x) + Math.abs(at[t][1] - y) === 1).length;
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
const BW = (n) => n.w || (n.kind === 'actor' ? 110 : 140), BH = 50;
// both shapes a line can take, natural one first
function shapes(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const sx = dx > 0 ? a.x + BW(a) / 2 : a.x - BW(a) / 2, tx = dx > 0 ? b.x - BW(b) / 2 : b.x + BW(b) / 2, mx = (sx + tx) / 2;
  const sy = dy > 0 ? a.y + BH / 2 : a.y - BH / 2, ty = dy > 0 ? b.y - BH / 2 : b.y + BH / 2, my = (sy + ty) / 2;
  const side = [[sx, a.y], [mx, a.y], [mx, b.y], [tx, b.y]], updown = [[a.x, sy], [a.x, my], [b.x, my], [b.x, ty]];
  const segs = (pts) => pts.slice(1).map((p, i) => [pts[i], p]);
  return Math.abs(dx) >= Math.abs(dy) ? [segs(side), segs(updown)] : [segs(updown), segs(side)];
}
const hits = ([[x1, y1], [x2, y2]], n) => {
  const l = n.x - BW(n) / 2 - 6, r = n.x + BW(n) / 2 + 6, t = n.y - BH / 2 - 6, b = n.y + BH / 2 + 6;
  return Math.max(x1, x2) > l && Math.min(x1, x2) < r && Math.max(y1, y2) > t && Math.min(y1, y2) < b;
};

// how many boxes the lines run through, each line taking the shape the page draws
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

const placed = (n) => Number.isFinite(n.x) && Number.isFinite(n.y);

// A new box on a topic map goes where Tidy up would put it (on its parent's side, beside the boxes it belongs
// with, after the box drawn before it), without moving a box already there; on any other map, the free grid
// spot where its lines cross the fewest boxes and are shortest.
export function placeNew(nodes, edges, start = null) {
  if (!nodes.some((n) => !placed(n)) || placeInTree(nodes, edges, start)) return;
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
function placeInTree(nodes, edges, start) {
  const tree = treeOf(nodes, edges, start);
  if (!tree) return false;
  const { root, kids, parent, ring } = tree;
  if (!placed(root) && nodes.some(placed)) return false;
  const twin = new Map(nodes.map((n) => [n.id, { ...n, ...(placed(root) ? {} : n === root ? { x: 90, y: 150 } : {}) }]));
  tidyTree([...twin.values()], edges, null, placed, start);
  const sat = nodes.filter((n) => n !== root && placed(n));
  if (sat.filter((n) => n.x === twin.get(n.id).x).length * 2 < sat.length) return false;
  if (!placed(root)) { root.x = 90; root.y = 150; }
  const clear = (n, y) => !nodes.some((o) => o !== n && placed(o) && Math.abs(o.x - n.x) < (BW(o) + BW(n)) / 2 + 20 && Math.abs(o.y - y) < BH + ROW_GAP);
  const fresh = nodes.filter((n) => !placed(n)).sort((a, b) => ring.get(a.id) - ring.get(b.id) || twin.get(a.id).y - twin.get(b.id).y);
  for (const n of fresh) {
    const t = twin.get(n.id), sibs = kids.get(parent.get(n.id)).filter((s) => s !== n && placed(s) && Math.sign(twin.get(s.id).x - root.x) === Math.sign(t.x - root.x));
    const prev = sibs.filter((s) => twin.get(s.id).y < t.y).sort((a, b) => twin.get(b.id).y - twin.get(a.id).y)[0];
    const next = sibs.filter((s) => twin.get(s.id).y > t.y).sort((a, b) => twin.get(a.id).y - twin.get(b.id).y)[0];
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
export function tidy(nodes, edges = [], shown = null) {
  const list = nodes.filter(placed);
  if (!list.length) return;
  const spot = (c, r) => [90 + c * COL, 150 + r * ROW], key = (c, r) => `${c},${r}`;
  const cell = (n) => [Math.round((n.x - 90) / COL), Math.round((n.y - 150) / ROW)];
  const onGrid = (n) => { const [x, y] = spot(...cell(n)); return n.x === x && n.y === y; };
  const may = (n) => !shown || shown.has(n.id);
  const taken = new Set(), loose = [];
  for (const n of list.filter(onGrid)) { const k = key(...cell(n)); if (!taken.has(k)) taken.add(k); else if (may(n)) loose.push(n); }
  for (const n of list.filter((m) => !onGrid(m))) if (may(n)) loose.push(n); else taken.add(key(...cell(n)));
  const anchored = list.length - loose.length >= loose.length;
  // values within half a step of the first in their band are one column (or row)
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

// The tree under the one box no line comes into, ring by ring: the first line to reach a box makes it that box's
// child, and a box's children keep the order their lines were drawn in. Given the box the map starts from
// (`start`), the tree hangs under it and lines into it are cross-links. Null when there is no single such box
// or it does not reach every box.
function treeOf(nodes, edges, start = null) {
  const by = new Map(nodes.map((n) => [n.id, n])), out = new Map(), into = new Set();
  for (const e of edges) {
    if (!by.has(e.from) || !by.has(e.to) || e.from === e.to || e.to === start) continue;
    if (!out.has(e.from)) out.set(e.from, []); out.get(e.from).push(e.to); into.add(e.to);
  }
  const roots = by.has(start) ? [by.get(start)] : nodes.filter((n) => !into.has(n.id));
  if (nodes.length < 2 || roots.length !== 1) return null;
  const root = roots[0], kids = new Map(), parent = new Map(), seen = new Set([root.id]), q = [root.id], ring = new Map([[root.id, 0]]);
  while (q.length) {
    const id = q.shift();
    for (const t of out.get(id) || []) if (!seen.has(t)) {
      seen.add(t); q.push(t); ring.set(t, ring.get(id) + 1); parent.set(t, id);
      if (!kids.has(id)) kids.set(id, []); kids.get(id).push(by.get(t));
    }
  }
  return seen.size === nodes.length ? { root, by, out, kids, parent, ring } : null;
}

// Siblings that belong together, from what the map already says: the same area, a line to the same box, or
// the same words on the lines from their parent. Returns each box's group.
function groupsOf(list, from, edges, out) {
  const up = new Map(list.map((n) => [n.id, n.id]));
  const find = (id) => (up.get(id) === id ? id : find(up.get(id)));
  const words = (n) => edges.find((e) => e.from === from && e.to === n.id)?.label;
  list.forEach((a, i) => list.slice(i + 1).forEach((b) => {
    const to = new Set(out.get(a.id) || []);
    if ((a.area && a.area === b.area) || (words(a) && words(a) === words(b)) || (out.get(b.id) || []).some((t) => to.has(t))) up.set(find(a.id), find(b.id));
  }));
  return (n) => find(n.id);
}

// One column of siblings, top to bottom: as they sit now, with boxes that belong together next to each other
// (the group where its highest box is). Boxes with no place yet follow in the order they were drawn, each beside
// the boxes it belongs with or else at the end of the column; `up` makes the end the top.
function arrange(list, group, drawn, up, chosen = placed) {
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
// when it unfolds. False, and nothing moves, when no single box reaches them all.
// Room: 35px clear between branches; a taller box reserves more room for its whole branch. The page supplies
// its measured box sizes when tidying. Across, 70px between a column's widest box and the next, or more when the
// words on the lines into that column need it (the page writes them on the line's last stretch, half the gap wide).
// `chosen` says which boxes sit where someone put them (all placed boxes, by default); the server passes the boxes
// a person dragged or drew, so every box Claude placed is regrouped and rebalanced on each press. `start` is the
// box the map starts from, when one was chosen.
const ROW_GAP = 35, SLOT = BH + ROW_GAP, GAP = 70, CHAR = 6.8;
export function tidyTree(nodes, edges, shown = null, chosen = placed, start = null, sizes = new Map()) {
  const tree = treeOf(nodes, edges, start);
  if (!tree || (shown && !shown.has(tree.root.id))) return false;
  const { root, kids, ring, out } = tree;
  if (!placed(root)) return false;
  // how far out each ring's column sits from the first box
  const wide = [], words = [];
  for (const n of nodes) { const r = ring.get(n.id); wide[r] = Math.max(wide[r] || 0, sizes.get(n.id)?.w || BW(n)); }
  for (const e of edges) {
    const r = ring.get(e.to);
    if (e.label && r && ring.get(e.from) === r - 1) words[r] = Math.max(words[r] || 0, String(e.label).length * CHAR);
  }
  const reach = [0];
  for (let r = 1; r < wide.length; r++) reach[r] = reach[r - 1] + wide[r - 1] / 2 + Math.max(GAP, 2 * (words[r] || 0) + 32) + wide[r] / 2;
  const vis = (n) => !shown || shown.has(n.id);
  const leaves = (n, every) => { const k = (kids.get(n.id) || []).filter((c) => every || vis(c)); return k.length ? k.reduce((s, c) => s + leaves(c, every), 0) : 1; };
  const weight = (list, every) => list.reduce((s, c) => s + leaves(c, every), 0);
  const spans = [new Map(), new Map()];
  const span = (n, every) => {
    const cache = spans[every ? 1 : 0];
    if (!cache.has(n.id)) {
      const children = (kids.get(n.id) || []).filter((c) => every || vis(c));
      cache.set(n.id, Math.max((sizes.get(n.id)?.h || BH) + ROW_GAP, children.reduce((s, c) => s + span(c, every), 0)));
    }
    return cache.get(n.id);
  };
  const drawnIn = (from) => { const ks = kids.get(from) || []; return (n) => ks.indexOf(n); };
  // a box's children in the next column out, stacked top to bottom in `seq` order, centred on it
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
  for (const c of first.filter((m) => !side.has(m.id))) {
    const mate = first.find((m) => side.has(m.id) && group(m) === group(c));
    if (mate) side.set(c.id, side.get(mate.id));
  }
  // the boxes with no side yet, whole groups in the order they were drawn: the first k on the right
  const units = [];
  for (const c of first.filter((m) => !side.has(m.id))) {
    const u = units.find((v) => v.g === group(c));
    if (u) { u.list.push(c); u.w += leaves(c, every); } else units.push({ g: group(c), list: [c], w: leaves(c, every) });
  }
  const sideWeight = (s) => weight(first.filter((c) => side.get(c.id) === s), every);
  const wr = sideWeight(1), wl = sideWeight(-1), total = units.reduce((s, u) => s + u.w, 0);
  let k = 0, best = null;
  for (let i = 0, r = wr; i <= units.length; r += units[i]?.w || 0, i++) {
    const l = wl + total - (r - wr), score = [Math.abs(r - l), r >= l ? 0 : 1];
    if (!best || score[0] < best[0] || (score[0] === best[0] && score[1] < best[1])) { best = score; k = i; }
  }
  units.forEach((u, i) => u.list.forEach((c) => side.set(c.id, i < k ? 1 : -1)));
  stack(root, arrange(first.filter((c) => side.get(c.id) === -1), group, drawn, true, chosen), -1, every);
  stack(root, arrange(first.filter((c) => side.get(c.id) === 1), group, drawn, false, chosen), 1, every);
  return true;
}

// node project.js <folder>: print what the map would draw
if (import.meta.main) {
  const m = readProject(path.resolve(process.argv[2] || '.'));
  for (const n of m.nodes) console.log(`${n.label.padEnd(18)} ${n.kind || ''}`.padEnd(26), `x ${n.x} y ${n.y}`);
  for (const e of m.edges) console.log(`  ${e.from} -> ${e.to}`);
}
