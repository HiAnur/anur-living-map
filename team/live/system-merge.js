// A system map drawn again keeps what people did to it: the drawing replaces only what code drew. Kept:
//   boxes people added (not origin 'code'), on the level of the same parent box, else the top
//   what a person changed on a drawn box: its name, line and notes (a person last edited it), where they moved it,
//   and its Action; a drawn box holding an Action stays even when the code no longer shows it, so no Action is lost
//   lines people drew, when both ends are still there: a line not marked origin 'code' on a map whose drawn lines
//   are marked, and on an older map, a line to or from a box people added

import { allBoxesOf, graphOfBox, graphsOf } from './map-walk.js';

/**
 * The map drawn again, with what people did to the map before it.
 * @param {any} before the map as it is @param {any} drawn the map as code drew it again @returns {any} `drawn`, changed
 */
export function keepHandEdits(before, drawn) {
  const byHand = (/** @type {any} */ n) => n.origin !== 'code';
  const edited = (/** @type {any} */ n) => !!n.updatedBy && n.updatedBy !== 'Claude';
  const marked = graphsOf(before).some((g) => (g.edges || []).some((/** @type {any} */ e) => e.origin === 'code'));
  const handIds = new Set(allBoxesOf(before).filter(byHand).map((/** @type {any} */ n) => n.id));
  const handLine = (/** @type {any} */ e) => marked ? e.origin !== 'code' : handIds.has(e.from) || handIds.has(e.to);
  const has = (/** @type {string} */ id) => allBoxesOf(drawn).some((/** @type {any} */ n) => n.id === id);
  /** the level a box goes on in the new drawing: inside the same parent box when it is still there @param {string | null} parent */
  const levelFor = (parent) => {
    const p = parent ? allBoxesOf(drawn).find((/** @type {any} */ n) => n.id === parent) : null;
    if (!p) return drawn;
    p.inside ||= { nodes: [], edges: [] };
    return p.inside;
  };
  /** @param {any[]} nodes @param {string | null} parent */
  const walk = (nodes, parent) => {
    for (const n of nodes || []) {
      const now = allBoxesOf(drawn).find((/** @type {any} */ m) => m.id === n.id);
      if (now) {
        // a drawn box someone changed keeps their words, their place and its Action
        if (!byHand(n) && edited(n)) Object.assign(now, Object.fromEntries(['label', 'sub', 'desc', 'updatedBy', 'updatedAt'].filter((k) => k in n).map((k) => [k, n[k]])));
        if (n.moved) Object.assign(now, { x: n.x, y: n.y, moved: true });
        if (n.action) now.action = n.action;
      } else if (byHand(n) || n.action) {
        (levelFor(parent).nodes ||= []).push(structuredClone(n));
        continue;
      }
      walk(n.inside?.nodes, n.id);
    }
  };
  walk(before.nodes, null);
  for (const g of graphsOf(before)) for (const e of g.edges || []) {
    if (!handLine(e) || !has(e.from) || !has(e.to)) continue;
    const level = graphOfBox(drawn, e.from);
    if (level !== graphOfBox(drawn, e.to)) continue;
    level.edges ||= [];
    if (!level.edges.some((/** @type {any} */ x) => x.from === e.from && x.to === e.to)) level.edges.push(structuredClone(e));
  }
  return drawn;
}
