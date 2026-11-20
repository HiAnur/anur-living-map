import { forgetPrerequisites, leaving } from './action-leave.js';
import { allBoxesOf, graphsOf } from './map-walk.js';
import { tidyLevel } from './project.js';

/** Apply an outline to a validated copy, keeping side relationships and the boxes' attached content.
 * @param {any} state @param {any[]} sections @param {any[]} originals @param {string} by
 * @returns {string | null} a reason the edit cannot be applied
 */
export function noteStructure(state, sections, originals, by) {
  const incoming = new Map(sections.map((s) => [s.id, s])), old = new Map(originals.map((s) => [s.id, s]));
  const gone = new Set(originals.filter((s) => !incoming.has(s.id)).map((s) => s.id));
  const boxes = new Map(allBoxesOf(state).map((n) => [n.id, n]));
  if ([...gone].some((id) => !boxes.get(id) || leaving(state, /** @type {Box} */ (boxes.get(id)), by) !== 'remove')) return 'A removed heading holds an Action that must stay on record. Keep that heading and archive its box from Map.';
  for (const s of sections) {
    if (s.graph && (!incoming.has(s.graph) || !boxes.get(s.graph)?.inside)) return 'Keep the heading for the map that contains this section.';
    const parent = s.parent && incoming.get(s.parent);
    if (s.parent && (!parent || (parent.graph !== s.graph && parent.id !== s.graph))) return 'A heading must stay inside the map that contains it.';
  }
  for (const graph of graphsOf(state)) {
    graph.nodes = graph.nodes.filter((/** @type {any} */ n) => !gone.has(n.id));
    const ids = new Set(graph.nodes.map((/** @type {any} */ n) => n.id));
    const desired = sections.filter((s) => ids.has(s.id) && ids.has(s.parent));
    const pair = (/** @type {string} */ from, /** @type {string} */ to) => `${from}\0${to}`;
    const parents = new Set(desired.map((s) => pair(s.parent, s.id)));
    graph.edges = (graph.edges || []).filter((/** @type {any} */ e) => !gone.has(e.from) && !gone.has(e.to) && !(old.get(e.to)?.parent === e.from && !parents.has(pair(e.from, e.to))))
      .map((/** @type {any} */ e) => { const next = { ...e }; if (parents.has(pair(e.from, e.to))) delete next.sideLink; else next.sideLink = true; return next; });
    for (const s of desired) if (!graph.edges.some((/** @type {any} */ e) => e.from === s.parent && e.to === s.id)) graph.edges.push({ from: s.parent, to: s.id });
    const first = sections.find((s) => ids.has(s.id) && !ids.has(s.parent));
    const owner = graph === state ? '' : [...boxes.values()].find((n) => n.inside === graph)?.id || '';
    const ordered = sections.filter((s) => s.graph === owner);
    const changed = ordered.some((s) => !old.has(s.id) || old.get(s.id).parent !== s.parent) || JSON.stringify(ordered.map((s) => s.id)) !== JSON.stringify(originals.filter((s) => s.graph === owner).map((s) => s.id));
    if (graph === state) state.start = first?.id;
    if (changed) {
      // The shared layout places the changed tree. Prose edits leave all saved positions alone.
      for (const [i, s] of sections.filter((s) => ids.has(s.id)).entries()) {
        const n = graph.nodes.find((/** @type {any} */ n) => n.id === s.id); n.y = i * 100; n.x = s.depth * 280; n.outlineOrder = i;
      }
      tidyLevel(graph, { top: graph === state, start: graph === state ? state.start : null, label: graph === state ? state.title : '' });
    }
  }
  forgetPrerequisites(allBoxesOf(state), gone, by);
  return null;
}
