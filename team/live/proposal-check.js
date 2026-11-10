// A change Claude proposes, checked against the map for the person it is for: what it would do in plain words,
// what was left out and why. The map passes in how to read its current state and where new boxes go.
import { readPlannedTask } from './action-plan.js';
import { autoPlanAdditions } from './auto-plan.js';
import { diagramOf, diagramSaid } from './diagram.js';

// a person's chats with Claude: their own (`@Duy`), the ones they kept (`@Duy#…`) and their side chats (`@Duy>box`)
/** @param {string} key @param {any} by */
export const mineChat = (key, by) => key === `@${by}` || key.startsWith(`@${by}#`) || key.startsWith(`@${by}>`);

// every change Claude proposed that nobody has applied or set aside yet, from the map's chats and the linked
// chat; with a person, only the ones that person may apply
/** @param {any} state @param {any} by @param {(session: any, by: any) => boolean} ownsChat @returns {any[]} */
export const pendingIn = (state, by, ownsChat) => [...(state.proposals || []).filter((/** @type {any} */ p) => !by || ownsChat(p.session, by)),
  ...Object.entries(state.threads || {}).filter(([k]) => !by || mineChat(k, by)).flatMap(([, t]) => t.map((/** @type {any} */ m) => m?.proposal))]
  .filter((p) => p?.status === 'pending' && p.plan);

/**
 * @param {{ getState: () => any, nodeOf: (id: any) => any, allNodes: () => any[], allEdges: () => any[],
 *   seesOf: (by: any) => string, placeProposed: (plan: any) => void }} deps
 */
