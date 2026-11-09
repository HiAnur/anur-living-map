export const AUTO_PLAN_QUESTION = 'Find what is missing in this topic and its children, using the whole map.';

export const autoPlanPrompt = (id) => `This is Auto plan for the selected box (${id}) and its entire branch.
Read the entire accessible map below, not just the selected box or what is currently on screen. This applies equally when the selected box is a parent or a leaf.
Follow the lines by id to inspect all children and deeper descendants, their descriptions, and the selected box's ancestors, siblings and related topics elsewhere on the map. Use the map's questions, decisions, memory and this side chat too.
Determine the intended outcome from the map and this conversation, including relevant context from other maps when needed. Auto plan already asks you to find useful gaps in the selected branch; do not automatically ask what the plan should help the person decide or do. If the available context supports a useful plan, proceed directly.
Ask one short, specific clarifying question only when essential information is missing and different answers would materially change the plan. Name the missing detail, rather than asking a generic goal question. Offer two or three concrete choices when useful. Do not guess, propose boxes, or include a map block in that reply. After they answer, use their clarification with the whole map to continue planning. Do not ask again for information already available in the map or conversation.
Find meaningful gaps in the selected branch in that whole-map context. Check what is already covered anywhere on the map before suggesting additions; do not duplicate it under a different name.
Propose one to five specific additions, only as many as help. Avoid generic filler and assumed facts. If nothing useful is missing, say so without a map block.
Explain briefly what is missing and where each addition belongs, then include a map block with new nodes and one edge to each new node.
Attach each addition to the most relevant EXISTING box in the selected branch: ${id} or any of its descendants. For example, a missing role belongs under an existing Categories child, not automatically under ${id}.
Other branches are context: mention a related gap there if useful, but only propose additions inside the selected branch.
Use the exact existing parent ids, new lowercase ids, short labels, a brief sub description visible on each box, and a short desc explaining each suggestion. Do not edit or remove existing boxes, reorganize the map or change its instructions.`;

// Follow only accessible boxes, with a visited set for maps containing cross-links or cycles.
function branchIds(parent, existing, edges, accessible) {
  const available = new Set(existing.filter((n) => accessible.has(n.id)).map((n) => n.id));
  const branch = new Set(available.has(parent) ? [parent] : []);
  for (const id of branch) for (const e of edges) {
    if (e.from === id && available.has(e.to)) branch.add(e.to);
  }
  return branch;
}

// Recheck the destination and duplicates on Apply, when the map or access may have changed.
export function autoPlanAdditions(plan, parent, existing, edges, accessible = new Set(existing.map((n) => n.id))) {
  const ids = new Set(existing.map((n) => n.id));
  const branch = branchIds(parent, existing, edges, accessible);
  const name = (label) => String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const labels = new Set(existing.filter((n) => accessible.has(n.id)).map((n) => name(n.label)));
  const nodes = [], additions = [];
  const proposedEdges = Array.isArray(plan?.edges) ? plan.edges : [];
  for (const n of Array.isArray(plan?.nodes) ? plan.nodes : []) {
    if (nodes.length === 5) break;
    if (!n || typeof n.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(n.id) || ids.has(n.id) || typeof n.label !== 'string') continue;
    const incoming = proposedEdges.filter((e) => e?.to === n.id);
    // Old offers without edges still attach to the selected box. Never redirect an invalid explicit destination.
    const from = incoming.length === 0 ? parent : incoming.length === 1 ? incoming[0].from : null;
    if (!branch.has(from)) continue;
    const label = n.label.trim().slice(0, 80), key = name(label);
    if (!key || labels.has(key)) continue;
    ids.add(n.id); labels.add(key);
    const sub = (typeof n.sub === 'string' ? n.sub : typeof n.desc === 'string' ? n.desc.split('\n')[0] : '').trim().slice(0, 160);
    nodes.push({ id: n.id, label, ...(sub ? {sub} : {}), ...(typeof n.desc === 'string' ? { desc: n.desc.slice(0, 1000) } : {}), state: 'new' });
    additions.push({ from, to: n.id });
  }
  return { nodes, edges: additions };
}
