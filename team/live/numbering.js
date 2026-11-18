import { boxIn, graphOfBox, parentBoxOf } from './map-walk.js';
import { numberingGroup, numberingTree } from './page-design.js';
import { levelGraph } from './page-hub.js';

/** Resolve the selected topic's siblings from the stored graph, including folded and nested topics.
 * @param {MapState} state @param {unknown} id
 */
export function numberingGroupOf(state, id) {
  const box = boxIn(state, id);
  if (!box) return null;
  const inside = parentBoxOf(state, id), level = graphOfBox(state, id);
  const graph = levelGraph(level, { top: !inside, start: state.start });
  return numberingGroup(graph.nodes, numberingTree(graph).parents, box.id, inside?.id || 'system');
}
