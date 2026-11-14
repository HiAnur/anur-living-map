import { describe, expect, it } from 'vitest';

import { HUB_SIZE, LEVEL_CENTRE, hubHint, hubLevel, isHub, levelGraph, startOf } from './page-hub.js';

// The map's start box as the small empty circle at its centre.

describe('the centre circle', () => {
  const top = { start: 'launch', top: true, code: false };
  const launch = { id: 'launch', label: 'Launch plan' };

  it('is the start box of a map\'s top level', () => {
    expect(isHub(launch, top)).toBe(true);
    expect(isHub({ id: 'pricing', label: 'Pricing' }, top)).toBe(false);
    expect(isHub(launch, { ...top, start: null })).toBe(false);
    expect(isHub(null, top)).toBe(false);
  });

  it('stays a box inside a box', () => {
    expect(isHub(launch, { ...top, top: false })).toBe(false);
  });

  it('stays a box when it holds what a circle cannot show, or is only proposed', () => {
    for (const more of [{ inside: { nodes: [], edges: [] } }, { diagram: { kind: 'sequence' } }, { action: { id: 'a1' } }, { proposed: true }])
      expect(isHub({ ...launch, ...more }, top)).toBe(false);
  });

  it('is small', () => {
    expect(HUB_SIZE).toBeLessThan(50);
  });
});

describe('a click on the circle', () => {
  it('shows only the main topics', () => {
    expect(hubLevel(0, 3)).toBe(1);
    expect(hubLevel(2, 3)).toBe(1);
    expect(hubLevel(3, 3)).toBe(1);
  });
  it('shows every box again when only the main topics show', () => {
    expect(hubLevel(1, 3)).toBe(3);
  });
  it('keeps the main topics when the map has nothing under them', () => {
    expect(hubLevel(1, 1)).toBe(1);
  });
  it('on a system map, where every repo hangs right off the circle, folds the map to the circle alone and back', () => {
    expect(hubLevel(1, 1, true)).toBe(0);
    expect(hubLevel(2, 2, true)).toBe(0);
    expect(hubLevel(0, 2, true)).toBe(2);
    expect(hubLevel(0, 0, true)).toBe(0);
  });
});

describe('what the circle says on hover', () => {
  it('names the start box, then its description, then what a click does', () => {
    expect(hubHint('Launch plan', 'What we ship in spring', false)).toBe('Launch plan\nWhat we ship in spring\n\nClick to show only the main topics');
    expect(hubHint('Launch plan', '', true)).toBe('Launch plan\n\nClick to show every box');
    expect(hubHint('Shop system', '', false, true)).toBe('Shop system\n\nClick to fold the map to this circle');
  });
});

describe('a level as the map draws it and lays it out', () => {
  const box = (/** @type {string} */ id, more = {}) => ({ id, label: id, x: 0, y: 0, ...more });
  const line = (/** @type {string} */ from, /** @type {string} */ to) => ({ from, to });

  it('starts a map from the box given, else from the box nothing leads to with the most under it', () => {
    const nodes = [box('a'), box('b'), box('c'), box('d')], edges = [line('a', 'b'), line('c', 'b'), line('c', 'd')];
    expect(startOf(nodes, edges)).toBe('c');
    expect(startOf(nodes, edges, 'a')).toBe('a');
    expect(startOf([], [])).toBeNull();
  });

  it('inside a box, starts at a circle standing for it, with a line to each box nothing leads to and one into a loop', () => {
    const level = { nodes: [box('a', { x: 100, y: 300 }), box('b', { x: 300, y: 500 }), box('c'), box('d')], edges: [line('a', 'b'), line('c', 'd'), line('d', 'c')] };
    const g = levelGraph(level, { top: false, label: 'Billing' });
    expect(g.centre).toBe(LEVEL_CENTRE);
    expect(g.nodes[0]).toMatchObject({ id: LEVEL_CENTRE, label: 'Billing', virtual: true, x: 150, y: 0 - 190 });
    expect(isHub(g.nodes[0], { start: null, top: false })).toBe(true);
    expect(g.edges.filter((e) => e.virtual).map((e) => e.to)).toEqual(['a', 'c']);
    // a place Tidy up gave it is kept
    expect(levelGraph({ ...level, centre: { x: 7, y: 8 } }, { top: false }).nodes[0]).toMatchObject({ x: 7, y: 8 });
  });

  it('on a map\'s top level, starts at its start box, and hangs a box nothing reaches under the box it points to', () => {
    const level = { nodes: [box('hub'), box('web'), box('api'), box('person')], edges: [line('hub', 'web'), line('hub', 'api'), line('person', 'web')] };
    const g = levelGraph(level, { top: true, start: 'hub', label: 'Shop' });
    expect(g.centre).toBe('hub');
    expect(g.edges).toEqual(level.edges);
    expect(g.lines).toContainEqual({ from: 'web', to: 'person', flip: 'person>web' });
  });

  it('on a map\'s top level, starts at a circle for the map when the start box holds what a circle cannot show', () => {
    const level = { nodes: [box('hub', { inside: { nodes: [], edges: [] } }), box('web')], edges: [line('hub', 'web')] };
    const g = levelGraph(level, { top: true, start: 'hub', label: 'Shop' });
    expect(g.centre).toBe(LEVEL_CENTRE);
    expect(g.edges.filter((e) => e.virtual).map((e) => e.to)).toEqual(['hub']);
  });

  it('has no circle on an empty level', () => {
    expect(levelGraph({ nodes: [], edges: [] }, { top: false }).centre).toBeNull();
  });
});
