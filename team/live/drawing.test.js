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
