export const AUTO_PLAN_QUESTION = 'Suggest what to add next to this topic.';

export const autoPlanPrompt = (id) => `This is Auto plan: suggest the next useful child topics under the selected box (${id}).
Use the selected box, its existing children, the rest of the visible map and this side chat to find meaningful gaps.
Propose one to five specific additions, only as many as help. Avoid duplicates, generic filler and assumed facts.
If the map is too vague to make useful suggestions, ask one short clarifying question instead of proposing boxes.
Explain briefly why the additions belong here, then include a map block with new nodes and edges from ${id} to each new node.
Use new lowercase ids, short labels and a short desc explaining each suggestion. Do not edit or remove existing boxes, reorganize the map or change its instructions.`;

// Auto plan only adds children. Rechecking at Apply also protects boxes added while a suggestion was waiting.
export function autoPlanAdditions(plan, parent, existing, edges) {
  const ids = new Set(existing.map((n) => n.id));
  const children = new Set(edges.filter((e) => e.from === parent).map((e) => e.to));
  const name = (label) => String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const labels = new Set(existing.filter((n) => n.id === parent || children.has(n.id)).map((n) => name(n.label)));
  const nodes = [];
  for (const n of Array.isArray(plan?.nodes) ? plan.nodes : []) {
    if (nodes.length === 5) break;
    if (!n || typeof n.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(n.id) || ids.has(n.id) || typeof n.label !== 'string') continue;
    const label = n.label.trim().slice(0, 80), key = name(label);
    if (!key || labels.has(key)) continue;
    ids.add(n.id); labels.add(key);
    nodes.push({ id: n.id, label, ...(typeof n.desc === 'string' ? { desc: n.desc.slice(0, 1000) } : {}), state: 'new' });
  }
  return { nodes, edges: nodes.map((n) => ({ from: parent, to: n.id })) };
}
