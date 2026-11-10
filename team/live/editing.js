// A branch includes folded descendants and boxes inside it. Cycles are visited once.
/** @param {MapState} state @param {string[]} roots */
export function branchIds(state, roots) {
  const nodes = state.nodes.flatMap((n) => [n, ...(n.inside?.nodes || [])]);
  const edges = [...(state.edges || []), ...state.nodes.flatMap((n) => n.inside?.edges || [])];
  const ids = new Set(roots), queue = [...ids];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], node = nodes.find((n) => n.id === id);
    const children = [...edges.filter((e) => e.from === id).map((e) => e.to), ...(node?.inside?.nodes || []).map((n) => n.id)];
    for (const child of children) if (!ids.has(child)) { ids.add(child); queue.push(child); }
  }
  return ids;
}
// Moving a topic to another parent is one edit: validate the whole placement before
// changing any line or box, so a concurrent edit cannot leave half a branch moved.
/** @param {MapState} state @param {any} a the move a page asked for: checked field by field here */
export function reparentTopic(state, a, /** @type {(n?: any) => boolean} */ canEdit = () => true) {
  const all = state.nodes.flatMap((n) => [n, ...(n.inside?.nodes || [])]);
  const graph = !a.view || a.view === 'system' ? state : all.find((n) => n.id === a.view)?.inside;
  if (!graph) return false;
  const roots = a.ids || [a.id], parent = graph.nodes.find((n) => n.id === a.parent);
  if (!Array.isArray(roots) || !roots.length || new Set(roots).size !== roots.length || roots.some((id) => !graph.nodes.some((n) => n.id === id)) || !parent || !canEdit(parent)) return false;
  if (roots.some((id) => roots.some((other) => other !== id && branchIds(state,[other]).has(id)))) return false;
  const branch = branchIds(state, roots);
  if (branch.has(parent.id) || [...branch].some((id) => !all.find((n) => n.id === id && canEdit(n)))) return false;
  const incoming = (graph.edges || []).filter((e) => roots.includes(e.to));
  if (roots.some((id) => { const parents = a.ids ? a.parentsById?.[id] : a.parents; return !Array.isArray(parents) || JSON.stringify(incoming.filter((e) => e.to === id).map((e) => e.from).sort()) !== JSON.stringify([...parents].sort()); })) return false;
  if (incoming.some((e) => !all.find((n) => n.id === e.from && canEdit(n)))) return false;
  const moves = a.moves;
  if (!Array.isArray(moves) || !moves.length || moves.length > graph.nodes.length || new Set(moves.map((m) => m?.id)).size !== moves.length) return false;
  if (graph.nodes.some((n) => branch.has(n.id) && !moves.some((m) => m?.id === n.id))) return false;
  if (moves.some((m) => {
    const n = graph.nodes.find((n) => n.id === m?.id);
    return !n || !canEdit(n) || ![m.fromX, m.fromY, m.x, m.y].every(Number.isFinite) || n.x !== m.fromX || n.y !== m.fromY;
  })) return false;
  for (const m of moves) Object.assign(/** @type {Box} */ (graph.nodes.find((n) => n.id === m.id)), { x: Math.round(m.x), y: Math.round(m.y), moved: true });
  graph.edges = [...(graph.edges || []).filter((e) => !roots.includes(e.to)), ...roots.map((id) => ({from:parent.id,to:id}))];
  return true;
}
// Dates describe edits; they must not make an otherwise unchanged undo conflict.
/** @param {unknown} value */
const content = (value) => JSON.stringify(value, (key, v) => key === 'createdAt' || key === 'updatedAt' || key === 'updatedBy' ? undefined : v);
/** @param {unknown} a @param {unknown} b */
const equal = (a, b) => content(a) === content(b);
/** @type {(state: { nodes?: Box[] }) => Box[]} */
const boxes = (state) => (state.nodes || []).flatMap((n) => [n, ...boxes(n.inside || {})]);
/** @param {any} value */
const date = (value) => Number.isFinite(value) && value > 0 ? value : null;
// Existing maps have no reliable creation time. Keep missing dates unknown until
// an actual edit, and keep a saved creation date through undo and history restore.
/** @param {MapState} state @param {boolean} [fresh] @param {number} [now] */
export function boxDates(state, fresh = false, now = Date.now()) {
  for (const n of boxes(state)) {
    n.createdAt = date(n.createdAt) ?? (fresh ? now : null);
    n.updatedAt = date(n.updatedAt) ?? n.createdAt;
  }
  /** @param {{ nodes?: Box[] }} s */
  const snapshot = (s) => new Map(boxes(s).map((n) => [n.id, { content: content(n), createdAt: n.createdAt, updatedAt: n.updatedAt, updatedBy: n.updatedBy }]));
  let previous = snapshot(state);
  return /** @type {(next: MapState, at?: number, by?: string) => void} */ ((next, at = Date.now(), by) => {
    for (const n of boxes(next)) {
      const before = previous.get(n.id);
      n.createdAt = before ? before.createdAt : Object.hasOwn(n, 'createdAt') ? date(n.createdAt) : at;
      const unchanged = before && before.content === content(n);
      n.updatedAt = unchanged ? before.updatedAt : at;
      const editor = unchanged ? before.updatedBy : by;
      if (editor) n.updatedBy = editor;
      else delete n.updatedBy;
    }
    previous = snapshot(next);
  });
}
/** @param {MapState} state */
export const editSnapshot = (state) => structuredClone({ nodes: state.nodes, edges: state.edges, title: state.title, renamed: state.renamed });
// Apply only the entities this action changed. Another person's unrelated edits stay intact;
// a conflicting edit blocks the operation instead of being overwritten.
/** @param {any} state @param {any} from @param {any} to two snapshots, read by field name @param {(n?: any) => boolean} canEdit */
function applyEdit(state, from, to, canEdit) {
  const next = { ...state }, changed = new Set();
  for (const [field, key] of /** @type {[string, (v: any) => string][]} */ ([['nodes', (n) => n.id], ['edges', (e) => `${e.from}\0${e.to}`]])) {
    const a = new Map(from[field].map((/** @type {any} */ v) => [key(v), v])), b = new Map(to[field].map((/** @type {any} */ v) => [key(v), v]));
    const current = new Map(state[field].map((/** @type {any} */ v) => [key(v), v]));
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      if (equal(a.get(id), b.get(id))) continue;
      if (!equal(current.get(id), a.get(id))) return false;
      if (field === 'nodes' && [a.get(id), b.get(id)].filter(Boolean).flatMap((n) => [n, ...(n.inside?.nodes || [])]).some((n) => !canEdit(n))) return false;
      if (field === 'edges') {
        const nodes = [...state.nodes, ...from.nodes, ...to.nodes].flatMap((n) => [n, ...(n.inside?.nodes || [])]);
        if ([a.get(id), b.get(id)].filter(Boolean).some((e) => [e.from, e.to].some((end) => { const n = nodes.find((x) => x.id === end); return !n || !canEdit(n); }))) return false;
      }
      if (b.has(id)) current.set(id, structuredClone(b.get(id))); else current.delete(id);
      if (field === 'nodes') changed.add(id);
    }
    next[field] = [...current.values()];
  }
  for (const field of ['title', 'renamed']) if (!equal(from[field], to[field])) {
    if (!equal(state[field], from[field])) return false;
    next[field] = to[field];
  }
  const ids = new Set(next.nodes.flatMap((/** @type {any} */ n) => [n.id, ...(n.inside?.nodes || []).map((/** @type {any} */ x) => x.id)]));
  if (next.edges.some((/** @type {any} */ e) => (changed.has(e.from) || changed.has(e.to)) && (!ids.has(e.from) || !ids.has(e.to)))) return false;
  Object.assign(state, next); return true;
}
/** @param {any[]} [saved] */
export function editHistory(saved = []) {
  const people = new Map(structuredClone(saved));
  /** @param {string} by */
  const stacks = (by) => { if (!people.has(by)) people.set(by, { undo: [], redo: [] }); return people.get(by); };
  return {
    snapshot: () => structuredClone([...people]),
    /** @param {string} by @param {unknown} before @param {unknown} after */
    record(by, before, after) {
      if (equal(before, after)) return;
      const s = stacks(by); s.undo.push({ before, after }); if (s.undo.length > 100) s.undo.shift(); s.redo = [];
    },
    /** @param {string} by @param {string} direction "undo" or "redo" @param {any} state */
    apply(by, direction, state, /** @type {(n?: any) => boolean} */ canEdit = () => true) {
      const s = stacks(by), entry = s[direction]?.at(-1);
      if (!entry) return { ok: false, error: direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.' };
      const [from, to] = direction === 'undo' ? [entry.after, entry.before] : [entry.before, entry.after];
      if (!applyEdit(state, from, to, canEdit)) return { ok: false, error: 'That part of the map changed elsewhere. Your changes were kept.' };
      s[direction].pop(); s[direction === 'undo' ? 'redo' : 'undo'].push(entry);
      return { ok: true };
    },
  };
}
