// A note is another view of the boxes, at every depth. IDs stay outside the words people edit, so renaming a
// heading keeps its comments, decisions, Action, links and position. Side links stay on the map.

/** @param {any} box @returns {string} */
export function noteBody(box) {
  const sub = String(box.sub || ''), desc = String(box.desc || '');
  return desc.startsWith(sub) ? desc : [sub, desc].filter(Boolean).join('\n\n');
}

/** @param {any} state */
export function noteDocument(state) {
  /** @type {{id: string, label: string, body: string, parent: string, graph: string, depth: number, inside: boolean}[]} */
  const sections = [];
  const seen = new Set();
  /** @param {any} graph @param {string} owner @param {number} level */
  function walk(graph, owner, level) {
    const nodes = graph.nodes || [], edges = (graph.edges || []).filter((/** @type {any} */ e) => !e.sideLink);
    const byId = new Map(nodes.map((/** @type {any} */ n) => [n.id, n]));
    const adopted = new Set(), children = new Map();
    const start = nodes.find((/** @type {any} */ n) => n.id === graph.start);
    const roots = [start, ...nodes.filter((/** @type {any} */ n) => !edges.some((/** @type {any} */ e) => e.to === n.id && byId.has(e.from)))].filter(Boolean);
    /** @type {any[]} */ const treeRoots = [];
    // Choose parents breadth first, like the map: a side link cannot adopt a sibling before its direct parent.
    for (const root of [...roots, ...nodes]) {
      if (adopted.has(root.id)) continue;
      treeRoots.push(root); adopted.add(root.id);
      const queue = [root];
      for (let i = 0; i < queue.length; i++) {
        const node = queue[i], list = [];
        for (const edge of edges) if (edge.from === node.id && byId.has(edge.to) && !adopted.has(edge.to)) {
          const child = byId.get(edge.to); adopted.add(child.id); list.push(child); queue.push(child);
        }
        list.sort((a, b) => (Number.isFinite(a.outlineOrder) && Number.isFinite(b.outlineOrder) ? a.outlineOrder - b.outlineOrder : 0) || Number(a.x < node.x) - Number(b.x < node.x) || (a.y || 0) - (b.y || 0));
        children.set(node.id, list);
      }
    }
    /** @param {any} node @param {string} parent @param {number} depth */
    function visit(node, parent, depth) {
      if (seen.has(node.id)) return;
      seen.add(node.id);
      sections.push({ id: node.id, label: node.label || '', body: noteBody(node), parent, graph: owner, depth, inside: !!node.inside });
      if (node.inside) walk(node.inside, node.id, depth + 1);
      for (const child of children.get(node.id) || []) visit(child, node.id, depth + 1);
    }
    for (const n of treeRoots) visit(n, owner, level);
  }
  walk(state, '', 0);
  return { title: String(state.title || ''), description: String(state.desc || ''), sections };
}
