// What people write on the map itself: its name and description, the maps it draws background from, and
// comments. The map passes in its state and the helpers each needs.

/**
 * @param {{ getState: () => any, contextMaps: ((by: any) => any[]) | null, nodeOf: (id: any) => any,
 *   tell: Function, ownerOf: Function }} deps
 */
export function mapActs({ getState, contextMaps, nodeOf, tell, ownerOf }) {
  return {
    // Discovery combines this background with the current topics and decisions.
    /** @param {any} a */
    contextmap(a) {
      if (typeof a.id !== 'string' || typeof a.include !== 'boolean') return false;
      if (a.include && !(contextMaps?.(a.by) || []).some((/** @type {any} */ m) => m.id === a.id && m.allowed())) return false;
      const ids = new Set(getState().contextMapIds || []);
      if (a.include) ids.add(a.id); else ids.delete(a.id);
      getState().contextMapIds = [...ids];
      return true;
    },
    /** @param {any} a */
    describemap(a) {
      if (typeof a.description !== 'string' || a.description.length > 12000) return false;
      getState().desc = a.description.trim();
      return true;
    },
    // Renaming changes the title, not the map's address.
    /** @param {any} a */
    rename(a) {
      const title = String(a.title || '').trim().slice(0, 60);
      if (!title) return false;
      getState().title = title; getState().renamed = title;
      return true;
    },
    // Figma-style comments: a pin at a point on the map (or on a box), a thread of replies, resolvable
    /** @param {any} a */
    comment(a) {
      const text = String(a.text || '').trim().slice(0, 600); if (!text) return false;
      getState().comments ??= [];
      const c = { id: getState().comments.length + 1, x: Math.round(a.x), y: Math.round(a.y), view: a.view || 'system', node: a.node || null,
        resolved: false, msgs: [{ who: a.by, text, at: Date.now() }] };
      getState().comments.push(c);
      tell(`${a.by} commented${c.node ? ` on ${nodeOf(c.node)?.label || c.node}` : ''}: ${text}`, ownerOf(c.node));
      return true;
    },
    /** @param {any} a */
    reply(a) {
      const c = getState().comments?.find((/** @type {any} */ x) => x.id === Number(a.id)); const text = String(a.text || '').trim().slice(0, 600);
      if (!c || !text) return false;
      c.msgs.push({ who: a.by, text, at: Date.now() });
      tell(`${a.by} replied on comment #${c.id}: ${text}`, ownerOf(c.node));
      return true;
    },
    /** @param {any} a */
    resolve(a) { const c = getState().comments?.find((/** @type {any} */ x) => x.id === Number(a.id)); if (!c) return false; c.resolved = !c.resolved; return true; },
  };
}
