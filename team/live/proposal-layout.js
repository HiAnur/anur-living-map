// Preview additions in branch order. Existing positions are copied, never changed until Apply.
const width = (n) => Math.min(220, Math.max(n.kind === 'actor' ? 110 : 140, String(n.label || '').length * 7.4 + 28));
const lines = (text, room, char) => {
  let count = 1, used = 0;
  for (const word of String(text || '').split(/\s+/)) {
    const size = word.length * char;
    if (used && used + char + size > room) { count++; used = 0; }
    count += Math.max(0, Math.ceil(size / room) - 1); used = size > room ? size % room : used + (used ? char : 0) + size;
  }
  return count;
};
const height = (n) => Math.max(n.h || 0, 50 + (lines(n.label, width(n) - 26, 7.4) - 1) * 17 + (Math.min(3, lines(n.sub, width(n) - 26, 6.7)) - 1) * 16);
const placed = (n) => Number.isFinite(n.x) && Number.isFinite(n.y);

export function appendProposed(existing, edges, additions, newEdges) {
  const by = new Map(existing.map((n) => [n.id, {...n}])), parents = new Map(), kids = new Map();
  const attach = (from, to) => {
    if (!by.has(from) || !by.has(to) || from === to || parents.has(to)) return;
    for (let up = from; up; up = parents.get(up)) if (up === to) return;
    parents.set(to, from); if (!kids.has(from)) kids.set(from, []); kids.get(from).push(to);
  };
  for (const e of edges) attach(e.from, e.to);
  for (const list of kids.values()) list.sort((a,b) => by.get(a).y - by.get(b).y);
  const subtree = (id) => { const out = [id]; for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]) || [])); return out; };
  const top = (id) => Math.min(...subtree(id).filter(k=>placed(by.get(k))).map(k=>by.get(k).y-height(by.get(k))/2));
  const bottom = (id) => Math.max(...subtree(id).filter(k=>placed(by.get(k))).map(k=>by.get(k).y+height(by.get(k))/2));
  const side = (id, p) => by.get(id).x < p.x ? -1 : 1;
  const queue = [...additions];
  // Parents may come after children in the model's response.
  for (let pass = 0; queue.length && pass <= additions.length; pass++) {
    let progress = false;
    for (const n of [...queue]) {
      const parentId = newEdges.find(e=>e.to===n.id && placed(by.get(e.from) || {}))?.from;
      if (!parentId) continue;
      const p = by.get(parentId), up = by.get(parents.get(parentId));
      const siblings = (kids.get(parentId) || []).filter(id=>placed(by.get(id)));
      const direction = up ? side(parentId, up) : siblings.length ? side(siblings[0], p) : 1;
      const same = siblings.filter(id=>side(id,p)===direction), last = same.at(-1);
      const cousins = up ? (kids.get(up.id) || []).filter(id=>side(id,up)===direction).flatMap(id=>kids.get(id)||[]).filter(id=>placed(by.get(id)) && side(id,by.get(parents.get(id)))===direction) : [];
      const column = last ? by.get(last).x : cousins.length ? by.get(cousins[0]).x : p.x + direction * (width(p)/2 + 70 + width(n)/2);
      n.x = column; n.y = last ? bottom(last) + 35 + height(n)/2 : p.y;
      by.set(n.id, {...n}); attach(parentId,n.id); queue.splice(queue.indexOf(n),1); progress = true;
      let active = n.id;
      while (parents.has(active)) {
        const parent = by.get(parents.get(active)), list = (kids.get(parent.id)||[]).filter(id=>side(id,parent)===side(active,parent));
        let floor = bottom(active);
        for (const id of list.slice(list.indexOf(active)+1)) {
          const dy = Math.max(0, floor + 35 - top(id));
          for (const child of subtree(id)) by.get(child).y += dy;
          floor = bottom(id);
        }
        active = parent.id;
      }
    }
    if (!progress) break;
  }
  for (const n of additions) if (by.has(n.id)) Object.assign(n,{x:by.get(n.id).x,y:by.get(n.id).y});
  return existing.filter(n=>placed(n) && (by.get(n.id).x!==n.x || by.get(n.id).y!==n.y)).map(n=>({id:n.id,fromX:n.x,fromY:n.y,x:by.get(n.id).x,y:by.get(n.id).y}));
}
