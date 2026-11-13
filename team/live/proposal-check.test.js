import { describe, expect, it } from 'vitest';

import { allBoxesOf, allLinesOf, boxIn } from './map-walk.js';
import { proposalChecks } from './proposal-check.js';

// A change Claude proposes that takes boxes off the map: what it says it will do, and the lines it carries.

const checksOn = (/** @type {any} */ state) => proposalChecks({ getState: () => state, nodeOf: (id) => boxIn(state, id), allNodes: () => allBoxesOf(state), allEdges: () => allLinesOf(state), seesOf: () => 'all', placeProposed: () => {} });
const box = (/** @type {string} */ id, /** @type {string} */ label) => ({ id, label, x: 0, y: 0 });

describe('removing a box that has boxes under it', () => {
  const state = () => ({
    nodes: [box('plan', 'Sprint plan'), box('sell', 'Sell'), box('bill', 'Send the bill'), box('pilots', 'Start pilots')],
    edges: [{ from: 'plan', to: 'sell' }, { from: 'sell', to: 'bill' }, { from: 'sell', to: 'pilots' }], start: 'plan',
  });

  it('says which boxes move up, and carries their new lines, so none is left under nothing', () => {
    const { ops, plan } = checksOn(state()).check({
      nodes: [{ id: 'sprint-1', label: 'Sprint 1', sub: 'Week one' }], edges: [{ from: 'plan', to: 'sprint-1' }, { from: 'sprint-1', to: 'bill', label: 'Moves here' }], remove: ['sell'],
    }, 'Duy');
    expect(ops).toEqual(['Add the box Sprint 1 (Week one)', 'Add a line Sprint plan → Sprint 1', 'Add a line Sprint 1 → Send the bill (Moves here)', 'Remove Sell', 'Move Start pilots up under Sprint plan']);
    expect(plan.edges).toEqual([{ from: 'plan', to: 'sprint-1', state: 'new' }, { from: 'sprint-1', to: 'bill', label: 'Moves here', state: 'new' }, { from: 'plan', to: 'pilots', state: 'new' }]);
  });
  it('adds nothing when every box under it is given a new place', () => {
    const { ops, plan } = checksOn(state()).check({ edges: [{ from: 'plan', to: 'bill', label: 'Now here' }, { from: 'plan', to: 'pilots', label: 'Now here' }], remove: ['sell'] }, 'Duy');
    expect(ops.filter((/** @type {string} */ o) => o.startsWith('Move'))).toEqual([]);
    expect(plan.edges).toHaveLength(2);
  });
});

describe('a reorganize', () => {
  // Root starts the map: Plan, Ship and Secret hang under it, and Bill under Ship
  const state = () => ({
    nodes: [box('root', 'Root'), box('plan', 'Plan'), box('ship', 'Ship'), box('bill', 'Bill'), { ...box('secret', 'Secret'), area: 'finance' }],
    edges: [{ from: 'root', to: 'plan' }, { from: 'root', to: 'ship' }, { from: 'ship', to: 'bill' }, { from: 'root', to: 'secret' }], start: 'root',
  });
  /** @param {any} p @param {any} [s] */
  const tidy = (p, s = state(), sees = 'all') => proposalChecks({ getState: () => s, nodeOf: (id) => boxIn(s, id), allNodes: () => allBoxesOf(s), allEdges: () => allLinesOf(s),
    seesOf: () => sees, placeProposed: () => {} }).check({ ...p, tidy: true }, 'Duy');

  it('is offered when it leaves one tree from the start box, cross-links with words kept', () => {
    const r = tidy({ edges: [{ from: 'plan', to: 'bill', label: 'Prices it' }, { from: 'plan', to: 'ship' }], unlink: [{ from: 'root', to: 'ship' }] });
    expect(r.status).toBe('pending');
    expect(r.ops.at(-1)).toBe('Lay out the whole map again, each box beside the box it hangs under');
  });
  it('is refused, with why, when a box would hang under two boxes, under nothing, or in a loop', () => {
    const r = tidy({ nodes: [{ id: 'docs', label: 'Docs', sub: 'Guides' }], edges: [{ from: 'bill', to: 'ship', label: 'Loops back' }], unlink: [{ from: 'root', to: 'ship' }] });
    expect(r.status).toBe('dropped');
    expect(r.ops).toEqual([]);
    expect(r.dropped.at(-1)).toEqual({ text: 'Reorganize the map', why: 'it would not leave one tree: Docs would hang under nothing; Ship, Bill would hang under each other in a loop' });
    const two = { ...state(), edges: [...state().edges, { from: 'plan', to: 'bill' }] };
    expect(tidy({ start: 'root' }, two).dropped.at(-1)?.why).toBe('it would not leave one tree: Bill would hang under 2 boxes (Ship, Plan)');
  });
  it('is refused when it starts from no box on the map itself', () => {
    const s = { ...state(), start: undefined };
    expect(tidy({}, s).dropped.at(-1)?.why).toBe('it would not leave one tree: it names no box on the map to start from');
  });
  it('never names a box the person may not see', () => {
    const s = { ...state(), edges: state().edges.filter((e) => e.to !== 'secret') };
    expect(tidy({}, s, 'product').dropped.at(-1)?.why).toBe('it would not leave one tree: a box outside your access would hang under nothing');
  });
  it('on a system map, lays out in layers as it always has', () => {
    const s = { ...state(), drawing: { status: 'done' }, edges: [] };
    expect(tidy({}, s).status).toBe('pending');
  });
});

describe('what a proposal may write in a box', () => {
  it('clips its name, second line and notes to what a person may write', () => {
    const s = { nodes: [box('root', 'Root')], edges: [], start: 'root' };
    const { plan } = checksOn(s).check({ nodes: [{ id: 'long', label: 'L'.repeat(200), sub: 'S'.repeat(400), desc: 'D'.repeat(3000) }], edges: [{ from: 'root', to: 'long' }] }, 'Duy');
    expect([plan.nodes[0].label.length, plan.nodes[0].sub.length, plan.nodes[0].desc.length]).toEqual([80, 240, 1500]);
  });
});
