import crypto from 'node:crypto';

export const signedLink = (id, token, key) => `${token}.${crypto.createHmac('sha256', key).update(`${id}:${token}`).digest('hex')}`;

// Only the map itself crosses the sharing boundary. Local paths, chats, memory,
// people, credentials and pending proposals are deliberately not part of it.
const NODE = ['id', 'label', 'sub', 'desc', 'x', 'y', 'w', 'h', 'moved', 'createdAt', 'updatedAt', 'state', 'kind', 'icon', 'area'];
const EDGE = ['from', 'to', 'label', 'state', 'out', 'in'];
const pick = (value, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(value, k)).map((k) => [k, value[k]]));
const identifier = (s) => typeof s === 'string' && /^[\w.-]{1,120}$/.test(s);
const plain = (s, max = 16000) => typeof s === 'string' && s.length <= max && !/[<>]/.test(s);
export function mapData(input, depth = 0) {
  if (!input || depth > 8 || !Array.isArray(input.nodes) || !Array.isArray(input.edges) || input.nodes.length > 3000 || input.edges.length > 10000) throw new Error('This map is too large or is not a valid map.');
  const nodes = input.nodes.map((n) => {
    if (!n || !identifier(n.id) || !plain(n.label, 500) || !Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error('A box has invalid text or position.');
    const out = pick(n, NODE);
    for (const k of ['sub', 'desc', 'state', 'kind', 'icon', 'area']) if (k in out && !plain(out[k])) throw new Error('A box contains unsupported text.');
    for (const k of ['x','y','w','h']) if (k in out && (!Number.isFinite(out[k]) || Math.abs(out[k]) > 1e7)) throw new Error('A box has an invalid size or position.');
    if (n.inside) out.inside = mapData(n.inside, depth + 1);
    return out;
  });
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length) throw new Error('Box ids must be unique.');
  const ids = new Set(nodes.flatMap((n) => [n.id, ...(n.inside?.nodes || []).map((c) => c.id)]));
  const edges = input.edges.map((e) => {
    if (!e || !ids.has(e.from) || !ids.has(e.to) || e.label !== undefined && !plain(e.label, 500)) throw new Error('A line has an invalid endpoint or label.');
    const out = pick(e, EDGE);
    for (const k of ['state','out','in']) if (k in out && !plain(out[k], 40)) throw new Error('A line is invalid.');
    return out;
  });
  const title = String(input.title || 'Shared map'), desc = String(input.desc || '');
  if (!plain(title, 500) || !plain(desc)) throw new Error('The map title or description contains unsupported text.');
  const comments = (Array.isArray(input.comments) ? input.comments : []).slice(-500).map((c) => {
    if (!(Number.isSafeInteger(c.id) && c.id > 0) || c.node && !ids.has(c.node) || !Array.isArray(c.msgs)) throw new Error('A comment is invalid.');
    const msgs = c.msgs.slice(-100).map((m) => {
      if (!plain(m.text) || !plain(m.who, 80)) throw new Error('A comment contains unsupported text.');
      return pick(m, ['text','who','at']);
    });
    return { ...pick(c, ['id','node','x','y','view','resolved','at']), msgs };
  });
  return { title, desc, nodes, edges, comments, ...(identifier(input.start) ? { start: input.start } : {}) };
}
export function viewData(data, mode) {
  return { ...data, people: [], calls: [], prs: [], log: [], threads: {}, linked: [], said: {}, proposals: [], memory: [], answers: {}, linkSharing: { mode } };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Merge independent local/cloud edits; overlapping changes fail without losing either copy.
export function mergeMap(base, local, remote) {
  const merge = (a, b, c, at) => {
    if (same(a, b)) return c;
    if (same(a, c) || same(b, c)) return b;
    if (a && b && c && !Array.isArray(a) && typeof a === 'object' && typeof b === 'object' && typeof c === 'object') {
      const out = {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)])) { const v = merge(a[k], b[k], c[k], `${at}.${k}`); if (v !== undefined) out[k] = v; }
      return out;
    }
    if (['nodes','edges','comments'].includes(at) && [a,b,c].every(Array.isArray)) {
      const key = (v) => at === 'edges' ? `${v.from}\0${v.to}` : v.id;
      const maps = [a,b,c].map((list) => new Map(list.map((v) => [key(v), v]))), out = [];
      for (const id of new Set([...c.map(key), ...b.map(key), ...a.map(key)])) { const v = merge(...maps.map((m) => m.get(id)), `${at}.${id}`); if (v !== undefined) out.push(v); }
      return out;
    }
    // The later edit time accompanies the merged content, not a content conflict.
    if (at.endsWith('.updatedAt')) return Math.max(Number(b) || 0, Number(c) || 0);
    throw Object.assign(new Error('This box changed in both places. Both copies are kept. Open the cloud map to review the changes.'), { status: 409 });
  };
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) { const v = merge(base[k], local[k], remote[k], k); if (v !== undefined) out[k] = v; }
  return mapData(out);
}
