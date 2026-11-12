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
