import { describe, expect, it } from 'vitest';

import { placeNew, tidy, tidyTree } from './project.js';

// a topic map shaped like the GTM map: one start box, ten boxes off it, two of them with boxes under them,
// laid out the way it was before (sides and order picked by where boxes happened to land)
const gtm = () => {
  const box = (id, x, y, more = {}) => ({ id, label: id, x, y, w: 180, ...more });
  const nodes = [
    { id: 'gtm', label: 'Anur GTM', kind: 'actor', x: 70, y: 155, w: 140 },
    box('who', 430, -370), box('where', 430, 830), box('seller', -290, 230), box('offer', 430, 230, { area: 'billing' }),
    box('price', -290, 80, { area: 'billing' }), box('spread', 430, 80), box('today', -290, 380), box('rivals', 430, 530),
    box('open', -290, -70), box('test', 430, -70),
    box('founder', 880, -220), box('developer', 880, -370), box('owner', 880, -520),
    box('entire', 836, 529), box('catio', 880, 680), box('copilot', 880, 380),
  ];
  const edges = ['who', 'where', 'seller', 'offer', 'price', 'spread', 'today', 'rivals', 'open', 'test'].map((to) => ({ from: 'gtm', to }));
  edges.push(...['founder', 'developer', 'owner'].map((to) => ({ from: 'who', to })), ...['entire', 'catio', 'copilot'].map((to) => ({ from: 'rivals', to })));
  return { nodes, edges };
};
const at = (nodes) => Object.fromEntries(nodes.map((n) => [n.id, [n.x, n.y]]));
const get = (nodes, id) => nodes.find((n) => n.id === id);
// the boxes straight off the start box on one side, top to bottom
const column = (nodes, side) => nodes.filter((n) => ['who', 'where', 'seller', 'offer', 'price', 'spread', 'today', 'rivals', 'open', 'test', 'extra'].includes(n.id))
  .filter((n) => Math.sign(n.x - 70) === side).sort((a, b) => a.y - b.y).map((n) => n.id);

