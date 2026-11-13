import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { openMap } from './server.js';
import { withoutRepos } from './sharing.js';
import { CENTRE, fromCentre, isCentre, renameCentre, withCentre } from './system-centre.js';
import { systemJob } from './system-job.js';
import { keepHandEdits, redrawChanges } from './system-merge.js';

// The centre of a system map: one box code adds for the whole system, that every repo and outside system hangs off.

const dirs = /** @type {string[]} */ ([]);
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-centre-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

/** a system map as one was drawn before it had a centre: twenty boxes, starting from one repo */
const older = () => {
  const box = (/** @type {number} */ i) => ({ id: `system-r${i}`, label: `repo ${i}`, x: 100 + (i % 5) * 300, y: 100 + Math.floor(i / 5) * 200, origin: 'code', source: { kind: 'code', repo: `r${i}` } });
  return { title: 'PiTrade Architecture', drawing: { status: 'done', at: 1, repos: 20, progress: [] }, people: [], calls: [],
    nodes: [...Array.from({ length: 20 }, (_, i) => box(i)), { id: 'mine', label: 'My note', x: 0, y: 900 }],
    edges: [{ from: 'system-r1', to: 'system-r0', label: 'calls', origin: 'code' }, { from: 'mine', to: 'system-r2' }], start: 'system-r0' };
};

describe('the centre of a system map', () => {
  it('is added once, named after the map, above the middle of its boxes, with a line to each box code drew', () => {
    const map = older();
    expect(withCentre(map, map.title)).toBe(true);
    const centre = map.nodes[0];
    expect(centre).toMatchObject({ id: CENTRE, label: 'PiTrade Architecture', origin: 'code' });
    expect(isCentre(centre)).toBe(true);
    expect(centre).not.toHaveProperty('source');
    expect(map.start).toBe(CENTRE);
    expect(centre.y).toBeLessThan(Math.min(...map.nodes.slice(1).map((n) => n.y)));
    expect(centre.x).toBe((100 + 1300) / 2);
    // every repo, never the box someone drew by hand; the lines already there stay as they were
    expect(map.edges.filter(fromCentre).map((e) => e.to)).toEqual(Array.from({ length: 20 }, (_, i) => `system-r${i}`));
    expect(map.edges.filter((e) => !fromCentre(e))).toEqual(older().edges);
    // it says what it is, so Claude reading the map knows it is no repo
    expect(centre.desc).toMatch(/not a repo/);
    expect(withCentre(map, map.title)).toBe(false);
  });

  it('leads to no person, and takes away a line it once drew to one, on open', () => {
    const map = /** @type {any} */ (older());
    map.nodes.push({ id: 'system-customer', label: 'Customer', kind: 'actor', x: 100, y: 800, origin: 'code' }, { id: 'system-stripe', label: 'Stripe', kind: 'ext', x: 400, y: 800, origin: 'code' });
    withCentre(map, map.title);
    expect(map.edges.filter(fromCentre).map((/** @type {any} */ e) => e.to)).toContain('system-stripe');
    expect(map.edges.filter(fromCentre).map((/** @type {any} */ e) => e.to)).not.toContain('system-customer');
    // a map that got a line to its person before people were left out loses it when it opens, and only that one
    map.edges.push({ from: CENTRE, to: 'system-customer', origin: 'code' }, { from: 'system-customer', to: 'system-r0', label: 'uses', origin: 'code' });
    const home = tmp();
    fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(map));
    openMap({ name: 'with-people', home }).close();
    const stored = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));
    expect(stored.edges.filter(fromCentre).map((/** @type {any} */ e) => e.to)).not.toContain('system-customer');
    expect(stored.edges.filter(fromCentre)).toHaveLength(21);
    expect(stored.edges).toContainEqual({ from: 'system-customer', to: 'system-r0', label: 'uses', origin: 'code' });
    // a line someone draws to a person themselves stays
    stored.edges.push({ from: CENTRE, to: 'system-customer' });
    expect(withCentre(stored, stored.title)).toBe(false);
  });

  it('keeps a line someone draws from it to their own box, and the name someone gives it', () => {
    const map = older();
    withCentre(map, map.title);
    map.edges.push({ from: CENTRE, to: 'mine' });
    map.nodes[0].label = 'PiTrade';
    expect(withCentre(map, map.title)).toBe(false);
    renameCentre(map, 'PiTrade Architecture', 'PiTrade v2');
    expect(map.nodes[0].label).toBe('PiTrade');
  });

  it('is renamed with the map, while it has the map\'s name', () => {
    const map = older();
    withCentre(map, map.title);
    renameCentre(map, 'PiTrade Architecture', 'PiTrade v2');
    expect(map.nodes[0].label).toBe('PiTrade v2');
  });

  it('is written to a map drawn before it, the first time the map opens', () => {
    const home = tmp();
    fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(older()));
    const map = openMap({ name: 'pitrade', home });
    const stored = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));
    expect(stored.start).toBe(CENTRE);
    expect(stored.nodes.filter(isCentre)).toHaveLength(1);
    expect(stored.edges.filter(fromCentre)).toHaveLength(20);
    map.close();
  });

  it('is never a change for a redraw to review, and keeps where someone moved it', () => {
    const before = older();
    withCentre(before, before.title);
    Object.assign(before.nodes[0], { x: 5, y: 5, moved: true });
    // drawn again: one repo gone, one new, the centre drawn again where code puts it
    const drawn = older();
    drawn.nodes = drawn.nodes.filter((n) => n.id !== 'system-r19' && n.id !== 'mine');
    drawn.nodes.push({ id: 'system-new', label: 'new', x: 0, y: 0, origin: 'code', source: { kind: 'code', repo: 'new' } });
    withCentre(drawn, drawn.title);
    const after = keepHandEdits(before, structuredClone(drawn));
    const changes = redrawChanges(before, after);
    expect(changes.map((c) => `${c.what} ${c.kind} ${c.id}`).sort()).toEqual(['added box system-new', 'gone box system-r19']);
    expect(after.nodes.find(isCentre)).toMatchObject({ x: 5, y: 5, moved: true });
  });

  it('shows to someone who may not read a repo, its line there keeping only its ends', () => {
    const map = older();
    withCentre(map, map.title);
    const seen = withoutRepos(map, new Set(['r3']));
    expect(seen.start).toBe(CENTRE);
    expect(seen.nodes.find(isCentre)?.label).toBe('PiTrade Architecture');
    expect(seen.nodes.find((/** @type {any} */ n) => n.id === 'system-r3')).toMatchObject({ hiddenRepo: true });
    expect(seen.edges.find((/** @type {any} */ e) => e.from === CENTRE && e.to === 'system-r3')).toEqual({ from: CENTRE, to: 'system-r3', origin: 'code' });
  });

  it('is never where a trace starts', () => {
    const home = tmp(), state = older();
    withCentre(state, state.title);
    fs.writeFileSync(path.join(home, 'system-facts.json'), JSON.stringify({ readings: [], links: [] }));
    const job = systemJob({ home, getState: () => state, save: () => {}, push: () => {}, agent: { answer: async () => ({ ms: 0 }) } });
    expect(job.trace(CENTRE, 'Duy')).toBeNull();
  });
});
