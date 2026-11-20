// File dates belong to the document, rather than the temporary state file that an atomic save replaces. Opening
// a map, joining its people or reconnecting its chat does not count as editing its contents.

/** @param {any} state @param {{created?:number, modified?:number, now?:number}} [fallback] */
export function fileDates(state, { created = Date.now(), modified = created, now = Date.now() } = {}) {
  const date = (/** @type {any} */ value, /** @type {number} */ otherwise) => Number.isFinite(value) && value > 0 ? value : otherwise;
  const born = date(state.createdAt, created || now);
  let edited = date(state.modifiedAt, modified || now);
  const content = (/** @type {any} */ s) => JSON.stringify([s.title, s.desc, s.start, s.numbering, s.mindLayout, s.nodes, s.edges, s.calls, s.memory, s.comments, s.drawing], (key, value) => ['createdAt', 'updatedAt', 'updatedBy'].includes(key) ? undefined : value);
  let before = content(state);
  state.createdAt = born; state.modifiedAt = edited;
  return (/** @type {any} */ next, at = Date.now()) => {
    const after = content(next);
    if (after !== before) edited = at;
    before = after; next.createdAt = born; next.modifiedAt = edited;
  };
}
