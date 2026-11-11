import { describe, expect, it } from 'vitest';

import { act, openTestMap, read } from './map.harness.js';
import { allBoxesOf, allLinesOf, boxIn, graphOfBox, graphsOf, parentBoxOf, pathTo } from './map-walk.js';

// A map three levels deep: the platform holds a service, the service holds a component, the component holds a
// function. Everything that finds, changes or cuts a box works at the deepest level as at the top.

const state = () => ({
  title: 'T', start: 'platform', log: [], calls: [],
  people: [{ id: 'Ana', role: 'Admin', sees: 'all' }, { id: 'Sam', sees: 'web' }],
  nodes: [{ id: 'platform', label: 'Platform', x: 0, y: 0, inside: { nodes: [
    { id: 'service', label: 'Service', x: 0, y: 0, inside: { nodes: [
      { id: 'component', label: 'Component', x: 0, y: 0, inside: { nodes: [
        { id: 'fn', label: 'Function', sub: 'Pays out', x: 0, y: 0, area: 'api' },
        { id: 'table', label: 'Table', x: 200, y: 0, area: 'web' },
      ], edges: [{ from: 'fn', to: 'table', label: 'Writes payouts' }] } },
    ], edges: [] } },
  ], edges: [] } }],
  edges: [],
});

describe('walking a map', () => {
  it('finds every box, line and graph, at any depth', () => {
    const s = state();
    expect(allBoxesOf(s).map((n) => n.id)).toEqual(['platform', 'service', 'component', 'fn', 'table']);
    expect(allLinesOf(s)).toEqual([{ from: 'fn', to: 'table', label: 'Writes payouts' }]);
    expect(graphsOf(s)).toHaveLength(4);
    expect(boxIn(s, 'fn')?.label).toBe('Function');
  });
  it('knows where a box sits and the way down to it', () => {
    const s = state();
    expect(parentBoxOf(s, 'fn')?.id).toBe('component');
    expect(parentBoxOf(s, 'platform')).toBeNull();
    expect(graphOfBox(s, 'fn').nodes.map((/** @type {any} */ n) => n.id)).toEqual(['fn', 'table']);
    expect(pathTo(s, 'fn').map((n) => n.id)).toEqual(['platform', 'service', 'component']);
  });
});

describe('a box three levels deep, through the map', () => {
  const deep = (/** @type {any} */ after, /** @type {string} */ id) => boxIn(after, id);
  it('can be renamed, described and resized', async () => {
    const { status, after } = await act('Ana', [{ type: 'renamebox', id: 'fn', label: 'Payout' }, { type: 'describebox', id: 'fn', sub: 'Sends payouts' }], state());
    expect(status).toBe(200);
    expect(deep(after, 'fn')).toMatchObject({ label: 'Payout', sub: 'Sends payouts' });
  });
  it('can be linked, relabelled and unlinked in its own level', async () => {
    const { status, after } = await act('Ana', [{ type: 'relabel', from: 'fn', to: 'table', label: 'Reads payouts' }, { type: 'unlink', from: 'fn', to: 'table' }, { type: 'connect', from: 'table', to: 'fn', label: 'Feeds', view: 'component' }], state());
    expect(status).toBe(200);
    expect(graphOfBox(after, 'fn').edges).toEqual([expect.objectContaining({ from: 'table', to: 'fn', label: 'Feeds' })]);
  });
  it('can be taken off the map, and the box holding it keeps the rest', async () => {
    const { status, after } = await act('Ana', { type: 'remove', id: 'table' }, state());
    expect(status).toBe(200);
    expect(deep(after, 'table')).toBeUndefined();
    expect(graphOfBox(after, 'fn').edges).toEqual([]);
    expect(deep(after, 'fn')).toBeDefined();
  });
  it('is cut for someone who sees another area, however deep it is', async () => {
    // the boxes holding it are in Sam's area, the function itself is not
    const mine = state();
    for (const n of allBoxesOf(mine)) if (['platform', 'service', 'component'].includes(n.id)) n.area = 'web';
    const { map, close } = openTestMap(mine);
    const s = JSON.parse((await read(map, 'Sam', '/api/state')).text);
    close();
    expect(deep(s, 'fn')).toEqual({ id: 'fn', label: 'Function', x: 0, y: 0, area: 'api' });
    expect(deep(s, 'table')).toMatchObject({ id: 'table', area: 'web' });
    expect(allLinesOf(s)).toEqual([{ from: 'fn', to: 'table' }]);
  });
  it('sends nothing inside a box someone cannot see, however deep', async () => {
    const { map, close } = openTestMap(state());
    const s = JSON.parse((await read(map, 'Sam', '/api/state')).text);
    close();
    expect(allBoxesOf(s).map((n) => n.id)).toEqual(['platform']);
    expect(JSON.stringify(s)).not.toMatch(/Pays out|Writes payouts|Function/);
  });
  it('is refused to someone outside its area', async () => {
    expect((await act('Sam', { type: 'renamebox', id: 'fn', label: 'Mine' }, state())).status).toBe(400);
    expect((await act('Sam', { type: 'renamebox', id: 'table', label: 'Ledger' }, state())).status).toBe(200);
  });
});
