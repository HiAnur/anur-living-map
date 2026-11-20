// A two-level map (a circle, topics round it, a few points under each) grown one box at a time the way a meeting
// grows, in a random order, many times over: after every box, each topic's points sit in their own block beside
// it, so no two topics' blocks interleave and no two stems overlap; and the same holds once Tidy up lays it out.
import { describe, expect, it } from 'vitest';

import { blockClashes, placeLevel, tidyLevel } from './project.js';

/** A small seeded random number source, so a failure can be replayed. @param {number} seed */
const random = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/**
 * Pairs of topics on the same side whose blocks overlap: the band from the top of the topic or its first point to
 * the bottom of the topic or its last point, on one side of the circle. Written apart from blockClashes, so the
 * two check each other.
 * @param {any[]} nodes @param {any[]} edges
 */
function interleaved(nodes, edges) {
  const at = new Map(nodes.map((n) => [n.id, n])), root = at.get('meeting');
  const topics = edges.filter((e) => e.from === 'meeting').map((e) => at.get(e.to));
  const bands = topics.map((t) => {
    const kids = edges.filter((e) => e.from === t.id).map((e) => at.get(e.to));
    if (!kids.length) return null;
    const ys = [t.y, ...kids.map((k) => k.y)];
    return { id: t.id, side: Math.sign(t.x - root.x), top: Math.min(...ys) - 25, bottom: Math.max(...ys) + 25, kidsBeside: kids.every((k) => Math.sign(k.x - t.x) === Math.sign(t.x - root.x)) };
  }).filter((b) => !!b);
  /** @type {string[]} */ const out = [];
  for (const b of bands) if (!b.kidsBeside) out.push(`${b.id}'s points are not beside it`);
  bands.forEach((a, i) => bands.slice(i + 1).forEach((b) => { if (a.side === b.side && a.top < b.bottom && b.top < a.bottom) out.push(`${a.id} and ${b.id}`); }));
  return out;
}

/** Boxes drawn on top of each other. @param {any[]} nodes */
function overlapping(nodes) {
  /** @type {string[]} */ const out = [];
  nodes.forEach((a, i) => nodes.slice(i + 1).forEach((b) => { if (a.id !== 'meeting' && b.id !== 'meeting' && Math.abs(a.x - b.x) < 100 && Math.abs(a.y - b.y) < 50) out.push(`${a.id} on ${b.id}`); }));
  return out;
}

describe('a two-level map keeps each topic\'s points in a block of their own', () => {
  it('as boxes are added one at a time, and after Tidy up, over many random meetings', () => {
    const where = { top: true, start: 'meeting', label: 'M' };
    for (let seed = 1; seed <= 150; seed++) {
      const rnd = random(seed);
      const topics = 2 + Math.floor(rnd() * 9), sizes = Array.from({ length: topics }, () => Math.floor(rnd() * 6));
      /** @type {{ nodes: any[], edges: any[] }} */
      const level = { nodes: [{ id: 'meeting', label: 'M', x: 90, y: 150 }], edges: [] };
      // the order a meeting adds them in: a topic, then points under any topic already there
      const due = sizes.map((n, t) => ({ t, left: n })), open = [];
      let next = 0;
      while (next < topics || due.some((d) => d.left && open.includes(d.t))) {
        const ready = due.filter((d) => d.left && open.includes(d.t));
        if (next < topics && (!ready.length || rnd() < 0.3)) {
          level.nodes.push({ id: `t${next}`, label: `Topic number ${next}` }); level.edges.push({ from: 'meeting', to: `t${next}` }); open.push(next++);
        } else {
          const d = ready[Math.floor(rnd() * ready.length)];
          const id = `t${d.t}p${sizes[d.t] - d.left}`;
          level.nodes.push({ id, label: `A point about ${id}` }); level.edges.push({ from: `t${d.t}`, to: id }); d.left--;
        }
        placeLevel(level, where);
        const step = `seed ${seed}, ${level.nodes.length} boxes`;
        expect(interleaved(level.nodes, level.edges), step).toEqual([]);
        expect(blockClashes(level.nodes, level.edges, 'meeting'), step).toEqual([]);
        expect(overlapping(level.nodes), step).toEqual([]);
      }
      expect(tidyLevel(level, where)).toBe(true);
      expect(interleaved(level.nodes, level.edges), `seed ${seed}, tidied`).toEqual([]);
      expect(overlapping(level.nodes), `seed ${seed}, tidied`).toEqual([]);
    }
  });

  it('leaves a gap between two topics\' blocks wider than the gap between points', () => {
    const level = { nodes: /** @type {any[]} */ ([{ id: 'meeting', label: 'M', x: 90, y: 150 }]), edges: /** @type {any[]} */ ([]) };
    for (const t of ['a', 'b']) {
      level.nodes.push({ id: t, label: `Topic ${t}` }); level.edges.push({ from: 'meeting', to: t });
      for (const p of [1, 2]) { level.nodes.push({ id: `${t}${p}`, label: `Point ${t}${p}` }); level.edges.push({ from: t, to: `${t}${p}` }); }
    }
    tidyLevel(level, { top: true, start: 'meeting', label: 'M' });
    const y = (/** @type {string} */ id) => /** @type {any} */ (level.nodes.find((n) => n.id === id)).y;
    const side = (/** @type {string} */ id) => Math.sign(/** @type {any} */ (level.nodes.find((n) => n.id === id)).x - 90);
    if (side('a') === side('b')) {
      const [first, second] = y('a') < y('b') ? ['a', 'b'] : ['b', 'a'];
      expect(y(`${second}1`) - y(`${first}2`)).toBeGreaterThan(y(`${first}2`) - y(`${first}1`));
    } else {
      expect(side('a1')).toBe(side('a'));
    }
  });
});