export function proposalChecks({ getState, nodeOf, allNodes, allEdges, seesOf, placeProposed }) {
  // the change Claude proposes in a chat, its propose_change call's input, checked against the map: what it
  // would do in plain words, and what was left out and why. Nothing changes until someone presses Apply.
  /** @param {any} p @param {any} by */
  function proposal(p, by, autoPlanAbout = null) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    return autoPlanAbout ? checkAutoPlan(p, by, autoPlanAbout) : check(p, by);
  }
  /** @param {any} p @param {any} by @param {any} id */
  function checkAutoPlan(p, by, id) {
    const parent = nodeOf(id), sees = seesOf(by);
    if (!parent || (sees !== 'all' && parent.area !== sees)) return { status: 'dropped', ops: [], dropped: [] };
    const additions = autoPlanAdditions(p, id, allNodes(), allEdges(), new Set(allNodes().filter((/** @type {any} */ n) => sees === 'all' || n.area === sees).map((/** @type {any} */ n) => n.id)));
    const checked = check(additions, by, 100);
    checked.dropped.push(...(additions.dropped || []));
    return { ...checked, autoPlanAbout:id };
  }
  // a proposed change ({nodes, edges, remove}) checked against the map for the person it is for
  /** @param {any} p @param {any} by */
  function check(p, by, limit = 12) {
    const sees = seesOf(by), mayTouch = (/** @type {any} */ n) => sees === 'all' || n.area === sees;
    const ops = [], dropped = [], plan = /** @type {any} */ ({ nodes: [], edges: [], remove: [], unlink: [], memory: [] }), slug = /^[a-z0-9-]{1,40}$/;
    for (const n of (p.nodes || []).slice(0, limit)) {
      const had = nodeOf(n?.id);
      if (!n || !slug.test(n.id || '')) { dropped.push({ text: n?.label || 'a box', why: 'no usable id' }); continue; }
      if (had && !mayTouch(had)) { dropped.push({ text: had.label, why: 'outside your access' }); continue; }
      if (!had && !n.label) { dropped.push({ text: n.id, why: 'a new box needs a name' }); continue; }
      if (!had && !String(n.sub ?? '').trim()) { dropped.push({ text: n.label, why: 'a new box needs a second line that says what it is' }); continue; }
      const box = Object.fromEntries(Object.entries(n).filter(([k]) => ['id', 'label', 'sub', 'desc', 'state', 'w'].includes(k)));
      if (!had && ['topic','action'].includes(n.boxType)) {
        box.boxType = n.boxType;
        if (n.boxType === 'action') {
          const task = readPlannedTask(n.task);
          if (!task) { dropped.push({text:n.label,why:'Action needs valid task details'}); continue; }
          box.task = task;
        }
      }
      if (box.state && !['new', 'todo', 'assumed-gone', 'gone'].includes(box.state)) delete box.state;
      if ('diagram' in n) box.diagram = diagramOf(n.diagram);
      if (!had && sees !== 'all') box.area = sees;
      if (!had) box.by = 'Claude';
      plan.nodes.push(box);
      const said = (/** @type {any} */ k) => k === 'diagram' ? diagramSaid(had?.diagram, box.diagram) : `${k === 'sub' ? 'second line' : k === 'desc' ? 'notes' : k} "${box[k]}"`;
      ops.push(had ? `Change ${had.label}: ${Object.keys(box).filter((k) => k !== 'id' && box[k] !== had[k]).map(said).join(', ')}`
        : `Add ${box.boxType === 'action' ? 'the Action' : 'the box'} ${box.label}${box.sub ? ` (${box.sub})` : ''}${box.diagram ? ` opening into a ${box.diagram.kind} of ${box.diagram.items.length}` : ''}`);
    }
    const there = (/** @type {any} */ id) => nodeOf(id) || plan.nodes.some((/** @type {any} */ n) => n.id === id);
    const name = (/** @type {any} */ id) => nodeOf(id)?.label || plan.nodes.find((/** @type {any} */ n) => n.id === id)?.label || id;
    // A line with no words only says one box hangs under another, so it must be the one line into its box once
    // this change is applied (a new box's first line, or a box moved under another); every other line says what
    // happens on it.
    const edges = (p.edges || []).slice(0, limit), cut = new Set((p.unlink || []).map((/** @type {any} */ e) => `${nodeOf(e?.from)?.id}>${nodeOf(e?.to)?.id}`));
    const into = (/** @type {any} */ id) => allEdges().filter((/** @type {any} */ e) => e.to === id && !cut.has(`${e.from}>${e.to}`)).length
      + edges.filter((/** @type {any} */ e) => e && e.to === id && there(e.from)).length;
    for (const e of edges) {
      if (!e || !there(e.from) || !there(e.to)) { dropped.push({ text: `a line ${e?.from} → ${e?.to}`, why: 'a box it names is not on the map' }); continue; }
      if (!String(e.label ?? '').trim() && into(e.to) > 1) { dropped.push({ text: `a line ${name(e.from)} → ${name(e.to)}`, why: `say what happens on it: ${name(e.to)} already hangs under another box` }); continue; }
      plan.edges.push({ from: e.from, to: e.to, ...(e.label ? { label: String(e.label).slice(0, 40) } : {}), state: 'new' });
      ops.push(`Add a line ${name(e.from)} → ${name(e.to)}${e.label ? ` (${e.label})` : ''}`);
    }
    for (const id of (p.remove || []).slice(0, 12)) {
      const had = nodeOf(id);
      if (!had || !mayTouch(had)) { dropped.push({ text: `remove ${id}`, why: had ? 'outside your access' : 'no such box' }); continue; }
      plan.remove.push(id); ops.push(`Remove ${had.label}`);
    }
    const lineOn = (/** @type {any} */ from, /** @type {any} */ to) => [getState(), ...getState().nodes.map((/** @type {any} */ n) => n.inside).filter(Boolean)].some((s) => (s.edges || []).some((/** @type {any} */ e) => e.from === from && e.to === to));
    for (const e of (p.unlink || []).slice(0, 12)) {
      const a = nodeOf(e?.from), z = nodeOf(e?.to);
      if (!a || !z || !lineOn(a.id, z.id)) { dropped.push({ text: `remove the line ${e?.from} → ${e?.to}`, why: 'no such line' }); continue; }
      if (![a, z].every(mayTouch)) { dropped.push({ text: `remove the line ${a.label} → ${z.label}`, why: 'outside your access' }); continue; }
      plan.unlink.push({ from: a.id, to: z.id }); ops.push(`Remove the line ${a.label} → ${z.label}`);
    }
    for (const m of (p.memory || []).slice(0, 6)) {
      const box = m?.box ? nodeOf(m.box) : null, text = String(m?.text || '').trim().slice(0, 300), kind = m?.kind === 'instruction' ? 'instruction' : 'memory';
      if (!text || (m.box && !box)) { dropped.push({ text: text || 'something to remember', why: text ? 'no such box' : 'no words' }); continue; }
      if (box && !mayTouch(box)) { dropped.push({ text, why: 'outside your access' }); continue; }
      plan.memory.push({ kind, box: box?.id || null, text });
      ops.push(`${kind === 'instruction' ? 'Instruction' : 'Remember'} for ${box ? box.label : 'the whole map'}: ${text}`);
    }
    if (p.start) {
      if (typeof p.start === 'string' && there(p.start)) { plan.start = p.start; ops.push(`Start the map from ${name(p.start)}`); }
      else dropped.push({ text: `start from ${p.start}`, why: 'no such box' });
    }
    if (p.tidy === true) { plan.tidy = true; ops.push('Lay out the whole map again, each box beside the box it hangs under'); }
    // a new box gets its place now, so the page can show it on the map as proposed and Apply puts it exactly there
    placeProposed(plan);
    return { status: ops.length ? 'pending' : 'dropped', ops, dropped, plan };
  }
  return { proposal, checkAutoPlan, check };
}
