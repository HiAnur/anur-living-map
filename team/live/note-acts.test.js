import { describe, expect, it } from 'vitest';

import { openTestMap, send } from './map.harness.js';
import { noteActs } from './note-acts.js';
import { noteDocument } from './page-note.js';

/** @returns {any} */
const sample = () => ({ title: 'Launch', desc: 'For spring', start: 'root', admins: ['Duy'], people: [{ id: 'Duy', role: 'Admin', sees: 'all' }, { id: 'Sam', sees: 'all' }], calls: [],
  nodes: [{ id: 'root', label: 'Launch', x: 0, y: 0 }, { id: 'a', label: 'Audience', sub: 'Who we serve', desc: 'Small teams', x: 300, y: 0, action: { id: 'task', status: 'draft' }, inside: { nodes: [{ id: 'b', label: 'Research', x: 0, y: 0 }], edges: [] } }, { id: 'c', label: 'Pricing', x: 300, y: 100 }],
  edges: [{ from: 'root', to: 'a' }, { from: 'a', to: 'c', label: 'Informs' }, { from: 'c', to: 'root', label: 'Revisit' }],
  comments: [{ node: 'a', text: 'Keep this' }], memory: [{ id: 'm1', text: 'Decided', box: 'a' }] });
/** @param {any} state @returns {Act<'writenote'>} */
const request = (state) => ({ type: 'writenote', by: 'Duy', base: JSON.stringify(noteDocument(state)), ...noteDocument(state) });

