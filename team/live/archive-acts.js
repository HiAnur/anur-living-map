// Archiving an Action box that has run: the box leaves the map with its Action and its lines, and is kept in
// state.archived, where the page lists it and Restore puts it back where it was. action-leave.js says who may.
import { managesAccess } from './access.js';
import { leaving } from './action-leave.js';
import { note } from './action-box.js';

/** @param {{ getState: () => MapState, nodeOf: (id: any) => Box | undefined, seesOf: (by: any) => string, tell: Function }} deps */
export function archiveActs({ getState, nodeOf, seesOf, tell }) {
  /** @param {Box} n @param {string | undefined} by */
  const inArea = (n, by) => seesOf(by) === 'all' || n.area === seesOf(by);
  return {
    /** @param {Act<'actionarchive'>} a */
    actionarchive(a) {
      const n = nodeOf(a.id);
      if (!n?.action || !inArea(n, a.by) || leaving(getState(), n, a.by) !== 'archive') return false;
      const holder = getState().nodes.find((p) => p.inside?.nodes?.includes(n)), s = holder?.inside || getState();
      const edges = (s.edges || []).filter((/** @type {Line} */ e) => e.from === n.id || e.to === n.id);
      s.nodes = s.nodes.filter((/** @type {Box} */ x) => x !== n);
      s.edges = (s.edges || []).filter((/** @type {Line} */ e) => !edges.includes(e));
      note(n.action, 'archived', /** @type {string} */ (a.by));
      (getState().archived ??= []).push({ box: n, edges, in: holder?.id ?? null, by: a.by, at: Date.now() });
      tell(`${a.by} archived ${n.label}`);
      return true;
    },
    // back where it was, with the lines whose other box is still on the map; inside a box that has gone, it
    // comes back on the map itself
    /** @param {Act<'actionunarchive'>} a */
    actionunarchive(a) {
      const list = getState().archived || [], i = list.findIndex((/** @type {any} */ x) => x.box.id === String(a.id));
      if (i < 0) return false;
      const { box, edges, in: inside } = list[i];
      if (nodeOf(box.id) || !inArea(box, a.by) || (box.action?.by !== a.by && !managesAccess(getState(), a.by))) return false;
      const s = (inside && nodeOf(inside)?.inside) || getState();
      s.nodes.push(box);
      (s.edges ??= []).push(...edges.filter((/** @type {Line} */ e) => nodeOf(e.from) && nodeOf(e.to)));
      list.splice(i, 1);
      if (box.action) note(box.action, 'restored', /** @type {string} */ (a.by));
      tell(`${a.by} put ${box.label} back on the map`);
      return true;
    },
  };
}
