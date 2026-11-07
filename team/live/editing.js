// A branch includes folded descendants and boxes inside it. Cycles are visited once.
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
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const editSnapshot = (state) => structuredClone({ nodes: state.nodes, edges: state.edges, title: state.title, renamed: state.renamed });
// Apply only the entities this action changed. Another person's unrelated edits stay intact;
// a conflicting edit blocks the operation instead of being overwritten.
function applyEdit(state, from, to, canEdit) {
  const next = { ...state }, changed = new Set();
  for (const [field, key] of [['nodes', (n) => n.id], ['edges', (e) => `${e.from}\0${e.to}`]]) {
    const a = new Map(from[field].map((v) => [key(v), v])), b = new Map(to[field].map((v) => [key(v), v]));
    const current = new Map(state[field].map((v) => [key(v), v]));
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      if (equal(a.get(id), b.get(id))) continue;
      if (!equal(current.get(id), a.get(id))) return false;
      if (field === 'nodes' && [a.get(id), b.get(id)].filter(Boolean).flatMap((n) => [n, ...(n.inside?.nodes || [])]).some((n) => !canEdit(n))) return false;
      if (b.has(id)) current.set(id, structuredClone(b.get(id))); else current.delete(id);
      if (field === 'nodes') changed.add(id);
    }
    next[field] = [...current.values()];
  }
  for (const field of ['title', 'renamed']) if (!equal(from[field], to[field])) {
    if (!equal(state[field], from[field])) return false;
    next[field] = to[field];
  }
  const ids = new Set(next.nodes.flatMap((n) => [n.id, ...(n.inside?.nodes || []).map((x) => x.id)]));
  if (next.edges.some((e) => (changed.has(e.from) || changed.has(e.to)) && (!ids.has(e.from) || !ids.has(e.to)))) return false;
  Object.assign(state, next); return true;
}
export function editHistory() {
  const people = new Map();
  const stacks = (by) => { if (!people.has(by)) people.set(by, { undo: [], redo: [] }); return people.get(by); };
  return {
    record(by, before, after) {
      if (equal(before, after)) return;
      const s = stacks(by); s.undo.push({ before, after }); if (s.undo.length > 100) s.undo.shift(); s.redo = [];
    },
    apply(by, direction, state, canEdit = () => true) {
      const s = stacks(by), entry = s[direction]?.at(-1);
      if (!entry) return { ok: false, error: direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.' };
      const [from, to] = direction === 'undo' ? [entry.after, entry.before] : [entry.before, entry.after];
      if (!applyEdit(state, from, to, canEdit)) return { ok: false, error: 'That part of the map changed elsewhere. Your changes were kept.' };
      s[direction].pop(); s[direction === 'undo' ? 'redo' : 'undo'].push(entry);
      return { ok: true };
    },
  };
}
