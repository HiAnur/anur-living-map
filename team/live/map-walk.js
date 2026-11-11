// Walking a map at any depth: a box may hold a map inside it (`inside: { nodes, edges }`), whose boxes may hold
// maps of their own. Everything that looks for a box, a line or where a box sits reads them through these, so no
// level is missed. A page module too (see page-modules.js): it imports nothing.

/** Every graph in a map: the map itself, then each box's inside, at any depth. @param {any} state @returns {any[]} */
export const graphsOf = (state) => [state, ...(state?.nodes || []).flatMap((/** @type {any} */ n) => n.inside ? graphsOf(n.inside) : [])];

/** Every box at any depth. @param {any} state @returns {Box[]} */
export const allBoxesOf = (state) => graphsOf(state).flatMap((g) => g.nodes || []);

/** Every line at any depth. @param {any} state @returns {Line[]} */
export const allLinesOf = (state) => graphsOf(state).flatMap((g) => g.edges || []);

/** A box by id, at any depth. @param {any} state @param {unknown} id @returns {Box | undefined} */
export const boxIn = (state, id) => allBoxesOf(state).find((n) => n.id === id);

/** The box whose inside holds the box with this id, or null when it sits on the map itself. @param {any} state @param {unknown} id @returns {Box | null} */
export const parentBoxOf = (state, id) => allBoxesOf(state).find((p) => p.inside?.nodes?.some((/** @type {any} */ m) => m.id === id)) || null;

/** The graph a box sits in: the map itself, or its parent box's inside. @param {any} state @param {unknown} id */
export const graphOfBox = (state, id) => parentBoxOf(state, id)?.inside || state;

/** The boxes from the top of the map down to this one's parent, outermost first. @param {any} state @param {unknown} id @returns {Box[]} */
export function pathTo(state, id) {
  /** @type {Box[]} */
  const path = [];
  for (let p = parentBoxOf(state, id); p; p = parentBoxOf(state, p.id)) path.unshift(p);
  return path;
}
