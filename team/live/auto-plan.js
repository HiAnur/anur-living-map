import { readPlannedTask } from './action-plan.js';

export const AUTO_PLAN_QUESTION = 'Find what is missing in this topic and its children, using the whole map.';

export const autoPlanPrompt = (id) => `This is Auto plan for the selected box (${id}) and its entire branch.
Read the entire accessible map below, not just the selected box or what is currently on screen. This applies equally when the selected box is a parent or a leaf.
Follow the lines by id to inspect all children and deeper descendants, their descriptions, and the selected box's ancestors, siblings and related topics elsewhere on the map. Use the map's questions, decisions, memory and this side chat too.
Determine the intended outcome from the map and this conversation, including relevant context from other maps when needed. Auto plan already asks you to find useful gaps in the selected branch; do not automatically ask what the plan should help the person decide or do. If the available context supports a useful plan, proceed directly.
Ask one short, specific clarifying question only when essential information is missing and different answers would materially change the plan. Name the missing detail, rather than asking a generic goal question. Offer two or three concrete choices when useful. Do not guess, propose boxes, or include a map block in that reply. After they answer, use their clarification with the whole map to continue planning. Do not ask again for information already available in the map or conversation.
Find meaningful gaps in the selected branch in that whole-map context. Check what is already covered anywhere on the map before suggesting additions; do not duplicate it under a different name.
Classify each proposed box as a Topic or an Action. A Topic organizes information or decisions. An Action produces a specific, checkable result. Turn broad goals into concrete Action children where work is missing.
Assess readiness separately using the executing Claude Code session's available tools, context and permissions. Missing information makes an Action blocked; it does not make it a Topic. Do not assume that tools available to this planning chat are also available to the executing session.
Set boxType to "topic" or "action" on every new node. Action nodes also need a task object: {"goal":"the concrete task and why it advances the parent","result":"the checkable deliverable","destination":"where to save or attach it, or empty when unknown","inputs":["context or input needed"],"steps":["concrete step"],"evidence":["proof of completion"],"dependsOn":["prerequisite Action box id"],"readiness":"ready|needs_information|waiting","blockers":[{"detail":"missing fact, access or decision","resolver":"who or what can resolve it"}]}. Use exact existing or proposed Action ids for dependsOn. Do not place tasks in desc alone or supply runtime action, stage, session or completion fields.
Readiness is a planning assessment, never permission to run. If execution access has not been verified, use needs_information. Applying a plan creates boxes; Actions still require the separate preparation, review and Execute flow. Missing facts that can be researched belong in inputs or research Actions; ask the person only for choices or information the tools cannot resolve.
Propose only as many specific additions as meaningful gaps require. There is no target number, and zero additions is valid. Avoid generic filler and assumed facts. If nothing useful is missing, say so without a map block.
Use available context and lookup tools to resolve discoverable unknowns. When the outcome is clear but an action lacks an input, keep it as an Action with the blocker stated and continue planning independent work. Ask first only when missing information prevents a useful plan or requires a decision only the person can make.
Explain briefly what is missing and where each addition belongs, then include a map block with new nodes and one edge to each new node.
Attach each addition to the most relevant box in the selected branch: ${id}, any existing descendant, or another proposed box rooted in that branch. Create deeper branches when steps need separate results or dependencies. For example, a missing role belongs under Categories, not automatically under ${id}.
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
  const candidates = new Map(), destinations = new Map(), dropped = [];
  const proposedEdges = Array.isArray(plan?.edges) ? plan.edges : [];
  for (const n of (Array.isArray(plan?.nodes) ? plan.nodes : []).slice(0, 100)) {
    if (!n || typeof n.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(n.id) || ids.has(n.id) || typeof n.label !== 'string') continue;
    const label = n.label.trim().slice(0, 80), key = name(label);
    if (!key || labels.has(key)) continue;
    if (n.boxType !== undefined && !['topic','action'].includes(n.boxType)) continue;
    const task = n.boxType === 'action' ? readPlannedTask(n.task) : null;
    if (n.boxType === 'action' && !task) { dropped.push({text:label,why:'Action needs a valid goal, result and task details'}); continue; }
    const incoming = proposedEdges.filter((e) => e?.to === n.id);
    const from = incoming.length === 0 ? parent : incoming.length === 1 ? incoming[0].from : null;
    if (!from) continue;
    ids.add(n.id); labels.add(key);
    const sub = (typeof n.sub === 'string' ? n.sub : typeof n.desc === 'string' ? n.desc.split('\n')[0] : '').trim().slice(0, 160);
    candidates.set(n.id, { id:n.id,label,...(sub ? {sub} : {}),...(typeof n.desc === 'string' ? {desc:n.desc.slice(0, 4000)} : {}),
      ...(n.boxType ? {boxType:n.boxType} : {}),...(task ? {task} : {}),state:'new' });
    destinations.set(n.id, from);
  }
  const existingTasks = new Map(existing.filter((n) => accessible.has(n.id) && n.action).map((n) => [n.id,n.action.plan || {dependsOn:[]} ]));
  const reaches = (id, goal, seen = new Set()) => {
    if (id === goal) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (candidates.get(id)?.task || existingTasks.get(id))?.dependsOn?.some((next) => reaches(next, goal, seen)) || false;
  };
  // Removing a prerequisite or parent also removes dependent proposals, never silently reroutes them.
  let changed = true;
  while (changed) {
    changed = false;
    const reachable = new Set(branch);
    for (const id of reachable) for (const n of candidates.values()) if (destinations.get(n.id) === id) reachable.add(n.id);
    for (const [id,n] of candidates) {
      const badDependency = n.task?.dependsOn.some((dep) => !(candidates.get(dep)?.task || existingTasks.has(dep)) || reaches(dep,id));
      if (!reachable.has(id) || badDependency) {
        candidates.delete(id); changed = true;
        dropped.push({text:n.label,why:badDependency ? 'a prerequisite is unavailable, not an Action, or forms a cycle' : 'its parent is outside the accessible branch'});
      }
    }
  }
  return {nodes:[...candidates.values()],edges:[...candidates.keys()].map((id) => ({from:destinations.get(id),to:id})),...(dropped.length ? {dropped} : {})};
}
