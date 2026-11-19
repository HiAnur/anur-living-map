import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { pmActionStatus } from './page-action.js';
import { MIND_LAYOUTS, MIND_VIEW_KEY, mindBranch, mindLayout, mindLayoutChoice, mindView } from './page-mind.js';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
// every name is 10 map pixels a letter, so sizes are easy to check
const words = (/** @type {any} */ n) => String(n.label).length * 10;
const box = (/** @type {string} */ id, x = 0, y = 0) => ({ id, label: id, x, y });

describe('the PM view setting', () => {
  it('is the Engineer view unless the person picked PM', () => {
    expect(mindView('pm')).toBe('pm');
    for (const saved of [null, undefined, '', 'engineer', 'PM', 'boxes']) expect(mindView(saved)).toBe('engineer');
  });

  it('is offered in the account menu, with the Engineer view picked by default', () => {
    const menu = html.slice(html.indexOf('<div class="pm-view">'), html.indexOf('</div></div>', html.indexOf('<div class="pm-view">')));
    expect(menu).toContain('data-view-mode="${v}"');
    expect(menu).toContain("[['engineer', 'Engineer'], ['pm', 'PM']]");
    expect(menu).toContain('aria-checked="${VIEW_MODE === v}"');
  });

  it('keeps the choice in the browser for maps with no local account and redraws when changed', () => {
    const start = html.indexOf('let VIEW_MODE ='), end = html.indexOf('\n}\n', html.indexOf('function setViewMode(')) + 3;
    const store = new Map([[MIND_VIEW_KEY, 'pm']]), calls = [];
    const ctx = vm.createContext({
      linkView:null, mindView, MIND_VIEW_KEY, MIND_LAYOUT: 'right', view: 'system', document: { querySelector: () => null, body: { classList: { toggle() {} } } },
      localStorage: { getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => store.set(k, v) },
      render: () => calls.push('render'), fit: () => calls.push('fit'),
    });
    vm.runInContext(`${html.slice(start, end)}\nthis.get = () => ({ VIEW_MODE, on: mindOn() }); this.set = setViewMode;`, ctx);
    expect(ctx.get()).toEqual({ VIEW_MODE: 'pm', on: true });
    ctx.set('engineer');
    expect(store.get(MIND_VIEW_KEY)).toBe('engineer');
    expect(ctx.get()).toEqual({ VIEW_MODE: 'engineer', on: false });
    expect(calls).toEqual(['render', 'fit']);
    // a flow or a diagram inside a box keeps its own drawing
    ctx.set('pm'); ctx.view = 'flow:a';
    expect(ctx.get().on).toBe(false);
  });
});

describe('adding topics in the PM view', () => {
  const start = html.indexOf('let VIEW_MODE ='), end = html.indexOf('\n}\n', html.indexOf('function setViewMode(')) + 3;
  const setup = () => {
    const ctx = vm.createContext({
      linkView:null, mindView, mindLayout, MIND_VIEW_KEY, MIND_LAYOUT: 'right', view: 'system', selected: null, naming: null, topicIds: new Map(), pendingTopics: new Set(),
      document: { querySelector: () => null, body: { classList: { toggle() {} } } }, localStorage: { getItem: () => 'pm', setItem() {} },
      $: () => ({ querySelector: () => null }), topicTitle: (/** @type {{label: string}} */ n) => n.label, designWidth: () => 0, wraps: new Map(), ruler: { measureText: (/** @type {string} */ t) => ({ width: t.length * 8 }) },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      locked: () => false, pmActionStatus, nameLines: () => 1,
    });
    vm.runInContext(`${html.slice(start, end)}\nthis.scope = mindScope;`, ctx);
    return ctx;
  };
  const box = (/** @type {string} */ id, y = 0) => ({ id, label: id, x: 0, y });
  const level = (/** @type {string[]} */ ids) => ({ centre: 'root', nodes: [box('root'), ...ids.map((id, i) => box(id, i * 50))], lines: ids.map((id) => ({ from: 'root', to: id })), edges: [] });

  it('hangs the next topic under one still saving, not off the start', () => {
    const ctx = setup(), saving = Promise.resolve('x');
    ctx.pendingTopics.add({ view: 'system', saved: saving, label: 'Saving', link: { id: 'a' }, x: 0, y: 0 });
    ctx.naming = { keyboard: true, view: 'system', link: { id: saving }, text: 'Sub-topic', x: 0, y: 0 };
    const sc = ctx.scope(level(['a']));
    expect(sc.mind.parent.get('@draft')).toBe('@pending1');
    expect(sc.mind.parent.get('@pending1')).toBe('a');
  });

  it('keeps the topic getting a new topic where it was while the map grows round it', () => {
    const ctx = setup();
    const was = ctx.scope(level(['a', 'b'])).nodes.find((/** @type {any} */ n) => n.id === 'b');
    ctx.naming = { keyboard: true, view: 'system', link: { id: 'b' }, text: 'Sub-topic', x: 0, y: 0 };
    const now = ctx.scope(level(['a', 'b', 'c'])).nodes.find((/** @type {any} */ n) => n.id === 'b');
    expect([now.x, now.y]).toEqual([was.x, was.y]);
  });
});

