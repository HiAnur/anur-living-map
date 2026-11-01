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
  // the person at the front door
  const apps = nodes.filter((n) => n.group === 'apps');
  if (apps.length) {
    nodes.unshift({ id: 'customer', label: 'Customer', kind: 'actor', desc: 'Anyone with an account.' });
    for (const a of apps) edges.unshift({ from: 'customer', to: a.id });
  }

  layout(nodes, edges);
  for (const n of nodes) { delete n.dir; delete n.group; }
  const pkg = (() => { try { return JSON.parse(read(path.join(root, 'package.json'))); } catch { return {}; } })();
  return { title: pkg.name || path.basename(root), desc: pkg.description || '', project: root, nodes, edges };
}

// The grid every box sits on: a 180-wide box keeps about 110 clear to its
// neighbour and 90 above and below, so lines, arrows and labels run between
// boxes instead of squeezing past them.
export const COL = 290, ROW = 140;

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

export function placeNew(nodes, edges) {
  for (const n of nodes) {
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) continue;
    const placed = nodes.filter((o) => o !== n && Number.isFinite(o.x));
    const links = edges.filter((e) => e.from === n.id || e.to === n.id)
      .map((e) => placed.find((o) => o.id === (e.from === n.id ? e.to : e.from))).filter(Boolean);
    const cols = placed.map((o) => Math.round((o.x - 90) / COL)), rows = placed.map((o) => Math.round((o.y - 150) / ROW));
    let best = null;
    for (let r = Math.min(...rows) - 1; r <= Math.max(...rows) + 1; r++)
      for (let c = Math.min(...cols) - 1; c <= Math.max(...cols) + 1; c++) {
        const x = 90 + c * COL, y = 150 + r * ROW;
        if (placed.some((o) => Math.abs(o.x - x) < COL - 30 && Math.abs(o.y - y) < ROW - 20)) continue;
        const me = { ...n, x, y };
        let cross = 0, len = 0;
        for (const o of links) {
          // the page takes the second shape when it crosses fewer boxes
          const [one, two] = shapes(me, o).map((segs) => ({
            segs, k: segs.reduce((k, s) => k + placed.filter((p) => p !== o && hits(s, p)).length, 0),
          }));
          const pick = one.k && two.k < one.k ? two : one;
          cross += pick.k;
          for (const s of pick.segs) len += Math.abs(s[0][0] - s[1][0]) + Math.abs(s[0][1] - s[1][1]);
        }
        const score = cross * 10000 + len;
        if (!best || score < best.score) best = { x, y, score };
      }
    n.x = best ? best.x : 90; n.y = best ? best.y : 150;
  }
}

// node project.js <folder>: print what the map would draw
if (import.meta.main) {
  const m = readProject(path.resolve(process.argv[2] || '.'));
  for (const n of m.nodes) console.log(`${n.label.padEnd(18)} ${n.kind || ''}`.padEnd(26), `x ${n.x} y ${n.y}`);
  for (const e of m.edges) console.log(`  ${e.from} -> ${e.to}`);
}
