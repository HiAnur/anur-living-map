// A system map drawn again keeps what people did to it: the drawing replaces only what code drew. Kept:
//   boxes people added (not origin 'code'), on the level of the same parent box, else the top
//   what a person changed on a drawn box: its name, line and notes (a person last edited it), where they moved it,
//   and its Action; a drawn box holding an Action stays even when the code no longer shows it, so no Action is lost
//   lines people drew, when both ends are still there: a line not marked origin 'code' on a map whose drawn lines
//   are marked, and on an older map, a line to or from a box people added

import { allBoxesOf, allLinesOf, graphOfBox, graphsOf } from './map-walk.js';

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

/**
 * What a redraw would change on the map, for an Engineer to review before it lands: boxes code added, took away or
 * renamed or redescribed, and lines added or taken away. Each names its repo, so someone who may not read that repo
 * is not told of it (withoutRepos in sharing.js).
 * @param {any} before the map as it is @param {any} after the map as the redraw would leave it (keepHandEdits applied)
 * @returns {{ what: 'added' | 'gone' | 'changed', kind: 'box' | 'line', label: string, was?: string, repo?: string, toRepo?: string }[]}
 */
export function redrawChanges(before, after) {
  /** every box at any depth, with the repo it sits in @param {any} map */
  const boxes = (map) => {
    /** @type {Map<string, { n: any, repo?: string }>} */
    const out = new Map();
    /** @param {any[]} nodes @param {string | undefined} repo */
    const walk = (nodes, repo) => { for (const n of nodes || []) { const r = n.source?.repo || repo; out.set(n.id, { n, repo: r }); walk(n.inside?.nodes, r); } };
    walk(map.nodes, undefined);
    return out;
  };
  const was = boxes(before), now = boxes(after);
  /** @type {{ what: 'added' | 'gone' | 'changed', kind: 'box' | 'line', label: string, was?: string, repo?: string, toRepo?: string }[]} */
  const changes = [];
  const repoField = (/** @type {string | undefined} */ repo) => repo ? { repo } : {};
  for (const [id, { n, repo }] of now) {
    const o = was.get(id)?.n;
    if (!o) changes.push({ what: 'added', kind: 'box', label: String(n.label || id), ...repoField(repo) });
    else if (o.origin === 'code' && (o.label !== n.label || (o.sub || '') !== (n.sub || '')))
      changes.push({ what: 'changed', kind: 'box', label: String(n.label || id), ...(o.label !== n.label ? { was: String(o.label || '') } : {}), ...repoField(repo) });
  }
  for (const [id, { n, repo }] of was) if (!now.has(id)) changes.push({ what: 'gone', kind: 'box', label: String(n.label || id), ...repoField(repo) });
  /** every line, keyed by its ends @param {any} map @param {Map<string, { n: any, repo?: string }>} by */
  const lines = (map, by) => new Map(allLinesOf(map).map((/** @type {any} */ e) => [`${e.from}>${e.to}`, { e, label: `${by.get(e.from)?.n.label || e.from} → ${by.get(e.to)?.n.label || e.to}`, repo: by.get(e.from)?.repo, toRepo: by.get(e.to)?.repo }]));
  const wasLines = lines(before, was), nowLines = lines(after, now);
  // a line names both its ends, so it carries the repo of each
  const ends = (/** @type {{ repo?: string, toRepo?: string }} */ l) => ({ ...repoField(l.repo), ...(l.toRepo && l.toRepo !== l.repo ? { toRepo: l.toRepo } : {}) });
  for (const [k, l] of nowLines) if (!wasLines.has(k)) changes.push({ what: 'added', kind: 'line', label: l.label, ...ends(l) });
  for (const [k, l] of wasLines) if (!nowLines.has(k)) changes.push({ what: 'gone', kind: 'line', label: l.label, ...ends(l) });
  return changes;
}
