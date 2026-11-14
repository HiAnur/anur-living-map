// Drawing on the map by hand: boxes, lines, moves and Tidy up. The map passes in its state and the helpers it needs.
import { forgetPrerequisites, leaving } from './action-leave.js';
import { branchIds, reparentTopic } from './editing.js';
import { allBoxesOf, allLinesOf, graphsOf } from './map-walk.js';
import { tidy, tidyLevel } from './project.js';


/**
 * @param {{ getState: () => any, nodeOf: (id: any) => any, seesOf: (by: any) => string, sideOf: (v: any) => any, tell: Function,
 *   pendingProposals: (by?: any) => any[], unlinkEdge: (from: any, to: any) => boolean, placeProposed: Function }} deps
 */
export function boxActs({ getState, nodeOf, seesOf, sideOf, tell, pendingProposals, unlinkEdge, placeProposed }) {
  return {
    /** @param {Act<'add'>} a */
    add(a) {
      const label = String(a.label || '').trim().slice(0, 80);
      if (!label || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
      const inside = a.view && a.view !== 'system' ? nodeOf(a.view)?.inside : null, list = inside ? inside.nodes : getState().nodes;
      if (!list) return false;
      const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'box';
      let id = base; for (let i = 2; nodeOf(id) || getState().archived?.some((/** @type {any} */ x) => x.box.id === id); i++) id = `${base}-${i}`;
      // the box keeps the size it was drawn at (the page grows it only when its words need more room)
      const sees = seesOf(a.by), w = Math.round(Number(a.w)), h = Math.round(Number(a.h));
      // Keyboard insertion moves later branches in the same action, so undo restores their positions too.
      const reflow = a.reflow ?? [];
      if (!Array.isArray(reflow) || reflow.length > list.length || new Set(reflow.map((m) => m?.id)).size !== reflow.length) return false;
      if (reflow.some((m) => { const n = list.find((/** @type {any} */ n) => n.id === m?.id); return !n || !Number.isFinite(m.fromY) || !Number.isFinite(m.y) || n.y !== m.fromY || (sees !== 'all' && n.area !== sees); })) return false;
      for (const m of reflow) list.find((/** @type {any} */ n) => n.id === m.id).y = Math.round(m.y);
      list.push({ id, label, x: Math.round(a.x), y: Math.round(a.y), by: a.by, source: { kind: 'map' }, moved: true, ...(w >= 60 && w <= 800 ? { w } : {}), ...(h >= 36 && h <= 600 ? { h } : {}), ...(sees !== 'all' ? { area: sees } : {}) });
      // drawn by dragging a line out of another box's dot onto empty map: the line comes with it
      const from = a.from ? nodeOf(a.from) : null;
      if (from && (sees === 'all' || from.area === sees)) (inside ? (inside.edges ??= []) : getState().edges).push({ from: from.id, to: id, ...(sideOf(a.out) ? { out: a.out } : {}), ...(sideOf(a.in) ? { in: a.in } : {}) });
      a.created = id;
      tell(`${a.by} drew the box ${label}${from ? `, with a line from ${from.label}` : ''}`);
      return true;
    },
    /** @param {Act<'reparent'>} a */
    reparent(a) {
      const sees = seesOf(a.by);
      if (!reparentTopic(getState(), a, (n) => sees === 'all' || n.area === sees)) return false;
      tell(`${a.by} moved ${nodeOf(a.id).label} under ${nodeOf(a.parent).label}`);
      return true;
    },
    /** @param {Act<'move'>} a */
    move(a) {
      if (Array.isArray(a.moves)){
        const sees = seesOf(a.by), moves = a.moves;
        if (!moves.length || new Set(moves.map((/** @type {any} */ m) => m?.id)).size !== moves.length || moves.some((/** @type {any} */ m) => { const n = nodeOf(m?.id); return !n || (sees !== 'all' && n.area !== sees) || ![m.fromX,m.fromY,m.x,m.y].every(Number.isFinite) || n.x !== m.fromX || n.y !== m.fromY; })) return false;
        for (const m of moves) Object.assign(nodeOf(m.id),{x:Math.round(m.x),y:Math.round(m.y),moved:true});
        return true;
      }
      // an id without both x and y never gets here: move's rule in commands.js refuses it
      const n = nodeOf(a.id) || pendingProposals(a.by).flatMap((p) => p.plan.nodes).find((x) => x.id === a.id && Number.isFinite(x.x));
      if (!n) return false; n.x = Math.round(/** @type {number} */ (a.x)); n.y = Math.round(/** @type {number} */ (a.y));
      // put there by a person: Tidy up keeps its side and order (a box still only proposed is not on the map yet)
      if (nodeOf(a.id)) n.moved = true;
      return true;
    },
    // drawn by hand on the map: a box where it was drawn (a.view: inside that box; box-acts.js), a line from one box to another
    // (words on it optional; drawing one that exists changes its words), and a box taken off the map, its lines with
    // it. Someone who sees one area draws in that area and takes off only what is in it
    // a line dragged out of a box's dot keeps the side it left from (out) and the side it arrives on (in): t r b l
    /** @param {Act<'connect'>} a */
    connect(a) {
      const from = nodeOf(a.from), to = nodeOf(a.to); if (!from || !to || from === to) return false;
      const out = sideOf(a.out), inn = sideOf(a.in), sides = { ...(out ? { out } : {}), ...(inn ? { in: inn } : {}) };
      const sees = seesOf(a.by); if (sees !== 'all' && [from, to].some((n) => n.area !== sees)) return false;
      const inside = a.view && a.view !== 'system' ? nodeOf(a.view)?.inside : null, edges = inside ? (inside.edges ??= []) : getState().edges;
      const label = String(a.label || '').trim().slice(0, 40), had = edges.find((/** @type {any} */ e) => e.from === from.id && e.to === to.id);
      if (had) { if (!label && !out && !inn) return false; if (label) had.label = label; Object.assign(had, sides); } else edges.push({ from: from.id, to: to.id, ...(label ? { label } : {}), ...sides });
      tell(`${a.by} drew a line ${from.label} → ${to.label}${label ? ` (${label})` : ''}`);
      return true;
    },
    // a box resized from a corner: its new middle and size; a person put it there, so Tidy up keeps it
    /** @param {Act<'resize'>} a */
    resize(a) {
      const n = nodeOf(a.id); if (!n) return false;
      const sees = seesOf(a.by); if (sees !== 'all' && n.area !== sees) return false;
      const w = Math.round(Number(a.w)), h = Math.round(Number(a.h));
      if (!(w >= 60 && w <= 800 && h >= 36 && h <= 600) || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return false;
      Object.assign(n, { x: Math.round(a.x), y: Math.round(a.y), w, h, moved: true });
      return true;
    },
    // a box on a map that builds on a system map points at the box there it is about, or no longer does; only the
    // box's id is kept, so each viewer reads its name from the system map as they may see it (a private repo's
    // boxes stay unnamed for someone who can't read it)
    /** @param {Act<'pointbox'>} a */
    pointbox(a) {
      const n = nodeOf(a.id), base = getState().buildsOn; if (!n || !base) return false;
      const sees = seesOf(a.by); if (sees !== 'all' && n.area !== sees) return false;
      const box = String(a.box || '');
      if (!box) { if (!n.pointsAt) return false; delete n.pointsAt; tell(`${a.by} took the pointer off ${n.label}`); return true; }
      if (!/^[\w.:-]{1,120}$/.test(box)) return false;
      n.pointsAt = { map: base.name, box };
      tell(`${a.by} pointed ${n.label} at a box in ${base.title}`);
      return true;
    },
    // a line's words changed by a double click on them; empty words take them off the line
    /** @param {Act<'relabel'>} a */
    relabel(a) {
      const from = nodeOf(a.from), to = nodeOf(a.to); if (!from || !to) return false;
      const sees = seesOf(a.by); if (sees !== 'all' && [from, to].some((n) => n.area !== sees)) return false;
      const all = allLinesOf(getState());
      const e = all.find((x) => x.from === from.id && x.to === to.id); if (!e) return false;
      const label = String(a.label || '').trim().slice(0, 40); if ((e.label || '') === label) return false;
      if (label) e.label = label; else delete e.label;
      tell(`${a.by} ${label ? `named the line ${from.label} → ${to.label} "${label}"` : `took the words off the line ${from.label} → ${to.label}`}`);
      return true;
    },
    // a line picked on the map and deleted, by hand
    /** @param {Act<'unlink'>} a */
    unlink(a) {
      const from = nodeOf(a.from), to = nodeOf(a.to); if (!from || !to) return false;
      const sees = seesOf(a.by); if (sees !== 'all' && [from, to].some((n) => n.area !== sees)) return false;
      if (!unlinkEdge(from.id, to.id)) return false;
      tell(`${a.by} took the line ${from.label} → ${to.label} off the map`);
      return true;
    },
    /** @param {Act<'remove'>} a */
    remove(a) {
      const roots = Array.isArray(a.ids) ? a.ids : [a.id];
      if (!roots.length || roots.some((/** @type {any} */ id) => !nodeOf(id))) return false;
      const ids = a.cascade ? branchIds(getState(), roots) : new Set(roots), sees = seesOf(a.by);
      if ([...ids].some((id) => !nodeOf(id) || (sees !== 'all' && nodeOf(id).area !== sees))) return false;
      // a box holding an Action goes only as action-leave.js allows: by its author or an Admin, and never once it has run
      if ([...ids].some((id) => leaving(getState(), nodeOf(id), a.by) !== 'remove')) return false;
      const label = nodeOf(roots[0]).label;
      const drop = (/** @type {any} */ s) => { s.nodes = s.nodes.filter((/** @type {any} */ n) => !ids.has(n.id)); s.edges = (s.edges || []).filter((/** @type {any} */ e) => !ids.has(e.from) && !ids.has(e.to)); };
      for (const g of graphsOf(getState())) drop(g);
      forgetPrerequisites(allBoxesOf(getState()), ids, a.by);
      tell(`${a.by} took ${label}${ids.size > 1 ? ' and its branch' : ''} off the map`);
      return true;
    },
    // Tidy up, for everyone, laid out for what the person pressing it can see (a.only: the boxes not folded away
    // in their window): every level, on every map, as a mind map round its circle (tidyLevel in project.js). A level
    // that cannot be one puts its showing boxes that are off the grid on it, with no line through a box. None moves
    // anything when pressed twice. Boxes Claude proposed and nobody applied yet find new places around it.
    /** @param {Act<'tidy'>} a */
    tidy(a) {
      const box = a.view && a.view !== 'system' ? nodeOf(a.view) : null, inside = box?.inside || null, level = inside || getState();
      const list = level.nodes, edges = level.edges || [], only = Array.isArray(a.only) ? new Set(a.only.map(String)) : null;
      if (!list?.length) return false;
      // each box as big as the page measured it; the circle's size is the layout's own
      const sizes = new Map();
      for (const s of Array.isArray(a.sizes) ? a.sizes : []) if (s && typeof s.id === 'string' && Number.isFinite(s.w) && s.w >= 60 && s.w <= 800 && Number.isFinite(s.h) && s.h >= 36 && s.h <= 2000) sizes.set(s.id, {w:s.w, h:s.h});
      // a box someone dragged or drew keeps its side and order; every box Claude placed is regrouped and rebalanced
      const where = inside ? { top: false, label: box.label } : { top: true, start: getState().start, label: getState().title };
      const done = tidyLevel(level, where, { only, chosen: (n) => Number.isFinite(n.x) && n.moved, sizes });
      if (!done) tidy(list, edges, only);
      if (!inside) for (const p of pendingProposals()) placeProposed(p.plan);
      return true;
    },
  };
}
