import { describe, expect, it } from 'vitest';

import { HUB_SIZE, hubHint, hubLevel, isHub } from './page-hub.js';

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
});

describe('what the circle says on hover', () => {
  it('names the start box, then its description, then what a click does', () => {
    expect(hubHint('Launch plan', 'What we ship in spring', false)).toBe('Launch plan\nWhat we ship in spring\n\nClick to show only the main topics');
    expect(hubHint('Launch plan', '', true)).toBe('Launch plan\n\nClick to show every box');
  });
});
