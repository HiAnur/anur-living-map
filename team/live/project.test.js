import { describe, expect, it } from 'vitest';

import { boxActs } from './box-acts.js';
import { HUB_SIZE, LEVEL_CENTRE, levelGraph } from './page-hub.js';
import { hubSizes, placeNew, tidy, tidyLevel, tidyTree } from './project.js';
import { width as wordsWidth } from './proposal-layout.js';

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

// a map shaped like a system map: two boxes nothing leads to, a loop, and a box with no line
const system = () => {
  const box = (id, x, y) => ({ id, label: id, x, y });
  const nodes = [box('app', 90, 150), box('jobs', 90, 350), box('api', 430, 150), box('auth', 430, 350), box('bot', 90, 550), box('db', 770, 950), box('alone', 430, 550)];
  const edges = [['app', 'api'], ['jobs', 'api'], ['api', 'auth'], ['auth', 'bot'], ['bot', 'api'], ['api', 'db'], ['jobs', 'db']].map(([from, to]) => ({ from, to }));
  return { nodes, edges };
};

describe('a map that is not one tree', () => {
  it('is not taken for a tree because a small group of its boxes is one', () => {
    const { nodes, edges } = system();
    nodes.push({ id: 'site', label: 'site', x: 90, y: 750 }, { id: 'cdn', label: 'cdn', x: 430, y: 750 });
    edges.push({ from: 'site', to: 'cdn' });
    expect(tidyTree(nodes, edges, null, () => false, 'site')).toBe(false);
  });

});