describe('the two views of a document', () => {
  it('keeps root siblings at the same depth when a side link joins them, in the order drawn on the map', () => {
    const state = { title: 'Launch', start: 'root', nodes: [{ id: 'root', label: 'Launch', x: 0, y: 0 }, { id: 'a', label: 'A', x: 300, y: 100 }, { id: 'b', label: 'B', x: 300, y: -100 }], edges: [{ from: 'root', to: 'a' }, { from: 'a', to: 'b' }, { from: 'root', to: 'b' }] };
    expect(noteDocument(state).sections.map((s) => [s.id, s.parent, s.depth])).toEqual([['root', '', 0], ['b', 'root', 1], ['a', 'root', 1]]);
  });
  it('projects nested maps and cycles once, then saves text without losing box identity or other content', () => {
    const state = sample(), before = structuredClone(state), a = request(state);
    expect(a.sections.map((s) => s.id)).toEqual(['root', 'a', 'b', 'c']);
    expect(a.sections[1]?.body).toBe('Who we serve\n\nSmall teams');
    a.sections[1].label = 'Customers'; a.sections[1].body = 'Founders\n\nThey need a clear plan.';
    expect(noteActs({ getState: () => state }).writenote(a)).toBe(true);
    expect(state.nodes[1]).toMatchObject({ id: 'a', label: 'Customers', sub: 'Founders', desc: 'Founders\n\nThey need a clear plan.', action: before.nodes[1].action, inside: before.nodes[1].inside, x: 300, y: 0 });
    expect(state.edges).toEqual(before.edges); expect(state.comments).toEqual(before.comments); expect(state.memory).toEqual(before.memory);
    expect(noteDocument(state).sections[1]?.body).toBe(a.sections[1].body);
  });
  it('keeps an unchanged note exactly as stored, including distinct summaries and details', () => {
    const state = sample(), original = structuredClone(state);
    expect(noteActs({ getState: () => state }).writenote(request(state))).toBe(true);
    expect(state.nodes).toEqual(original.nodes); expect(state.edges).toEqual(original.edges);
  });
  it('adds a nested section and a child section with server IDs and keeps existing links', () => {
    const state = sample(), a = request(state), edges = structuredClone(state.edges);
    a.sections.push({ id: 'draft-one', label: 'Interviews', body: 'Three founders', parent: 'b', graph: 'a', depth: 3 }, { id: 'draft-two', label: 'Questions', body: '', parent: 'draft-one', graph: 'a', depth: 4 });
    expect(noteActs({ getState: () => state }).writenote(a)).toBe(true);
    const graph = state.nodes[1].inside;
    expect(graph?.nodes).toHaveLength(3);
    expect(graph?.nodes[1]?.id).toMatch(/^note-/); expect(graph?.nodes[2]?.id).toMatch(/^note-/);
    expect(graph?.edges).toEqual([{ from: 'b', to: graph?.nodes[1]?.id }, { from: graph?.nodes[1]?.id, to: graph?.nodes[2]?.id }]);
    expect(state.edges).toEqual(edges);
  });
  it('refuses stale drafts, missing sections, duplicate identities and invalid parents without partial edits', () => {
    for (const mutate of [
      (/** @type {any} */ a) => { a.base = '{}'; },
      (/** @type {any} */ a) => { a.sections.pop(); },
      (/** @type {any} */ a) => { a.sections.push(a.sections[0]); },
      (/** @type {any} */ a) => { a.sections.push({ id: 'draft-bad', label: 'Wrong graph', body: '', parent: 'b', graph: '', depth: 1 }); },
      (/** @type {any} */ a) => { a.sections[0].body = 3; },
    ]) {
      const state = sample(), before = structuredClone(state), a = request(state); a.title = 'Changed'; mutate(a);
      expect(noteActs({ getState: () => state }).writenote(a)).toBe(false); expect(state).toEqual(before);
    }
  });
  it('requires the owner, saves through the real action path, and undoes as one edit', async () => {
    const state = sample(); delete state.nodes[1].action;
    const { map, close } = openTestMap(state);
    try {
      const a = request(map.snapshot()); a.sections[1].label = 'Customers'; a.description = 'Updated introduction';
      expect((await send(map, 'Sam', a)).status).toBe(400);
      expect((await send(map, 'Duy', a)).status).toBe(200);
      expect(map.snapshot().nodes[1].label).toBe('Customers');
      expect((await send(map, 'Duy', { type: 'undo' })).status).toBe(200);
      expect(map.snapshot().nodes[1].label).toBe('Audience');
      expect(map.snapshot().desc).toBe('For spring');
    } finally { close(); }
  });
  it('reparents headings while preserving identities, nested maps, comments and side relationships', () => {
    const state = sample(), before = structuredClone(state), a = { ...request(state), structure: true };
    a.sections[a.sections.length - 1].parent = 'root';
    expect(noteActs({ getState: () => state }).writenote(a)).toBe(true);
    expect(state.edges).toContainEqual({ from: 'root', to: 'c' });
    expect(state.edges).not.toContainEqual(expect.objectContaining({ from: 'a', to: 'c' }));
    expect(state.edges).toContainEqual({ from: 'c', to: 'root', label: 'Revisit', sideLink: true });
    expect(state.nodes.find((n) => n.id === 'a')?.inside).toEqual(before.nodes[1].inside);
    expect(state.comments).toEqual(before.comments); expect(state.memory).toEqual(before.memory);
    expect(noteDocument(state).sections.find((s) => s.id === 'c')?.parent).toBe('root');
  });
  it('supports an outline twelve boxes deep and keeps that depth after another projection', () => {
    const state = sample(), a = { ...request(state), structure: true };
    for (let i = 0; i < 12; i++) a.sections.push({ id: `draft-${i}`, label: `Depth ${i + 1}`, body: '', graph: '', parent: i ? `draft-${i - 1}` : 'c', depth: i + 3 });
    expect(noteActs({ getState: () => state }).writenote(a)).toBe(true);
    const document = noteDocument(state), deepest = document.sections.find((s) => s.label === 'Depth 12');
    expect(deepest?.depth).toBe(14);
    expect(document.sections.find((s) => s.id === deepest?.parent)?.label).toBe('Depth 11');
  });
  it('keeps the written order of headings that have the same parent', () => {
    const state = sample(); delete state.nodes[1].inside;
    state.edges = [{from:'root',to:'a'},{from:'root',to:'c'}];
    const a = { ...request(state), structure: true };
    a.sections = [a.sections[0],a.sections[2],a.sections[1]];
    expect(noteActs({ getState: () => state }).writenote(a)).toBe(true);
    expect(noteDocument(state).sections.map((s) => s.id)).toEqual(['root','c','a']);
  });
  it('keeps protected Actions and rejects cyclic or cross-map headings atomically', () => {
    for (const change of [
      (/** @type {any} */ a) => { a.sections[0].parent = 'c'; },
      (/** @type {any} */ a) => { a.sections.find((s) => s.id === 'b').graph = ''; },
      (/** @type {any} */ a) => { a.sections = a.sections.filter((s) => s.id !== 'a' && s.id !== 'b'); a.sections[a.sections.length - 1].parent = 'root'; },
    ]) {
      const state = sample(); state.nodes[1].action.stage = 'running';
      const before = structuredClone(state), a = { ...request(state), structure: true }; change(a);
      expect(noteActs({ getState: () => state }).writenote(a)).toBe(false); expect(state).toEqual(before);
    }
  });
});
