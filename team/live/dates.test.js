import { describe, expect, it } from 'vitest';

import { boxDates, editHistory, editSnapshot } from './editing.js';

/** @type {() => any} */ const map = () => ({ nodes: [{ id: 'root', label: 'Root', x: 0, y: 0 }], edges: [] });
describe('box dates', () => {
  it('records creation once and updates only boxes that changed', () => {
    const s = map(), touch = boxDates(s, true, 1000);
    s.nodes.push({ id: 'child', label: 'Child', x: 210, y: 0 }); touch(s, 2000);
    expect(s.nodes.map(n => [n.createdAt, n.updatedAt])).toEqual([[1000, 1000], [2000, 2000]]);
    s.nodes[1].label = 'Renamed'; touch(s, 3000);
    expect(s.nodes.map(n => [n.createdAt, n.updatedAt])).toEqual([[1000, 1000], [2000, 3000]]);
    s.nodes[1].x = 250; touch(s, 4000);
    expect(s.nodes[1]).toMatchObject({ createdAt: 2000, updatedAt: 4000 });
  });
  it('does not stamp reads, unrelated saves, or repeated identical edits', () => {
    const s = map(), touch = boxDates(s, true, 1000);
    s.threads = { Duy: [{ text: 'Hello' }] }; touch(s, 2000);
    s.nodes[0].label = 'Root'; touch(s, 3000);
    expect(s.nodes[0]).toMatchObject({ createdAt: 1000, updatedAt: 1000 });
  });
  it('attributes changed boxes and leaves the previous editor on no-op saves', () => {
    const s = map(), touch = boxDates(s, true, 1000);
    s.nodes[0].label = 'Edited'; touch(s, 2000, 'Duy');
    touch(s, 3000, 'Claude');
    expect(s.nodes[0]).toMatchObject({ updatedAt: 2000, updatedBy: 'Duy' });
    s.nodes[0].desc = 'New notes'; touch(s, 4000);
    expect(s.nodes[0].updatedBy).toBeUndefined();
  });
  it('keeps legacy dates unknown and records their next actual edit', () => {
    const s = map(), touch = boxDates(s, false, 1000);
    touch(s, 2000);
    expect(s.nodes[0]).toMatchObject({ createdAt: null, updatedAt: null });
    s.nodes[0].desc = 'Notes'; touch(s, 3000);
    expect(s.nodes[0]).toMatchObject({ createdAt: null, updatedAt: 3000 });
  });
  it('preserves dates after saving and restarting, including nested boxes', () => {
    const s = map(); s.nodes[0].inside = { nodes: [{ id: 'nested', label: 'Nested' }], edges: [] };
    const touch = boxDates(s, true, 1000);
    s.nodes[0].inside.nodes[0].label = 'Edited'; touch(s, 2000);
    const loaded = JSON.parse(JSON.stringify(s)), restarted = boxDates(loaded, false, 3000);
    restarted(loaded, 4000);
    expect(loaded).toEqual(s);
    expect(loaded.nodes[0].inside.nodes[0]).toMatchObject({ createdAt: 1000, updatedAt: 2000 });
  });
  it('keeps undo and redo working through successive edits and date changes', () => {
    const s = map(), touch = boxDates(s, true, 1000), history = editHistory();
    for (const [at, label] of /** @type {[number, string][]} */ ([[2000, 'A'], [3000, 'B']])) {
      const before = editSnapshot(s); s.nodes[0].label = label; touch(s, at); history.record('Duy', before, editSnapshot(s));
    }
    for (const [at, direction, label] of /** @type {[number, string, string][]} */ ([[4000, 'undo', 'A'], [5000, 'undo', 'Root'], [6000, 'redo', 'A'], [7000, 'redo', 'B']])) {
      expect(history.apply('Duy', direction, s).ok).toBe(true); touch(s, at);
      expect(s.nodes[0]).toMatchObject({ label, createdAt: 1000, updatedAt: at });
    }
  });
  it('restores original creation on undoing deletion but dates reused IDs as new boxes', () => {
    const s = map(), touch = boxDates(s, true, 1000), history = editHistory(), before = editSnapshot(s);
    s.nodes = []; touch(s, 2000); history.record('Duy', before, editSnapshot(s));
    expect(history.apply('Duy', 'undo', s).ok).toBe(true); touch(s, 3000);
    expect(s.nodes[0]).toMatchObject({ createdAt: 1000, updatedAt: 3000 });
    s.nodes = []; touch(s, 4000); s.nodes.push({ id: 'root', label: 'New root' }); touch(s, 5000);
    expect(s.nodes[0]).toMatchObject({ createdAt: 5000, updatedAt: 5000 });
  });
  it('keeps missing creation dates unknown when restoring an older saved version', () => {
    const s = map(), touch = boxDates(s, true, 1000);
    const old = { nodes: [{ id: 'old', label: 'Old box' }], edges: [] }; boxDates(old);
    Object.assign(s, old); touch(s, 2000);
    expect(s.nodes[0]).toMatchObject({ createdAt: null, updatedAt: 2000 });
  });
});
