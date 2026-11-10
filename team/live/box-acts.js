// Drawing a box on the map by hand. The map passes in its state and the helpers it needs.

/**
 * @param {{ getState: () => any, nodeOf: (id: any) => any, seesOf: (by: any) => string, sideOf: (v: any) => any, tell: Function }} deps
 */
export function boxActs({ getState, nodeOf, seesOf, sideOf, tell }) {
  return {
    /** @param {any} a */
    add(a) {
      const label = String(a.label || '').trim().slice(0, 80);
      if (!label || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
      const inside = a.view && a.view !== 'system' ? nodeOf(a.view)?.inside : null, list = inside ? inside.nodes : getState().nodes;
      if (!list) return false;
      const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'box';
      let id = base; for (let i = 2; nodeOf(id); i++) id = `${base}-${i}`;
      // the box keeps the size it was drawn at (the page grows it only when its words need more room)
      const sees = seesOf(a.by), w = Math.round(Number(a.w)), h = Math.round(Number(a.h));
      // Keyboard insertion moves later branches in the same action, so undo restores their positions too.
      const reflow = a.reflow ?? [];
      if (!Array.isArray(reflow) || reflow.length > list.length || new Set(reflow.map((m) => m?.id)).size !== reflow.length) return false;
      if (reflow.some((m) => { const n = list.find((/** @type {any} */ n) => n.id === m?.id); return !n || !Number.isFinite(m.fromY) || !Number.isFinite(m.y) || n.y !== m.fromY || (sees !== 'all' && n.area !== sees); })) return false;
      for (const m of reflow) list.find((/** @type {any} */ n) => n.id === m.id).y = Math.round(m.y);
      list.push({ id, label, x: Math.round(a.x), y: Math.round(a.y), by: a.by, source: { kind: 'map' }, moved: true, ...(w >= 60 && w <= 800 ? { w } : {}), ...(h >= 36 && h <= 600 ? { h } : {}), ...(sees !== 'all' ? { area: sees } : {}) });
      // drawn by dragging a line out of another box's dot onto empty map: the line comes with it
      const from = a.from ? nodeOf(a.from) : null;
      if (from && (sees === 'all' || from.area === sees)) (inside ? (inside.edges ??= []) : getState().edges).push({ from: from.id, to: id, ...(sideOf(a.out) ? { out: a.out } : {}), ...(sideOf(a.in) ? { in: a.in } : {}) });
      a.created = id;
      tell(`${a.by} drew the box ${label}${from ? `, with a line from ${from.label}` : ''}`);
      return true;
    },
  };
}
