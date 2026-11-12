import { describe, expect, it } from 'vitest';

import { withDefaults } from './stored.js';

describe('a stored map, made whole to serve', () => {
  it('starts every list and record the server reads as empty when it is missing', () => {
    expect(withDefaults({ title: 'Bare' })).toEqual({ title: 'Bare', nodes: [], edges: [], calls: [], prs: [], log: [], comments: [], threads: {}, answers: {} });
  });
  it('leaves what is there as it is, and replaces only a value of the wrong kind', () => {
    const map = { title: 'Kept', nodes: [{ id: 'a', label: 'A' }], edges: [], calls: [{ id: 'c' }], prs: [], log: [{ at: 1 }], comments: [], threads: { '@Duy': [] }, answers: { '*': 'hi' }, memory: [{ id: 'm' }] };
    expect(withDefaults(structuredClone(map))).toEqual(map);
    expect(withDefaults({ calls: null, log: {}, threads: [], answers: 'x' })).toMatchObject({ calls: [], log: [], threads: {}, answers: {} });
  });
  it('drops a line whose box is no longer on its level, at any depth, and keeps every other line', () => {
    const inside = { nodes: [{ id: 'x' }, { id: 'y' }], edges: [{ from: 'x', to: 'y' }, { from: 'gone', to: 'y' }] };
    const map = withDefaults({ nodes: [{ id: 'a' }, { id: 'b', inside }], edges: [{ from: 'a', to: 'b', label: 'Feeds' }, { from: 'a', to: 'sell' }, { from: 'sell', to: 'b' }, { from: 'x', to: 'y' }] });
    expect(map.edges).toEqual([{ from: 'a', to: 'b', label: 'Feeds' }]);
    expect(map.nodes[1].inside?.edges).toEqual([{ from: 'x', to: 'y' }]);
  });
  it('turns something that is not a map at all into an empty one', () => {
    for (const bad of [null, undefined, 7, 'map', []]) expect(withDefaults(bad).nodes).toEqual([]);
  });
});
