import { describe, expect, it } from 'vitest';

import { allBoxesOf } from './map-walk.js';
import { keepHandEdits, redrawChanges } from './system-merge.js';

const box = (/** @type {string} */ id, /** @type {any} */ more = {}) => ({ id, x: 0, y: 0, label: id, sub: `${id} line`, origin: 'code', ...more });
const find = (/** @type {any} */ map, /** @type {string} */ id) => /** @type {any} */ (allBoxesOf(map).find((/** @type {any} */ n) => n.id === id));

describe('keepHandEdits', () => {
  it('keeps a box people added, inside the same parent box', () => {
    const before = { nodes: [box('repo', { inside: { nodes: [box('api'), { id: 'mine', label: 'My note', x: 5, y: 5 }], edges: [] } })], edges: [] };
    const drawn = { nodes: [box('repo', { inside: { nodes: [box('api')], edges: [] } })], edges: [] };
    const out = keepHandEdits(before, drawn);
    expect(out.nodes[0].inside.nodes.map((/** @type {any} */ n) => n.id)).toEqual(['api', 'mine']);
  });

  it('puts a box people added on the top level when its parent box is gone', () => {
    const before = { nodes: [box('old', { inside: { nodes: [{ id: 'mine', label: 'Mine' }], edges: [] } })], edges: [] };
    const out = keepHandEdits(before, { nodes: [box('new')], edges: [] });
    expect(out.nodes.map((/** @type {any} */ n) => n.id)).toEqual(['new', 'mine']);
  });

  it("keeps a person's words and place on a drawn box, but not Claude's", () => {
    const before = { nodes: [box('a', { label: 'Orders', updatedBy: 'duy', moved: true, x: 40, y: 50 }), box('b', { label: 'Old', updatedBy: 'Claude' })], edges: [] };
    const drawn = { nodes: [box('a', { label: 'Order service' }), box('b', { label: 'New' })], edges: [] };
    keepHandEdits(before, drawn);
    expect(find(drawn, 'a')).toMatchObject({ label: 'Orders', updatedBy: 'duy', x: 40, y: 50, moved: true });
    expect(find(drawn, 'b').label).toBe('New');
  });

  it('keeps a drawn box holding an Action even when the code no longer shows it', () => {
    const action = { status: 'ready', brief: 'Fix it' };
    const before = { nodes: [box('a', { action }), box('gone', { action })], edges: [] };
    const drawn = { nodes: [box('a')], edges: [] };
    keepHandEdits(before, drawn);
    expect(find(drawn, 'a').action).toEqual(action);
    expect(find(drawn, 'gone').action).toEqual(action);
  });

  it('drops a drawn box with no Action that the code no longer shows', () => {
    const out = keepHandEdits({ nodes: [box('a'), box('gone')], edges: [] }, { nodes: [box('a')], edges: [] });
    expect(find(out, 'gone')).toBeUndefined();
  });

  it('keeps lines people drew when both ends are still there, on a map whose drawn lines are marked', () => {
    const before = { nodes: [box('a'), box('b'), box('c')], edges: [{ from: 'a', to: 'b', label: 'calls', origin: 'code' }, { from: 'b', to: 'c', label: 'mine' }, { from: 'a', to: 'gone', label: 'lost' }] };
    const drawn = { nodes: [box('a'), box('b'), box('c')], edges: [] };
    keepHandEdits(before, drawn);
    expect(drawn.edges).toEqual([{ from: 'b', to: 'c', label: 'mine' }]);
  });

  it('on an older map with no marked lines, keeps only lines to or from boxes people added', () => {
    const before = { nodes: [box('a'), box('b'), { id: 'mine', label: 'Mine' }], edges: [{ from: 'a', to: 'b', label: 'old drawn' }, { from: 'mine', to: 'a', label: 'mine' }] };
    const drawn = { nodes: [box('a'), box('b')], edges: [] };
    keepHandEdits(before, drawn);
    expect(drawn.edges).toEqual([{ from: 'mine', to: 'a', label: 'mine' }]);
  });

  it('does not add a line the drawing already has', () => {
    const before = { nodes: [box('a'), box('b')], edges: [{ from: 'a', to: 'b', label: 'mine' }, { from: 'b', to: 'a', label: 'x', origin: 'code' }] };
    const drawn = { nodes: [box('a'), box('b')], edges: [{ from: 'a', to: 'b', label: 'calls', origin: 'code' }] };
    keepHandEdits(before, drawn);
    expect(drawn.edges).toHaveLength(1);
  });
});

describe('redrawChanges', () => {
  it('lists what code added, took away or renamed, with each repo, and never a box people added', () => {
    const repo = (/** @type {string} */ id, /** @type {any[]} */ inside) => box(id, { source: { repo: id }, inside: { nodes: inside, edges: [] } });
    const before = { nodes: [repo('api', [box('orders'), box('old')]), repo('web', []), { id: 'mine', label: 'My note' }],
      edges: [{ from: 'api', to: 'web', label: 'calls', origin: 'code' }] };
    const after = { nodes: [repo('api', [box('orders', { label: 'Order service' }), box('refunds')]), repo('web', []), { id: 'mine', label: 'My note' }],
      edges: [{ from: 'web', to: 'api', label: 'calls', origin: 'code' }] };
    expect(redrawChanges(before, after)).toEqual([
      { what: 'changed', kind: 'box', label: 'Order service', was: 'orders', repo: 'api' },
      { what: 'added', kind: 'box', label: 'refunds', repo: 'api' },
      { what: 'gone', kind: 'box', label: 'old', repo: 'api' },
      { what: 'added', kind: 'line', label: 'web → api', repo: 'web', toRepo: 'api' },
      { what: 'gone', kind: 'line', label: 'api → web', repo: 'api', toRepo: 'web' },
    ]);
    expect(redrawChanges(before, structuredClone(before))).toEqual([]);
  });
});
