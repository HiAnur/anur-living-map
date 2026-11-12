import { describe, expect, it } from 'vitest';

import { drawing } from './drawing.js';
import { boxIn } from './map-walk.js';

// A drawing lands on the level it is about: a box inside another box is changed where it is, and a new box goes
// into the level of what it is drawn to, or of the box the chat was about.

const mapWith = () => {
  /** @type {any} */
  const state = { nodes: [
    { id: 'shop', label: 'shop', x: 100, y: 100, inside: { nodes: [
      { id: 'posthog', label: 'PostHog', sub: 'Analytics', x: 300, y: 200 },
      { id: 'app', label: 'App', sub: 'The app', x: 100, y: 200 },
    ], edges: [] } },
    { id: 'api', label: 'api', x: 500, y: 100 },
  ], edges: [], calls: [], start: 'shop' };
  const draw = drawing({ getState: () => state, nodeOf: (id) => boxIn(state, id), seesOf: () => 'all', unlinkEdge: () => true });
  return { state, draw };
};
const inner = (/** @type {any} */ state) => state.nodes[0].inside;

describe('drawing on a level inside a box', () => {
  it('puts a new box from a box\'s side chat into that box\'s level, placed among its boxes', () => {
    const { state, draw } = mapWith();
    draw({ nodes: [{ id: 'events', label: 'Add missing events', sub: 'Four groups', x: -999, y: -777 }], edges: [] }, 'Claude', { kind: 'side', box: 'posthog', owner: 'Sam' });
    expect(state.nodes.map((/** @type {any} */ n) => n.id)).toEqual(['shop', 'api']);
    const box = inner(state).nodes.find((/** @type {any} */ n) => n.id === 'events');
    expect(box).toBeTruthy();
    expect([box.x, box.y]).not.toEqual([-999, -777]);
  });
  it('puts a new box with a line to an inner box on that box\'s level, with its line', () => {
    const { state, draw } = mapWith();
    draw({ nodes: [{ id: 'funnel', label: 'Funnel', sub: 'Onboarding steps' }], edges: [{ from: 'app', to: 'funnel', label: 'sends' }] }, 'Claude', { kind: 'proposal' });
    expect(inner(state).nodes.some((/** @type {any} */ n) => n.id === 'funnel')).toBe(true);
    expect(inner(state).edges).toEqual([{ from: 'app', to: 'funnel', label: 'sends' }]);
    expect(state.edges).toEqual([]);
  });
  it('changes a box inside another where it is, never copying it to the top', () => {
    const { state, draw } = mapWith();
    draw({ nodes: [{ id: 'posthog', label: 'PostHog', sub: 'Product analytics' }], edges: [{ from: 'app', to: 'posthog', label: 'tracks' }] }, 'Claude', { kind: 'proposal' });
    expect(state.nodes.map((/** @type {any} */ n) => n.id)).toEqual(['shop', 'api']);
    expect(boxIn(state, 'posthog')).toMatchObject({ sub: 'Product analytics', x: 300, y: 200 });
    expect(inner(state).edges).toHaveLength(1);
  });
  it('keeps the top level as it was for a box drawn there', () => {
    const { state, draw } = mapWith();
    draw({ nodes: [{ id: 'billing', label: 'billing', sub: 'Payments', x: 900, y: 100 }], edges: [] }, 'Claude', { kind: 'proposal' });
    expect(state.nodes.find((/** @type {any} */ n) => n.id === 'billing')).toMatchObject({ x: 900, y: 100 });
  });
});

describe('a box taken off the map in a drawing', () => {
  // a start box with two groups under it, each holding boxes, and a side line between two of those
  const grouped = () => {
    /** @type {any} */
    const state = { nodes: ['plan', 'sell', 'learn', 'bill', 'pilots', 'survey'].map((id, i) => ({ id, label: id, x: i * 200, y: 0 })), calls: [], start: 'plan',
      edges: [{ from: 'plan', to: 'sell' }, { from: 'plan', to: 'learn' }, { from: 'sell', to: 'bill' }, { from: 'sell', to: 'pilots', label: 'Starts' }, { from: 'learn', to: 'survey' }, { from: 'bill', to: 'pilots', label: 'Pays for' }] };
    const draw = drawing({ getState: () => state, nodeOf: (id) => boxIn(state, id), seesOf: () => 'all', unlinkEdge: () => true });
    return { state, draw };
  };
  const lines = (/** @type {any} */ state) => state.edges.map((/** @type {any} */ e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ''}`);

  it('takes its lines with it, and what hung under it moves up under the box above', () => {
    const { state, draw } = grouped();
    draw({ remove: ['sell'] }, 'Claude', { kind: 'proposal' });
    expect(state.nodes.map((/** @type {any} */ n) => n.id)).toEqual(['plan', 'learn', 'bill', 'pilots', 'survey']);
    expect(lines(state)).toEqual(['plan>learn', 'learn>survey', 'bill>pilots:Pays for', 'plan>bill', 'plan>pilots:Starts']);
  });
  it('leaves a box where the drawing hangs it, and moves up only the ones it gives no new line', () => {
    const { state, draw } = grouped();
    draw({ nodes: [{ id: 'sprint', label: 'Sprint 1', sub: 'Week one' }], edges: [{ from: 'plan', to: 'sprint' }, { from: 'sprint', to: 'bill', label: 'Moves here' }], remove: ['sell', 'learn'] }, 'Claude', { kind: 'proposal' });
    expect(lines(state)).toEqual(['bill>pilots:Pays for', 'plan>sprint', 'sprint>bill:Moves here', 'plan>pilots:Starts', 'plan>survey']);
    // every box can still be reached from where the map starts
    const seen = new Set(['plan']);
    for (let grew = true; grew;) { grew = false; for (const e of state.edges) if (seen.has(e.from) && !seen.has(e.to)) { seen.add(e.to); grew = true; } }
    expect(seen.size).toBe(state.nodes.length);
  });
  it('moves what hung under two boxes that leave together up past both, and nothing when the box hung under nothing', () => {
    const { state, draw } = grouped();
    state.edges.push({ from: 'survey', to: 'pilots' });
    draw({ remove: ['learn', 'survey'] }, 'Claude', { kind: 'proposal' });
    expect(lines(state)).toEqual(['plan>sell', 'sell>bill', 'sell>pilots:Starts', 'bill>pilots:Pays for']);
    draw({ remove: ['plan'] }, 'Claude', { kind: 'proposal' });
    expect(lines(state)).toEqual(['sell>bill', 'sell>pilots:Starts', 'bill>pilots:Pays for']);
  });
});
