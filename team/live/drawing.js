// What a drawing does to the map: the plan and edit actions and an applied proposal all draw through here, after
// draw-guard.js has cut them to what the sender may draw. The map passes in its state and the helpers it needs.
import { diagramOf } from './diagram.js';
import { guardDrawing } from './draw-guard.js';
import { placeNew } from './project.js';

/** @param {{ getState: () => MapState, nodeOf: (id: any) => any, seesOf: (by: any) => string, unlinkEdge: (from: any, to: any) => boolean }} deps */
export function drawing({ getState, nodeOf, seesOf, unlinkEdge }) {
  // boxes, lines and calls are added or updated by id; removed boxes go
  /** @param {any} p @param {any} by @param {any} source */
  return function draw(p, by, source) {
    // only what draw-guard.js lets this sender draw: a box's content, on boxes in their area
    p = guardDrawing(p, nodeOf, seesOf(by), (id) => getState().calls.find((/** @type {any} */ c) => c.id === id));
    // A drawing can change a box's content, but its original creator, source and dates come from the map.
    const markCreators = (/** @type {any} */ nodes, /** @type {any} */ previous) => {
      for (const n of nodes || []) if (n) {
        const prior = previous?.find((/** @type {any} */ box) => box.id === n.id);
        delete n.createdAt; delete n.updatedAt; delete n.updatedBy; delete n.source;
        delete n.by;
        if (prior?.by) n.by = prior.by;
        else if (!prior) n.by = by;
        if (prior?.source) n.source = prior.source;
        else if (!prior) n.source = source;
        markCreators(n.inside?.nodes, prior?.inside?.nodes);
      }
    };
    markCreators(p.nodes, getState().nodes);
    for (const n of p.nodes || []) if (n && 'diagram' in n) n.diagram = diagramOf(n.diagram);
    const merge = (/** @type {any} */ list, /** @type {any} */ key, /** @type {any} */ items = []) => {
      for (const it of items) {
        const k = key(it), had = list.find((/** @type {any} */ x) => key(x) === k);
        if (had) Object.assign(had, it); else list.push(it);
      }
    };
    merge(getState().nodes, (/** @type {any} */ n) => n.id, p.nodes);
    merge(getState().edges, (/** @type {any} */ e) => `${e.from}>${e.to}`, p.edges);
    // a new box with no place goes where its lines cross nothing
    placeNew(getState().nodes, getState().edges, getState().start);
    merge(getState().calls, (/** @type {any} */ c) => c.id, p.calls);
    // a box holding an Action leaves only by its author's or an Admin's own hand (action-leave.js), never in a drawing
    for (const id of p.remove || []) if (!nodeOf(id)?.action) getState().nodes = getState().nodes.filter((/** @type {any} */ n) => n.id !== id);
    for (const e of p.unlink || []) unlinkEdge(e.from, e.to);
  };
}