describe('tidyTree', () => {
  it('moves nothing the second time it runs', () => {
    const { nodes, edges } = gtm();
    expect(tidyTree(nodes, edges)).toBe(true);
    const once = at(nodes);
    tidyTree(nodes, edges);
    expect(at(nodes)).toEqual(once);
  });

  it('keeps every box on its side and in its order', () => {
    const { nodes, edges } = gtm();
    const left = column(nodes, -1), right = column(nodes, 1);
    tidyTree(nodes, edges);
    expect(column(nodes, -1)).toEqual(left);
    expect(column(nodes, 1)).toEqual(right);
  });

  it('keeps a box dragged to the other side there, in the place it was dropped among its siblings', () => {
    const { nodes, edges } = gtm();
    tidyTree(nodes, edges);
    // Today dragged from the left to the right, dropped between Spread and Offer
    Object.assign(get(nodes, 'today'), { x: 500, y: (get(nodes, 'spread').y + get(nodes, 'offer').y) / 2 });
    tidyTree(nodes, edges);
    expect(column(nodes, 1)).toEqual(['who', 'test', 'spread', 'today', 'offer', 'rivals', 'where']);
    const once = at(nodes);
    tidyTree(nodes, edges);
    expect(at(nodes)).toEqual(once);
  });

  it('with only dragged boxes kept, regroups and rebalances every other box, and keeps a dragged one where it was put', () => {
    const { nodes, edges } = gtm();
    const moved = (n) => Number.isFinite(n.x) && n.moved;
    tidyTree(nodes, edges, null, moved);
    // nobody dragged anything: balanced in the order drawn, the two billing boxes side by side
    const right = column(nodes, 1), left = column(nodes, -1);
    expect(Math.abs(right.length + (right.includes('who') ? 2 : 0) + (right.includes('rivals') ? 2 : 0) - left.length - (left.includes('who') ? 2 : 0) - (left.includes('rivals') ? 2 : 0))).toBeLessThanOrEqual(1);
    const col = right.includes('offer') ? right : left;
    expect(Math.abs(col.indexOf('offer') - col.indexOf('price'))).toBe(1);
    const once = at(nodes);
    tidyTree(nodes, edges, null, moved);
    expect(at(nodes)).toEqual(once);
    // Today dragged to the far side of where it landed stays on that side
    const t = get(nodes, 'today'), to = t.x < 70 ? 1 : -1;
    Object.assign(t, { x: 70 + to * 400, y: t.y, moved: true });
    tidyTree(nodes, edges, null, moved);
    expect(Math.sign(get(nodes, 'today').x - 70)).toBe(to);
  });

  it('stays stable for any set of boxes showing', () => {
    const { nodes, edges } = gtm();
    const shown = new Set(['gtm', 'who', 'where', 'seller', 'offer', 'price', 'spread', 'today', 'rivals', 'open', 'test']);
    tidyTree(nodes, edges, shown);
    const once = at(nodes);
    tidyTree(nodes, edges, shown);
    expect(at(nodes)).toEqual(once);
    expect(column(nodes, 1)).toEqual(['who', 'test', 'spread', 'offer', 'rivals', 'where']);
  });

  it('stacks children tight beside their parent, never in another box\'s rows', () => {
    const { nodes, edges } = gtm();
    tidyTree(nodes, edges);
    const who = get(nodes, 'who'), kids = ['owner', 'developer', 'founder'].map((id) => get(nodes, id));
    expect(kids.map((k) => k.y)).toEqual([who.y - 150, who.y, who.y + 150]);
    const right = nodes.filter((n) => n.x === who.x && n !== who);
    // the boxes beside Who in its column sit outside its children's rows
    for (const n of right) expect(Math.abs(n.y - who.y)).toBeGreaterThan(150);
  });

  it('lays a new map out clockwise in the order it was drawn, balanced, with boxes that belong together side by side', () => {
    const { nodes, edges } = gtm();
    for (const n of nodes) if (n.id !== 'gtm') { delete n.x; delete n.y; }
    placeNew(nodes, edges);
    // fourteen boxes at the ends: seven a side; Offer and Price (both billing) together
    expect(column(nodes, 1)).toEqual(['who', 'where', 'seller', 'offer', 'price']);
    expect(column(nodes, -1)).toEqual(['test', 'open', 'rivals', 'today', 'spread']);
    const placed = at(nodes);
    tidyTree(nodes, edges);
    expect(at(nodes)).toEqual(placed);
  });

  it('puts a new box beside a sibling it belongs with, or on the lighter side, without moving a box already there', () => {
    const { nodes, edges } = gtm();
    tidyTree(nodes, edges);
    const before = at(nodes);
    nodes.push({ id: 'discount', label: 'Discounts', area: 'billing', w: 180 }, { id: 'extra', label: 'Extra', w: 180 });
    edges.push({ from: 'gtm', to: 'discount' }, { from: 'gtm', to: 'extra' });
    placeNew(nodes, edges);
    for (const [id, p] of Object.entries(before)) expect(at(nodes)[id]).toEqual(p);
    tidyTree(nodes, edges);
    // Discounts under Offer, its billing sibling on the right; Extra at the top of the lighter left side
    const right = column(nodes, 1);
    expect(right.indexOf('discount')).toBe(-1);
    expect(nodes.find((n) => n.id === 'discount').x).toBe(get(nodes, 'offer').x);
    expect(get(nodes, 'discount').y).toBe(get(nodes, 'offer').y + 150);
    expect(column(nodes, -1)[0]).toBe('extra');
  });
});

describe('tidy (grid map)', () => {
  const grid = () => ({
    nodes: [
      { id: 'a', label: 'A', x: 90, y: 150 }, { id: 'b', label: 'B', x: 430, y: 150 },
      { id: 'c', label: 'C', x: 770, y: 350 }, { id: 'd', label: 'D', x: 90, y: 750 },
    ],
    edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
  });

  it('leaves boxes already on the grid where they are, even with an empty row between them', () => {
    const { nodes, edges } = grid();
    const before = at(nodes);
    tidy(nodes, edges);
    expect(at(nodes)).toEqual(before);
  });

  it('puts a dragged box on the nearest free cell, and moves nothing the second time', () => {
    const { nodes, edges } = grid();
    Object.assign(get(nodes, 'd'), { x: 470, y: 560 });
    tidy(nodes, edges);
    expect(at(nodes)).toEqual({ a: [90, 150], b: [430, 150], c: [770, 350], d: [430, 550] });
    const once = at(nodes);
    tidy(nodes, edges);
    expect(at(nodes)).toEqual(once);
  });

  it('never puts a showing box on a cell a folded box holds', () => {
    const { nodes, edges } = grid();
    Object.assign(get(nodes, 'd'), { x: 440, y: 160 });
    tidy(nodes, edges, new Set(['a', 'c', 'd']));
    expect(get(nodes, 'b')).toMatchObject({ x: 430, y: 150 });
    expect(at(nodes).d).not.toEqual([430, 150]);
  });
});
