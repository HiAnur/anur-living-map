import { describe, expect, it } from 'vitest';

import { mapData } from './cloud-data.js';
import { openTestMap, send } from './map.harness.js';
import { numberingGroupOf } from './numbering.js';
import { numberTopics, numberingTree } from './page-design.js';
import { levelGraph } from './page-hub.js';
import { withoutRepos } from './sharing.js';

describe('numbering selected siblings', () => {
  it('keeps nested groups distinct through a shared map and gives new siblings their group format', async () => {
    const { map, close } = openTestMap({
      title: 'Plan', start: 'start', numbering: { format: 'decimal', level: 'all' },
      nodes: [
        { id: 'start', label: 'Plan', x: 0, y: 0 },
        { id: 'questions', label: 'Questions', x: 250, y: 0, inside: {
          nodes: [
            { id: 'a', label: 'Trial length', x: 100, y: 0 },
            { id: 'b', label: 'Team size', x: 100, y: 100 },
            { id: 'detail', label: 'Details', x: 300, y: 0 },
          ], edges: [{ from: 'a', to: 'detail' }],
        } },
      ], edges: [{ from: 'start', to: 'questions' }],
    });
    try {
      expect((await send(map, 'Duy', { type: 'designmap', id: 'a', field: 'format', value: 'roman' })).status).toBe(200);
      const state = map.snapshot();
      expect(state.numbering).toEqual({ format: 'decimal', level: 'all', groups: { 'v:questions': 'roman' } });
      expect(state.nodes[1].design).toBeUndefined();
      expect((await send(map, 'Duy', { type: 'add', view: 'questions', label: 'Budget', x: 100, y: 200 })).status).toBe(200);
      const shared = mapData(map.snapshot());
      const graph = levelGraph(shared.nodes[1].inside, { top: false });
      const { depth, parents } = numberingTree(graph);
      const numbers = numberTopics(graph.nodes, depth, parents, shared.numbering, 'questions');
      expect([...numbers]).toEqual([['a', 'I.'], ['b', 'II.'], ['budget', 'III.'], ['detail', '1.']]);
      expect(numberingGroupOf(map.snapshot(), 'budget')?.key).toBe('v:questions');
      expect((await send(map, 'Duy', { type: 'designmap', id: 'a', field: 'format', value: 'none' })).status).toBe(200);
      expect(map.snapshot().numbering.groups).toEqual({ 'v:questions': 'none' });
      expect((await send(map, 'Duy', { type: 'undo' })).status).toBe(200);
      expect(map.snapshot().numbering.groups).toEqual({ 'v:questions': 'roman' });
    } finally {
      close();
    }
  });

  it('removes numbering keys that name inaccessible parents', () => {
    const state = {
      nodes: [{ id: 'repo', label: 'Private repo', source: { repo: 'private' },
        inside: { nodes: [{ id: 'private-detail', label: 'Private detail' }], edges: [] } }],
      edges: [], numbering: { format: 'decimal', groups: { 'p:private-detail': 'roman', 'v:repo': 'letters', 'v:system': 'decimal' } },
    };
    expect(withoutRepos(state, new Set(['private'])).numbering.groups).toEqual({ 'v:system': 'decimal' });
  });

  it('refuses a whole group when one sibling is outside the person’s area', async () => {
    const { map, close } = openTestMap({
      title: 'Plan', start: 'start', people: [{ id: 'Sam', sees: 'web' }],
      nodes: [
        { id: 'start', label: 'Plan', x: 0, y: 0 },
        { id: 'a', label: 'Web', area: 'web', x: 250, y: 0 },
        { id: 'b', label: 'API', area: 'api', x: 250, y: 100 },
      ],
      edges: [{ from: 'start', to: 'a' }, { from: 'start', to: 'b' }],
    });
    try {
      expect((await send(map, 'Sam', { type: 'designmap', id: 'a', field: 'format', value: 'decimal' })).status).toBe(400);
      expect(map.snapshot().numbering).toBeUndefined();
      expect((await send(map, 'Duy', { type: 'designmap', id: 'a', field: 'format', value: 'invalid' })).status).toBe(400);
      expect(map.snapshot().numbering).toBeUndefined();
    } finally {
      close();
    }
  });
});