describe('the PM view layout', () => {
  const level = {
    centre: 'root',
    nodes: [box('root'), box('b', 200, 300), box('a', 200, 100), box('a1', 400, 80), box('a2', 400, 120), box('loose', 900, 900)],
    lines: [{ from: 'root', to: 'a' }, { from: 'root', to: 'b' }, { from: 'a', to: 'a2' }, { from: 'a', to: 'a1' }],
  };
  const { at: placed, parent, via } = mindLayout(level, words);
  const at = { get: (/** @type {string} */ id) => /** @type {any} */ (placed.get(id)), entries: () => placed.entries() };

  it('puts the start in the middle, on the left, and every topic in a column to the right of its parent', () => {
    expect(at.get('root')).toMatchObject({ x: 0, y: 0, depth: 0 });
    for (const [id, p] of parent) expect(at.get(id).x - at.get(id).w / 2, id).toBeGreaterThan(at.get(p).x + at.get(p).w / 2);
  });

  it('lines siblings up on their left edge', () => {
    const left = (/** @type {string} */ id) => at.get(id).x - at.get(id).w / 2;
    expect(left('a')).toBe(left('b'));
    expect(left('a1')).toBe(left('a2'));
  });

  it('keeps the Engineer view order and centres a parent on its children\'s line joins', () => {
    expect(at.get('a').y).toBeLessThan(at.get('b').y);
    expect(at.get('a1').y).toBeLessThan(at.get('a2').y);
    expect(at.get('a').y).toBe(Math.round((at.get('a1').y + at.get('a1').h / 2 + at.get('a2').y + at.get('a2').h / 2) / 2));
  });

  it.each(['right', 'left', 'balanced'])('keeps a single child\'s underline level with its boxed parent (%s)', (layout) => {
    const graph = { centre:'root', nodes:[box('root'),box('categories'),box('books'),box('industry'),box('growth')],
      lines:[{from:'root',to:'categories'},{from:'categories',to:'books'},{from:'books',to:'industry'},{from:'books',to:'growth'}] };
    const { at } = mindLayout(graph, words, undefined, layout);
    const categories = /** @type {any} */ (at.get('categories')), books = /** @type {any} */ (at.get('books'));
    expect(categories.y).toBe(books.y + books.h / 2);
    const line = mindBranch(categories, books), ys = [...line.matchAll(/-?\d+(?:\.\d+)?/g)].map(([n]) => Number(n)).slice(1, 8).filter((_, i) => i % 2 === 0);
    expect(ys).toEqual(ys.map(() => categories.y));
  });

  it('sizes the start as a pill, main topics as boxes and deeper topics as words on a line', () => {
    expect(at.get('root')).toMatchObject({ w: 40 + 48, h: 48 });
    expect(at.get('a')).toMatchObject({ w: 10 + 32, h: 38, depth: 1 });
    expect(at.get('a1')).toMatchObject({ w: 20 + 12, h: 28, depth: 2 });
  });

  it('hangs a box no line reaches off the start, and never overlaps two topics', () => {
    expect(parent.get('loose')).toBe('root');
    expect(via.get('loose')).toBe(null);
    const all = [...at.entries()];
    for (const [i, [, p]] of all.entries())
      for (const [, q] of all.slice(i + 1))
        expect(Math.abs(p.x - q.x) * 2 < p.w + q.w && Math.abs(p.y - q.y) * 2 < p.h + q.h).toBe(false);
  });

  it('makes a box the child of the first line that reaches it, as the Engineer view does', () => {
    const { parent: up, via: by } = mindLayout({
      centre: 'root', nodes: [box('root'), box('x'), box('y'), box('z')],
      lines: [{ from: 'root', to: 'x' }, { from: 'root', to: 'y' }, { from: 'x', to: 'z' }, { from: 'y', to: 'z' }],
    }, words);
    expect(up.get('z')).toBe('x');
    expect(by.get('z')).toEqual({ from: 'x', to: 'z' });
  });

  it('is empty for an empty level', () => {
    expect(mindLayout({ centre: null, nodes: [], lines: [] }, words).at.size).toBe(0);
  });

  it('gives Actions room at every depth and keeps a ready Action’s Execute button clear of its sibling', () => {
    const draft = { ...box('draft'), action: { stage: 'draft' } }, ready = { ...box('ready'), action: { stage: 'ready' } };
    const input = { centre: 'root', nodes: [box('root'), box('topic'), ready, draft], lines: [{ from: 'root', to: 'topic' }, { from: 'topic', to: 'ready' }, { from: 'topic', to: 'draft' }] };
    const { at } = mindLayout(input, words, (n) => n.action ? 40 : 0);
    const a = /** @type {any} */ (at.get('ready')), b = /** @type {any} */ (at.get('draft'));
    expect(a).toMatchObject({ w: words(ready) + 26, h: 40, depth: 2, boxed: true });
    expect(b.y - b.h / 2 - (a.y + a.h / 2)).toBeGreaterThanOrEqual(36);
    expect(at.get('topic')).toMatchObject({ h: 38, boxed: false });
    expect(mindLayout(input, words).at.get('ready')).toMatchObject({ h: 28, boxed: false });
  });
});

