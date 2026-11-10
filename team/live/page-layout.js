// Where the page draws a mind map's lines and puts a new topic, from the boxes alone. The page hands in how it
// sizes a box (W, its width; HT, its height), which measure text on the page; tests hand in fixed sizes.
// A page module: see page-modules.js.

/**
 * @param {{ W: (n: any) => number, HT: (n: any) => number }} sizes
 */
export function layoutFor({ W, HT }) {
  // On a mind map a line fans out of one stem just outside its box's column: out of the side facing the box it
  // leads to, along the stem, then straight in, so the words on it sit beside the box they name, in that box's
  // order. Null when that shape would run through another box.
  /** @param {any} a @param {any} b @param {any[]} nodes @returns {number[][] | null} */
  function fanPts(a, b, nodes){
    const dir = Math.sign(b.x - a.x); if (!dir) return null;
    const col = Math.max(...nodes.filter((n) => Math.abs(n.x - a.x) < 1).map(W));
    const sx = a.x + dir * W(a) / 2, tx = b.x - dir * (W(b) / 2 + 2);
    // Keep one stem for the column even when a wider child leaves less room for the turn.
    const target = Math.min(...nodes.filter((n) => Math.abs(n.x - b.x) < 1).map((n) => dir * n.x - W(n) / 2 - 2));
    const stem = dir * Math.min(dir * a.x + col / 2 + 14, target - 14);
    if ((stem - sx) * dir < 14 || (tx - stem) * dir < 14) return null;
    const pts = Math.abs(b.y - a.y) < 2 ? [[sx, a.y], [tx, b.y]] : [[sx, a.y], [stem, a.y], [stem, b.y], [tx, b.y]];
    const through = pts.slice(1).some(([x2, y2], i) => { const [x1, y1] = pts[i];
      return nodes.some((n) => n !== a && n !== b && Math.max(x1, x2) > n.x - W(n) / 2 - 4 && Math.min(x1, x2) < n.x + W(n) / 2 + 4
        && Math.max(y1, y2) > n.y - HT(n) / 2 - 4 && Math.min(y1, y2) < n.y + HT(n) / 2 + 4); });
    return through ? null : pts;
  }
  // Insert into the parent's branch, then push later sibling branches down as whole units.
  // Existing columns, branch order, and the other side of the root keep their places.
  /** @param {any[]} nodes @param {any[]} edges @param {any} parentId @param {any} afterId @param {number} x @param {string} [label] @param {number} [height] */
  function planTopicInsert(nodes, edges, parentId, afterId, x, label = 'Sub-topic', height = HT({label})){
    const by = new Map(nodes.map((n) => [n.id, { ...n }])), parents = new Map(), kids = new Map();
    for (const e of edges){
      if (!by.has(e.from) || !by.has(e.to) || e.from === e.to || parents.has(e.to)) continue;
      let up = e.from; while (parents.has(up) && up !== e.to) up = parents.get(up);
      if (up !== e.to) parents.set(e.to, e.from);
    }
    for (const [id, parent] of parents){ if (!kids.has(parent)) kids.set(parent, []); kids.get(parent).push(id); }
    for (const list of kids.values()) list.sort((/** @type {any} */ a, /** @type {any} */ b) => by.get(a).y - by.get(b).y);
    const parent = by.get(parentId); if (!parent) return null;
    const side = (/** @type {any} */ id, /** @type {any} */ p) => by.get(id).x < p.x ? -1 : 1, direction = x < parent.x ? -1 : 1;
    const siblings = (kids.get(parentId) || []).filter((/** @type {any} */ id) => side(id, parent) === direction);
    const subtree = (/** @type {any} */ id) => { const out = [id]; for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) || [])); return out; };
    const fresh = {}, size = (/** @type {any} */ id) => id === fresh ? height : HT(by.get(id));
    const top = (/** @type {any} */ id) => Math.min(...subtree(id).map((k) => by.get(k).y - size(k) / 2));
    const bottom = (/** @type {any} */ id) => Math.max(...subtree(id).map((k) => by.get(k).y + size(k) / 2));
    const previous = afterId && siblings.includes(afterId) ? afterId : siblings.at(-1);
    const node = { id: fresh, x, y: previous ? bottom(previous) + 35 + height / 2 : parent.y, label };
    by.set(fresh, node); parents.set(fresh, parentId);
    const list = kids.get(parentId) || [], index = previous ? list.indexOf(previous) + 1 : list.length;
    list.splice(index, 0, fresh); kids.set(parentId, list);
    const center = (/** @type {any} */ id) => {
      if (!parents.has(id)) return;
      const list = kids.get(id) || []; if (!list.length) return;
      by.get(id).y = (by.get(list[0]).y + by.get(list.at(-1)).y) / 2;
    };
    let active = fresh;
    while (parents.has(active)){
      const up = parents.get(active), p = by.get(up), same = (kids.get(up) || []).filter((/** @type {any} */ id) => side(id, p) === side(active, p));
      let floor = bottom(active);
      for (const id of same.slice(same.indexOf(active) + 1)){
        const dy = Math.max(0, floor + 35 - top(id));
        for (const k of subtree(id)) by.get(k).y += dy;
        floor = bottom(id);
      }
      center(up); active = up;
    }
    return { x: node.x, y: Math.round(node.y), moves: nodes.filter((n) => Math.round(by.get(n.id).y) !== n.y).map((n) => ({ id: n.id, fromY: n.y, y: Math.round(by.get(n.id).y) })) };
  }
  return { fanPts, planTopicInsert };
}
