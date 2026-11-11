import { describe, expect, it } from 'vitest';

import { act } from './map.harness.js';

// A box on a map that builds on a system map points at the box there it is about.

const map = (/** @type {any} */ more = {}) => ({ title: 'Refunds', people: [{ id: 'Ana', role: 'Admin', sees: 'all' }],
  nodes: [{ id: 'plan', label: 'Add refunds', x: 0, y: 0, inside: { nodes: [{ id: 'step', label: 'Refund API', x: 0, y: 0 }], edges: [] } }], edges: [], ...more });
const box = (/** @type {any} */ after, /** @type {string} */ id) => id === 'plan' ? after.nodes[0] : after.nodes[0].inside.nodes[0];

describe('a box pointing at a system map box', () => {
  it('points at a box of the system map it builds on, at any depth, and stops pointing', async () => {
    const base = { buildsOn: { name: 'shop', title: 'Shop' } };
    const { status, after } = await act('Ana', { type: 'pointbox', id: 'step', box: 'system-api-payments' }, map(base));
    expect(status).toBe(200);
    expect(box(after, 'step').pointsAt).toEqual({ map: 'shop', box: 'system-api-payments' });
    const undone = await act('Ana', [{ type: 'pointbox', id: 'plan', box: 'system-api' }, { type: 'pointbox', id: 'plan' }], map(base));
    expect(box(undone.after, 'plan').pointsAt).toBeUndefined();
  });
  it('is refused on a map that builds on nothing, or with a box id that is not one', async () => {
    expect((await act('Ana', { type: 'pointbox', id: 'plan', box: 'system-api' }, map())).status).toBe(400);
    const base = { buildsOn: { name: 'shop', title: 'Shop' } };
    expect((await act('Ana', { type: 'pointbox', id: 'plan', box: '../x y' }, map(base))).status).toBe(400);
    expect((await act('Ana', { type: 'pointbox', id: 'plan' }, map(base))).status).toBe(400);
  });
});
