// Finding boxes by their words, for the page's search. A page module: see page-modules.js.

// Search reads the complete map, including folded branches and boxes inside another box.
/** @param {any} state @param {{ nodes: any[], edges: any[] }} additions @param {string} query @param {(n: any) => boolean} allowed */
export function searchBoxes(state, additions, query, allowed){
  const normalize = (/** @type {any} */ s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length || !state) return [];
  /** @type {any[]} */ const rows = [];
  const collect = (/** @type {any} */ nodes, /** @type {any} */ edges, /** @type {any} */ container, /** @type {any} */ location) => {
    for (const n of nodes){
      if (!allowed(n)) continue;
      const parent = nodes.find((/** @type {any} */ p) => edges.some((/** @type {any} */ e) => e.from === p.id && e.to === n.id));
      const fields = [n.label, n.sub, n.desc, n.note].map((v) => typeof v === 'string' ? v : '');
      const text = normalize(fields.join(' '));
      if (terms.every((t) => text.includes(t))){
        const matched = fields.slice(1).find((f) => terms.some((t) => normalize(f).includes(t))) || n.sub || '';
        const first = Math.min(...terms.map((t) => normalize(matched).indexOf(t)).filter((i) => i >= 0));
        const start = Number.isFinite(first) ? Math.max(0, first - 45) : 0;
        const snippet = (start ? '…' : '') + matched.slice(start, start + 160) + (matched.length > start + 160 ? '…' : '');
        rows.push({id:n.id, label:n.label, container, location:[location, parent && allowed(parent) ? parent.label : ''].filter(Boolean).join(' / '), snippet, rank:terms.every((t) => normalize(n.label).includes(t)) ? 0 : 1});
      }
      if (n.inside) collect(n.inside.nodes || [], n.inside.edges || [], n.id, n.label);
    }
  };
  collect([...state.nodes, ...additions.nodes], [...state.edges, ...additions.edges], 'system', '');
  return rows.sort((a,b) => a.rank - b.rank);
}
