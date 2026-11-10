// A stored map read as the objects it is meant to hold (types.d.ts: MapObject and what is built on it), without
// changing what is stored. Each box, line and memory comes back with an id, a type, a name and its dates, and
// `gaps` lists what each still lacks. Nothing in the server uses this yet: it is how the shape is tried on real
// maps before any of them is migrated.
//
//   node objects.js <state.json>     what a stored map holds, and how much of it is not whole yet

import fs from 'node:fs';

import { treeOf } from './project.js';

// A line has no id of its own in a stored map: it is the two boxes it joins. Box ids hold no ">", so this is one
// line's and no other's.
/** @param {{ from: string, to: string }} line */
export const lineId = (line) => `${line.from}>${line.to}`;

/** @param {unknown} v */
const date = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
/** @param {unknown} v */
const text = (v) => (typeof v === 'string' ? v.trim() : '');

// One type where a stored box has two fields: an Action first, then what it stands for at the map's edge.
/** @param {Box} box @returns {BoxObject['type']} */
const boxType = (box) => box.boxType === 'action' ? 'action' : box.kind === 'actor' ? 'actor' : box.kind === 'ext' ? 'external' : 'topic';

/** @param {Box} box @returns {BoxObject} */
export function boxObject(box) {
  const type = boxType(box);
  /** @type {BoxBase} */
  const base = {
    id: box.id, type, name: text(box.label), createdAt: date(box.createdAt), updatedAt: date(box.updatedAt),
    ...(text(box.updatedBy) ? { updatedBy: text(box.updatedBy) } : {}),
    description: text(box.sub), notes: text(box.desc),
    ...(text(box.state) ? { state: text(box.state) } : {}),
    ...(text(box.area) ? { area: text(box.area) } : {}),
    ...(Number.isFinite(box.x) && Number.isFinite(box.y) ? { place: { x: box.x, y: box.y, ...(Number.isFinite(box.w) ? { w: box.w } : {}), ...(Number.isFinite(box.h) ? { h: box.h } : {}) } } : {}),
    ...(box.inside ? { inside: graphObjects(box.inside.nodes || [], box.inside.edges || [], null) } : {}),
  };
  if (type !== 'action') return { ...base, type };
  return { ...base, type, ...(box.task !== undefined ? { task: box.task } : {}), ...(box.action ? { action: box.action } : {}) };
}

// The boxes and lines of one map, or of the map a box opens into. A line is "contains" when it is part of the
// tree the layout draws (the first line to reach a box, from the box the map starts at); every other line, and
// every line on a map that is not one tree, is a "flow".
/** @param {Box[]} nodes @param {Line[]} edges @param {string | null} start */
function graphObjects(nodes, edges, start) {
  const tree = treeOf(nodes, edges, start);
  /** @param {Line} e @returns {LineObject} */
  const line = (e) => ({
    id: lineId(e), type: tree && tree.parent.get(e.to) === e.from ? 'contains' : 'flow', name: text(e.label),
    createdAt: null, updatedAt: null, from: e.from, to: e.to, ...(text(e.state) ? { state: text(e.state) } : {}),
  });
  return { boxes: nodes.map((n) => boxObject(n)), lines: edges.map(line) };
}

/** @param {any} m a stored memory: { id, kind, box, text, by, at } @returns {MemoryObject} */
export const memoryObject = (m) => ({
  id: String(m.id), type: m.kind === 'instruction' ? 'instruction' : 'memory', name: text(m.text),
  createdAt: date(m.at), updatedAt: date(m.at), ...(text(m.by) ? { createdBy: text(m.by) } : {}), box: text(m.box) || null,
});

/** @param {MapState} state */
export function mapObjects(state) {
  return { ...graphObjects(state.nodes || [], state.edges || [], text(state.start) || null), memories: (state.memory || []).map(memoryObject) };
}

// What each object lacks: a name (a "contains" line needs none), a description on a box, or its dates. A line
// keeps no dates in a stored map at all, so lines are not listed for those.
/** @param {{ boxes: BoxObject[], lines: LineObject[], memories?: MemoryObject[] }} objects @returns {ObjectGap[]} */
export function gaps(objects) {
  /** @type {ObjectGap[]} */
  const out = [];
  for (const b of objects.boxes) {
    if (!b.name) out.push({ id: b.id, kind: 'box', lacks: 'name' });
    if (!b.description) out.push({ id: b.id, kind: 'box', lacks: 'description' });
    if (b.createdAt === null) out.push({ id: b.id, kind: 'box', lacks: 'dates' });
    if (b.inside) out.push(...gaps(b.inside));
  }
  for (const l of objects.lines) if (l.type === 'flow' && !l.name) out.push({ id: l.id, kind: 'line', lacks: 'name' });
  for (const m of objects.memories || []) {
    if (!m.name) out.push({ id: m.id, kind: 'memory', lacks: 'name' });
    if (m.createdAt === null) out.push({ id: m.id, kind: 'memory', lacks: 'dates' });
  }
  return out;
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) { console.log('node objects.js <state.json>'); process.exit(1); }
  const objects = mapObjects(JSON.parse(fs.readFileSync(file, 'utf8'))), found = gaps(objects);
  /** @param {{ type: string }[]} list */
  const byType = (list) => {
    /** @type {Record<string, number>} */ const n = {};
    for (const o of list) n[o.type] = (n[o.type] || 0) + 1;
    return Object.entries(n).map(([type, count]) => `${count} ${type}`).join(', ') || 'none';
  };
  console.log(`boxes: ${objects.boxes.length} (${byType(objects.boxes)})`);
  console.log(`lines: ${objects.lines.length} (${byType(objects.lines)})`);
  console.log(`memories: ${objects.memories.length} (${byType(objects.memories)})`);
  for (const kind of /** @type {const} */ (['box', 'line', 'memory'])) for (const lacks of /** @type {const} */ (['name', 'description', 'dates'])) {
    const n = found.filter((g) => g.kind === kind && g.lacks === lacks).length;
    if (n) console.log(`${kind} with no ${lacks}: ${n}`);
  }
}