describe('the PM view lines', () => {
  const root = { x: 0, y: 0, w: 100, h: 48, depth: 0 }, topic = { x: 200, y: -80, w: 60, h: 38, depth: 1 }, leaf = { x: 300, y: -90, w: 40, h: 28, depth: 2 };

  it('fans a main topic out of the start into its left side', () => {
    const d = mindBranch(root, topic);
    expect(d.startsWith('M26 0C')).toBe(true);
    expect(d.endsWith(' 170 -80')).toBe(true);
  });

  it('runs a deeper topic from its parent, turning halfway, and on as its underline in one stroke', () => {
    expect(mindBranch(topic, leaf)).toBe('M230 -80C255 -80 255 -76 280 -76H320');
    const deeper = { x: 400, y: -95, w: 40, h: 28, depth: 3 };
    expect(mindBranch(leaf, deeper).startsWith('M320 -76C')).toBe(true);
  });

  it('joins the facing edges and underlines the full title on a left branch', () => {
    const leftTopic = { ...topic, x: -topic.x }, leftLeaf = { ...leaf, x: -leaf.x };
    expect(mindBranch(root, leftTopic)).toMatch(/^M-26 0C.* -170 -80$/);
    expect(mindBranch(leftTopic, leftLeaf)).toBe('M-230 -80C-255 -80 -255 -76 -280 -76H-320');
  });

  it('meets an Action’s edge, then leaves its right edge for its own children', () => {
    const action = { ...leaf, h: 40, boxed: true };
    expect(mindBranch(topic, action)).toBe('M230 -80C255 -80 255 -90 280 -90');
    expect(mindBranch(action, { ...leaf, x: 400, depth: 3 })).toBe('M320 -90C350 -90 350 -76 380 -76H420');
    expect(mindBranch({ ...topic, x: -topic.x }, { ...action, x: -action.x })).toBe('M-230 -80C-255 -80 -255 -90 -280 -90');
    expect(mindBranch({ ...action, x: -action.x }, { ...leaf, x: -400, depth: 3 })).toBe('M-320 -90C-350 -90 -350 -76 -380 -76H-420');
  });

  it('draws only parent-to-child lines; a line between other topics shows in the Engineer view alone', () => {
    const start = html.indexOf('function drawMindLines('), end = html.indexOf('\n}\n', start) + 3;
    const edgesEl = { innerHTML: '' };
    const ctx = vm.createContext({ mindBranch, edgesEl, defsHtml: '', PREVIEW: null, pickedLine: null, naming: null, topicIds: new Map(),
      locked: () => false, anyFocus: () => false, focused: () => true, decisionMap: () => false });
    vm.runInContext(html.slice(start, end), ctx);
    const place = (/** @type {string} */ id, x = 0, y = 0, d = 1) => ({ id, label: id, x, y, mindW: 40, mindH: 28, mindDepth: d });
    const nodes = [place('root', 0, 0, 0), place('a', 100, -20), place('b', 100, 20)];
    const edges = [{ from: 'root', to: 'a' }, { from: 'root', to: 'b' }, { from: 'a', to: 'b', label: 'Feeds' }];
    const sc = { mind: { parent: new Map([['a', 'root'], ['b', 'root']]), via: new Map([['a', edges[0]], ['b', edges[1]]]) } };
    ctx.drawMindLines(sc, nodes, edges, Object.fromEntries(nodes.map((n) => [n.id, n])));
    expect(edgesEl.innerHTML.match(/class="mind-line/g)).toHaveLength(2);
    expect(edgesEl.innerHTML).not.toContain('a>b');
    expect(edgesEl.innerHTML).not.toContain('Feeds');
  });
});

describe('the five mind map layouts', () => {
  const nodes = [box('root'), ...['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => box(id, 200, i * 80)), box('child', 400), box('leaf', 600)];
  const graph = { centre: 'root', nodes, lines: [...nodes.slice(1, 7).map((n) => ({ from: 'root', to: n.id })), { from: 'a', to: 'child' }, { from: 'child', to: 'leaf' }] };

  it('keeps every branch together without overlap and leaves the source map untouched', () => {
    const before = structuredClone(graph);
    for (const [layout] of MIND_LAYOUTS) {
      const { at, parent } = mindLayout(graph, words, (n) => n.id === 'a' ? 80 : 0, layout);
      expect(at.get('a')).toMatchObject({ h: 80, boxed: true });
      expect(at.get('root')).toMatchObject({ x: 0, y: 0 });
      const all = [...at.values()];
      for (const [i, p] of all.entries()) for (const q of all.slice(i + 1))
        expect(Math.abs(p.x - q.x) * 2 < p.w + q.w && Math.abs(p.y - q.y) * 2 < p.h + q.h, layout).toBe(false);
      for (const id of ['child', 'leaf']) {
        const p = at.get(parent.get(id) || ''), child = at.get(id);
        if (!p || !child) throw new Error(`Missing branch: ${id}`);
        expect(Math.sign(child.x), layout).toBe(Math.sign(p.x));
        expect(Math.abs(child.x) - child.w / 2, layout).toBeGreaterThan(Math.abs(p.x) + p.w / 2);
      }
    }
    expect(graph).toEqual(before);
  });

  it('follows the reading order shown by the direction arrows', () => {
    for (const [layout, right, left] of /** @type {[string, string[], string[]][]} */ ([
      ['clockwise', ['a', 'b', 'c'], ['f', 'e', 'd']],
      ['counterclockwise', ['f', 'e', 'd'], ['a', 'b', 'c']],
      ['balanced', ['a', 'b', 'c'], ['d', 'e', 'f']],
      ['right', ['a', 'b', 'c', 'd', 'e', 'f'], []],
      ['left', [], ['a', 'b', 'c', 'd', 'e', 'f']],
    ])) {
      const { at } = mindLayout(graph, words, undefined, layout);
      const placed = (id) => /** @type {{ x: number, y: number }} */ (at.get(id));
      const side = (sign) => nodes.slice(1, 7).filter((n) => Math.sign(placed(n.id).x) === sign).sort((a, b) => placed(a.id).y - placed(b.id).y).map((n) => n.id);
      expect(side(1), layout).toEqual(right);
      expect(side(-1), layout).toEqual(left);
    }
    expect(mindLayoutChoice('unknown')).toBe('right');
  });

  it('keeps wrapped topics and their descendants clear of nearby branches in every direction', () => {
    for (const [layout] of MIND_LAYOUTS) {
      const { at } = mindLayout(graph, words, undefined, layout, () => 60);
      expect(at.get('root')).toMatchObject({ h: 108, boxed: false });
      expect(at.get('child')).toMatchObject({ h: 88, boxed: false });
      const all = [...at.values()];
      for (const [i, p] of all.entries()) for (const q of all.slice(i + 1))
        expect(Math.abs(p.x - q.x) * 2 < p.w + q.w && Math.abs(p.y - q.y) * 2 < p.h + q.h, layout).toBe(false);
    }
  });
});
