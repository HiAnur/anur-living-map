// What a drawing does to the map: the plan and edit actions and an applied proposal all draw through here, after
// draw-guard.js has cut them to what the sender may draw. The map passes in its state and the helpers it needs.
import { diagramOf } from './diagram.js';
import { guardDrawing } from './draw-guard.js';
import { boxIn, graphOfBox, movedUp } from './map-walk.js';
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
    const state = getState();
    // A box already on the map is changed where it is, at any depth. A new box goes into the level of a box it is
    // drawn to or from, else the level of the box the chat was about, else the top; it is placed there, among
    // that level's boxes, so where it was offered on another level does not count. A line goes into the level
    // holding both its ends.
    /** @type {Map<string, any>} */
    const home = new Map();
    const levelOf = (/** @type {string} */ id) => home.get(id) || (boxIn(state, id) ? graphOfBox(state, id) : null);
    const fresh = (p.nodes || []).filter((/** @type {any} */ n) => n && !boxIn(state, n.id));
    for (const n of p.nodes || []) if (n && !fresh.includes(n)) Object.assign(/** @type {any} */ (boxIn(state, n.id)), n);
    for (let round = 0; round < 3; round++) for (const n of fresh) {
      if (home.has(n.id)) continue;
      const linked = (p.edges || []).filter((/** @type {any} */ e) => e.from === n.id || e.to === n.id).map((/** @type {any} */ e) => levelOf(e.from === n.id ? e.to : e.from)).find(Boolean);
      if (linked || round === 2) home.set(n.id, linked || (source?.box && boxIn(state, source.box) ? graphOfBox(state, source.box) : state));
    }
    const levels = new Set();
    for (const n of fresh) {
      const level = home.get(n.id);
      if (level !== state) { delete n.x; delete n.y; }
      (level.nodes ||= []).push(n); levels.add(level);
    }
    for (const e of p.edges || []) {
      const a = levelOf(e.from), b = levelOf(e.to), level = a && a === b ? a : null;
      if (!level) continue;
      const had = (level.edges ||= []).find((/** @type {any} */ x) => x.from === e.from && x.to === e.to);
      if (had) Object.assign(had, e); else level.edges.push(e);
      levels.add(level);
    }
    // a new box with no place goes where its lines cross nothing
    placeNew(state.nodes, state.edges, state.start);
    for (const level of levels) if (level !== state) placeNew(level.nodes, level.edges || []);
    for (const c of p.calls || []) { const had = state.calls.find((/** @type {any} */ x) => x.id === c.id); if (had) Object.assign(had, c); else state.calls.push(c); }
    // a box holding an Action leaves only by its author's or an Admin's own hand (action-leave.js), never in a drawing
    // and a box that leaves takes its lines with it; what hung under it and is drawn no new line moves up (movedUp)
    const going = new Set((p.remove || []).filter((/** @type {any} */ id) => nodeOf(id) && !nodeOf(id).action));
    for (const level of new Set([...going].map((id) => graphOfBox(state, id)))) {
      const kept = movedUp(level, going, p.edges || []);
      level.nodes = level.nodes.filter((/** @type {any} */ n) => !going.has(n.id));
      level.edges = [...(level.edges || []).filter((/** @type {any} */ e) => !going.has(e.from) && !going.has(e.to)), ...kept];
    }
    for (const e of p.unlink || []) unlinkEdge(e.from, e.to);
  };
}