// every level of every map lays out the same way: round its circle, as a mind map (tidyLevel)
describe('a level laid out round its circle', () => {
  /** no two boxes on one another, the circle the size the page draws it */
  const apart = (nodes, centre) => {
    const size = (n) => (n === centre ? { w: HUB_SIZE, h: HUB_SIZE } : { w: wordsWidth(n), h: 50 });
    for (const a of nodes) for (const b of nodes) if (a !== b)
      expect(Math.abs(a.x - b.x) >= (size(a).w + size(b).w) / 2 || Math.abs(a.y - b.y) >= (size(a).h + size(b).h) / 2, `${a.id} on ${b.id}`).toBe(true);
  };

  it('inside a box, hangs what nothing leads to off a circle standing for the box, and the rest under what reaches it first', () => {
    const level = system();
    expect(tidyLevel(level, { top: false, label: 'repo' })).toBe(true);
    const g = levelGraph(level, { top: false, label: 'repo' }), centre = g.nodes[0];
    expect(centre).toMatchObject({ id: LEVEL_CENTRE, virtual: true, x: level.centre?.x, y: level.centre?.y });
    // app, jobs and the box with no line hang off the circle; api under app, db under jobs, auth under api, bot under auth
    expect(g.edges.filter((e) => e.virtual).map((e) => e.to)).toEqual(['app', 'jobs', 'alone']);
    const ring = (id) => Math.round(Math.abs(get(level.nodes, id).x - centre.x));
    expect(ring('app')).toBe(ring('jobs'));
    expect(ring('api')).toBeGreaterThan(ring('app'));
    expect(ring('auth')).toBeGreaterThan(ring('api'));
    expect(ring('bot')).toBeGreaterThan(ring('auth'));
    expect(Math.sign(get(level.nodes, 'db').x - centre.x)).toBe(Math.sign(get(level.nodes, 'jobs').x - centre.x));
    apart([...level.nodes, centre], centre);
    // pressed again, nothing moves
    const once = at(level.nodes);
    tidyLevel(level, { top: false, label: 'repo' });
    expect(at(level.nodes)).toEqual(once);
  });

  it('on a system map, hangs each repo off the centre, an outside system under the repo calling it first, and a person under the repo they use', () => {
    const box = (id, more = {}) => /** @type {any} */ ({ id, label: id, origin: 'code', ...more });
    const level = {
      nodes: [box('system'), box('web', { source: { repo: 'web' } }), box('api', { source: { repo: 'api' } }), box('jobs', { source: { repo: 'jobs' } }), box('Stripe', { kind: 'ext' }), box('Customer', { kind: 'actor' })],
      edges: [...['web', 'api', 'jobs'].map((to) => ({ from: 'system', to, origin: 'code' })), { from: 'web', to: 'api', label: 'calls' }, { from: 'api', to: 'Stripe', label: 'charges' }, { from: 'jobs', to: 'Stripe', label: 'refunds' }, { from: 'Customer', to: 'web', label: 'uses' }],
    };
    level.nodes[0].x = 0; level.nodes[0].y = 0;
    expect(tidyLevel(level, { top: true, start: 'system', label: 'Shop' })).toBe(true);
    const g = levelGraph(level, { top: true, start: 'system', label: 'Shop' }), [centre, web, api, jobs, stripe, customer] = level.nodes;
    expect(g.centre).toBe('system');
    expect(g.lines).toContainEqual(expect.objectContaining({ from: 'web', to: 'Customer', flip: 'Customer>web' }));
    const out = (n) => Math.abs(n.x - centre.x);
    // repos round the circle on both sides, the rest one column further out, beside their parent
    expect(out(web)).toBe(out(api));
    expect(new Set([web, api, jobs].map((n) => Math.sign(n.x - centre.x)))).toEqual(new Set([-1, 1]));
    expect(out(stripe)).toBeGreaterThan(out(api));
    expect(Math.sign(stripe.x - centre.x)).toBe(Math.sign(api.x - centre.x));
    expect(Math.sign(customer.x - centre.x)).toBe(Math.sign(web.x - centre.x));
    expect(out(customer)).toBeGreaterThan(out(web));
    apart(level.nodes, centre);
  });

  it('starts a map\'s top level at its start box when it can be the circle, else at a circle for the map', () => {
    const { nodes, edges } = gtm();
    expect(levelGraph({ nodes, edges }, { top: true, label: 'GTM' }).centre).toBe('gtm');
    /** @type {any[]} */ (nodes)[0] = { ...nodes[0], inside: { nodes: [], edges: [] } };
    const g = levelGraph({ nodes, edges }, { top: true, label: 'GTM' });
    expect(g.centre).toBe(LEVEL_CENTRE);
    expect(g.edges.filter((e) => e.virtual).map((e) => e.to)).toEqual(['gtm']);
  });
});

describe('Tidy up inside a box', () => {
  const acts = (state) => boxActs({ getState: () => state, nodeOf: (id) => state.nodes.find((n) => n.id === id), seesOf: () => 'all', sideOf: () => false, tell() {}, pendingProposals: () => [], unlinkEdge: () => false, placeProposed() {} });
  const holding = (drawing) => { const inside = system(); return { state: { nodes: [{ id: 'repo', label: 'repo', x: 90, y: 150, inside }], edges: [], ...(drawing ? { drawing: { status: 'done' } } : {}) }, inside }; };

  it('lays what a box opens into round its circle, on a map drawn from code and on one drawn by hand alike', () => {
    for (const drawing of [true, false]) {
      const { state, inside } = holding(drawing);
      acts(state).tidy({ type: 'tidy', view: 'repo', by: 'Duy' });
      const centre = /** @type {{ x: number, y: number }} */ (inside.centre);
      expect(Math.abs(get(inside.nodes, 'api').x - centre.x)).toBeGreaterThan(Math.abs(get(inside.nodes, 'app').x - centre.x));
      expect(Math.abs(get(inside.nodes, 'app').x - centre.x)).toBe(Math.abs(get(inside.nodes, 'jobs').x - centre.x));
    }
  });
});

describe('a box no line joins to the tree', () => {
  it('keeps its place while the tree is tidied around its first box', () => {
    const { nodes, edges } = gtm(), alone = gtm();
    nodes.push({ id: 'loose', label: 'loose', x: 2000, y: 900, w: 180 });
    expect(tidyTree(nodes, edges)).toBe(true);
    tidyTree(alone.nodes, alone.edges);
    expect(at(nodes)).toEqual({ ...at(alone.nodes), loose: [2000, 900] });
  });

  it('moves clear of the tree when it was left on top of it, and stays there on the next press', () => {
    const { nodes, edges } = gtm();
    tidyTree(nodes, edges);
    const who = get(nodes, 'who');
    nodes.push({ id: 'loose', label: 'loose', x: who.x + 20, y: who.y + 10, w: 180 });
    expect(tidyTree(nodes, edges)).toBe(true);
    const loose = get(nodes, 'loose');
    expect(loose.x).toBe(who.x + 20);
    for (const n of nodes.filter((o) => o !== loose && Math.abs(o.x - loose.x) < 196)) expect(Math.abs(n.y - loose.y)).toBeGreaterThanOrEqual(66);
    const once = at(nodes); tidyTree(nodes, edges); expect(at(nodes)).toEqual(once);
  });

  it('is laid out with the boxes under it, as a tree of its own', () => {
    const { nodes, edges } = gtm();
    nodes.push({ id: 'second', label: 'second', x: 3000, y: 0, w: 180 }, { id: 'k1', label: 'k1', x: 3010, y: 400, w: 180 }, { id: 'k2', label: 'k2', x: 3500, y: -300, w: 180 });
    edges.push({ from: 'second', to: 'k1' }, { from: 'second', to: 'k2' });
    expect(tidyTree(nodes, edges)).toBe(true);
    expect([get(nodes, 'second').x, get(nodes, 'second').y]).toEqual([3000, 0]);
    expect(get(nodes, 'k1').x).toBe(get(nodes, 'k2').x);
    expect(Math.abs(get(nodes, 'k1').y - get(nodes, 'k2').y)).toBe(85);
    expect(Math.abs(get(nodes, 'k1').y + get(nodes, 'k2').y)).toBeLessThanOrEqual(1);
  });

  it('never keeps a new box on the tree from taking its place in it', () => {
    const { nodes, edges } = gtm(), alone = gtm();
    for (const m of [{ nodes, edges }, alone]) { tidyTree(m.nodes, m.edges); m.nodes.push(/** @type {any} */ ({ id: 'extra', label: 'extra', w: 180 })); m.edges.push({ from: 'who', to: 'extra' }); }
    nodes.push({ id: 'loose', label: 'loose', x: 2000, y: 900, w: 180 }, /** @type {any} */ ({ id: 'fresh', label: 'fresh', w: 180 }));
    placeNew(nodes, edges); placeNew(alone.nodes, alone.edges);
    expect([get(nodes, 'extra').x, get(nodes, 'extra').y]).toEqual([get(alone.nodes, 'extra').x, get(alone.nodes, 'extra').y]);
    expect(get(nodes, 'extra').x).toBe(get(nodes, 'founder').x);
    expect(Number.isFinite(get(nodes, 'fresh').x) && Number.isFinite(get(nodes, 'fresh').y)).toBe(true);
    expect([get(nodes, 'loose').x, get(nodes, 'loose').y]).toEqual([2000, 900]);
  });
});

describe('tidyTree', () => {
  it('shortens plain connections and packs sibling branches with room between boxes', () => {
    const nodes = [{id:'root',x:0,y:0}, {id:'a',x:340,y:-150}, {id:'b',x:340,y:0}, {id:'c',x:340,y:150}, {id:'leaf',x:680,y:0}];
    const edges = ['a','b','c'].map(to=>({from:'root',to}));edges.push({from:'b',to:'leaf'});
    tidyTree(nodes, edges);
    expect(get(nodes,'a').x - 140).toBe(70);
    expect(get(nodes,'leaf').x - get(nodes,'b').x - 140).toBe(70);
    expect(get(nodes,'b').y - get(nodes,'a').y - 50).toBe(35);
    expect(get(nodes,'c').y - get(nodes,'b').y - 50).toBe(35);
    const once=at(nodes);tidyTree(nodes,edges);expect(at(nodes)).toEqual(once);
  });

  it('reserves room for measured tall names throughout their branch without spreading other siblings', () => {
    const nodes=[{id:'root',x:0,y:0},{id:'tall',x:340,y:-150},{id:'a',x:340,y:0},{id:'b',x:340,y:150},{id:'child',x:680,y:-150}];
    const edges=['tall','a','b'].map(to=>({from:'root',to}));edges.push({from:'tall',to:'child'});
    const sizes=new Map([['tall',{w:220,h:186}],['child',{w:220,h:220}]]);
    const layout=()=>tidyTree(nodes,edges,null,n=>Number.isFinite(n.x),null,sizes);layout();
    expect(get(nodes,'a').y-get(nodes,'tall').y).toBeGreaterThanOrEqual(186/2+50/2+35);
    expect(get(nodes,'b').y-get(nodes,'a').y).toBe(85);
    expect(get(nodes,'child').y).toBe(get(nodes,'tall').y);
    expect(get(nodes,'tall').x-70-110).toBe(70);
    const once=at(nodes);layout();expect(at(nodes)).toEqual(once);
  });

  it('fits labels on a compact fan without doubling their space, on either side', () => {
    for (const side of [-1,1]) {
      const nodes=[{id:'root',x:0,y:0},{id:'child',x:side*700,y:-100},{id:'other',x:side*700,y:100}];
      const label='Adds the unboxing as part of the offer';
      const edges=[{from:'root',to:'child',label},{from:'root',to:'other'}];
      tidyTree(nodes,edges);
      const gap=Math.abs(get(nodes,'child').x)-140;
      // The last stretch starts after the 14px shared stem and ends 2px before the box.
      expect(gap-16).toBeGreaterThanOrEqual(label.length*6.8+15);
      expect(gap).toBeLessThan(label.length*6.8+34);
      const once=at(nodes);tidyTree(nodes,edges);expect(at(nodes)).toEqual(once);
    }
  });

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
    expect(kids.map((k) => k.y)).toEqual([who.y - 85, who.y, who.y + 85]);
    const right = nodes.filter((n) => n.x === who.x && n !== who);
    // the boxes beside Who in its column sit outside its children's rows
    for (const n of right) expect(Math.abs(n.y - who.y)).toBeGreaterThan(85);
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
    /** @type {any} */ (nodes).push({ id: 'discount', label: 'Discounts', area: 'billing', w: 180 }, { id: 'extra', label: 'Extra', w: 180 });
    edges.push({ from: 'gtm', to: 'discount' }, { from: 'gtm', to: 'extra' });
    placeNew(nodes, edges);
    for (const [id, p] of Object.entries(before)) expect(at(nodes)[id]).toEqual(p);
    tidyTree(nodes, edges);
    // Discounts under Offer, its billing sibling on the right; Extra at the top of the lighter left side
    const right = column(nodes, 1);
    expect(right.indexOf('discount')).toBe(-1);
    expect(/** @type {any} */ (nodes.find((n) => n.id === 'discount')).x).toBe(get(nodes, 'offer').x);
    expect(get(nodes, 'discount').y).toBe(get(nodes, 'offer').y + 85);
    expect(column(nodes, -1)[0]).toBe('extra');
  });

  it('starts from the box it is given, with a line into that box left as a cross-link', () => {
    const { nodes, edges } = gtm();
    edges.push({ from: 'test', to: 'gtm' });
    expect(tidyTree(nodes, edges)).toBe(false);
    expect(tidyTree(nodes, edges, null, () => false, 'gtm')).toBe(true);
    expect(get(nodes, 'gtm').x).toBe(70);
    expect(column(nodes, 1).length + column(nodes, -1).length).toBe(10);
  });

  it('lays out under a new start box that holds two boxes nothing led to', () => {
    const { nodes, edges } = gtm();
    nodes.push({ id: 'side', label: 'side', x: 900, y: 900, w: 180 }, { id: 'top', label: 'top', x: 70, y: 155, w: 140 });
    edges.push({ from: 'top', to: 'gtm' }, { from: 'top', to: 'side' });
    expect(tidyTree(nodes, edges, null, () => false, 'side')).toBe(false);
    expect(tidyTree(nodes, edges, null, () => false, 'top')).toBe(true);
    expect(Math.abs(get(nodes, 'gtm').x - 70)).toBeGreaterThan(0);
    expect(Math.sign(get(nodes, 'who').x - 70)).toBe(Math.sign(get(nodes, 'gtm').x - 70));
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

// the page draws a topic map's start box as a small circle (page-hub.js), so its top level is laid out with it
describe('the centre circle', () => {
  const sample = () => ({
    nodes: [{ id: 'launch', label: 'Launch plan', x: 0, y: 0 }, { id: 'pricing', label: 'Pricing', x: 300, y: -90 }, { id: 'audience', label: 'Audience', x: 300, y: 90 }, { id: 'trial', label: 'Free trial', x: 600, y: -90 }],
    edges: [{ from: 'launch', to: 'pricing' }, { from: 'launch', to: 'audience' }, { from: 'pricing', to: 'trial' }],
  });

  it('is the start box, given or found, unless it holds what a circle cannot show', () => {
    const { nodes, edges } = sample();
    expect([...hubSizes(nodes, edges, null)]).toEqual([['launch', { w: HUB_SIZE, h: HUB_SIZE }]]);
    expect([...hubSizes(nodes, edges, 'launch')]).toEqual([['launch', { w: HUB_SIZE, h: HUB_SIZE }]]);
    nodes[0] = { ...nodes[0], inside: { nodes: [], edges: [] } };
    expect([...hubSizes(nodes, edges, null)]).toEqual([]);
  });

  it('brings the main topics in close to the circle, the next ring keeping its gap from them', () => {
    const box = sample(), hub = sample();
    tidyTree(box.nodes, box.edges, null, () => false, 'launch');
    tidyTree(hub.nodes, hub.edges, null, () => false, 'launch', hubSizes(hub.nodes, hub.edges, 'launch'));
    const near = (nodes) => Math.abs(get(nodes, 'pricing').x - get(nodes, 'launch').x);
    expect(near(box.nodes) - near(hub.nodes)).toBe((140 - HUB_SIZE) / 2);
    // the circle's edge to its topics' edge is the gap any two rings keep
    const gap = (nodes, a, b, wa) => Math.abs(get(nodes, b).x - get(nodes, a).x) - wa / 2 - 70;
    expect(gap(hub.nodes, 'launch', 'pricing', HUB_SIZE)).toBe(gap(hub.nodes, 'pricing', 'trial', 140));
  });

  it('places a new topic in the main topics\' column, as Tidy up would, without moving a box already there', () => {
    const { nodes, edges } = sample(), sizes = () => hubSizes(nodes, edges, 'launch');
    tidyTree(nodes, edges, null, () => false, 'launch', sizes());
    const before = at(nodes);
    /** @type {any[]} */ (nodes).push({ id: 'channels', label: 'Channels' });
    edges.push({ from: 'launch', to: 'channels' });
    placeNew(nodes, edges, 'launch', sizes());
    for (const [id, p] of Object.entries(before)) expect(at(nodes)[id]).toEqual(p);
    expect(Math.abs(get(nodes, 'channels').x - get(nodes, 'launch').x)).toBe(Math.abs(get(nodes, 'pricing').x - get(nodes, 'launch').x));
    // without the circle's size the tree's columns no longer match, and the new box would fall back to the grid
    const grid = sample();
    tidyTree(grid.nodes, grid.edges, null, () => false, 'launch', hubSizes(grid.nodes, grid.edges, 'launch'));
    /** @type {any[]} */ (grid.nodes).push({ id: 'channels', label: 'Channels' });
    grid.edges.push({ from: 'launch', to: 'channels' });
    placeNew(grid.nodes, grid.edges, 'launch');
    expect(get(grid.nodes, 'channels').x).not.toBe(get(nodes, 'channels').x);
  });

  it('is the size Tidy up uses for the start box, unless the page measured it as a box', () => {
    const state = { ...sample(), start: 'launch' };
    const acts = boxActs({ getState: () => state, nodeOf: (id) => state.nodes.find((n) => n.id === id), seesOf: () => 'all', sideOf: () => false, tell() {}, pendingProposals: () => [], unlinkEdge: () => false, placeProposed() {} });
    acts.tidy({ type: 'tidy', by: 'Duy' });
    expect(Math.abs(get(state.nodes, 'pricing').x - get(state.nodes, 'launch').x)).toBe(HUB_SIZE / 2 + 70 + 70);
    acts.tidy({ type: 'tidy', by: 'Duy', sizes: [{ id: 'launch', w: 140, h: 50 }] });
    expect(Math.abs(get(state.nodes, 'pricing').x - get(state.nodes, 'launch').x)).toBe(70 + 70 + 70);
  });
});

// Tidy up and a new box are laid out inside a request, so on a big map that is not one tree (two boxes sharing an id,
// lines between branches) the search for fewer crossings stops at a fixed amount of work and keeps the best it found:
// the server answers everyone else meanwhile. Alone each takes about a second; with no bound, minutes.
describe('a big map that is not one tree', () => {
  const big = () => {
    let seed = 11;
    const rnd = (/** @type {number} */ n) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    /** @type {any[]} */ const nodes = [{ id: 'm', label: 'Meeting', x: 90, y: 150 }];
    /** @type {any[]} */ const edges = [];
    for (let i = 1; i < 130; i++) {
      const parent = i < 12 ? 'm' : `b${1 + rnd(i - 1)}`;
      // a third of the boxes sit off the grid, where a mind map put them
      nodes.push({ id: `b${i}`, label: `Box ${i}`, x: 90 + (i % 9) * 340 + (i % 3 ? 0 : 37), y: 150 + Math.floor(i / 9) * 200 + (i % 3 ? 0 : 23) });
      edges.push({ from: parent, to: `b${i}` });
    }
    for (let i = 0; i < 25; i++) edges.push({ from: `b${1 + rnd(129)}`, to: `b${1 + rnd(129)}`, label: 'blocks' });
    // the same id twice, as an older meeting drew some questions
    nodes.push({ ...nodes[40], x: nodes[40].x + 340 * 9 });
    return { nodes, edges };
  };
  const cells = (/** @type {any[]} */ nodes) => new Set(nodes.map((n) => `${n.x},${n.y}`)).size;

  it('tidies it in seconds, not minutes, every box on its own cell', () => {
    const { nodes, edges } = big();
    const t = Date.now();
    tidy(nodes, edges);
    expect(Date.now() - t).toBeLessThan(20_000);
    expect(cells(nodes)).toBe(nodes.length);
    for (const n of nodes) expect([Number.isInteger((n.x - 90) / 340), Number.isInteger((n.y - 150) / 200)]).toEqual([true, true]);
  }, 30_000);

  it('places new boxes on it in seconds, not minutes, each on a free cell', () => {
    const { nodes, edges } = big();
    for (let i = 0; i < 20; i++) { nodes.push({ id: `new${i}`, label: `New ${i}` }); edges.push({ from: `b${5 + i}`, to: `new${i}` }); }
    const t = Date.now();
    placeNew(nodes, edges, 'm');
    expect(Date.now() - t).toBeLessThan(20_000);
    expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
    expect(cells(nodes.filter((n) => String(n.id).startsWith('new')))).toBe(20);
  }, 30_000);
});
