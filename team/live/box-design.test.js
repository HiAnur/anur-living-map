import { describe, expect, it } from 'vitest';

import { openTestMap, send } from './map.harness.js';

const initial = () => ({ title: 'Design', start: 'start',
  people: [{ id: 'Sam', sees: 'web' }],
  nodes: [
    { id: 'start', label: 'Design', x: 0, y: 0 },
    { id: 'flag', label: 'Flag', area: 'web', x: 250, y: 0, design: { flag: 'red' } },
    { id: 'progress', label: 'Progress', area: 'web', x: 250, y: 100, design: { progress: '0' } },
    { id: 'align', label: 'Alignment', area: 'api', x: 250, y: 200, design: { align: 'top' } },
  ], edges: [],
});

describe('designing a selection', () => {
  it('changes only the chosen field on every selected box and undoes it together', async () => {
    const { map, close } = openTestMap(initial());
    try {
      const before = map.snapshot().nodes.map((n) => n.design);
      expect((await send(map, 'Duy', { type: 'designbox', ids: ['flag', 'progress', 'align'], field: 'flag', value: 'green' })).status).toBe(200);
      expect(map.snapshot().nodes.map((n) => n.design)).toEqual([
        undefined, { flag: 'green' }, { flag: 'green', progress: '0' }, { flag: 'green', align: 'top' },
      ]);
      expect((await send(map, 'Duy', { type: 'undo' })).status).toBe(200);
      expect(map.snapshot().nodes.map((n) => n.design)).toEqual(before);
      expect((await send(map, 'Duy', { type: 'redo' })).status).toBe(200);
      expect((await send(map, 'Duy', { type: 'designbox', ids: ['flag', 'progress', 'align'], field: 'flag', value: '' })).status).toBe(200);
      expect(map.snapshot().nodes.map((n) => n.design)).toEqual([
        undefined, undefined, { progress: '0' }, { align: 'top' },
      ]);
      expect((await send(map, 'Duy', { type: 'designbox', id: 'align', field: 'align', value: 'center' })).status).toBe(200);
      expect(map.snapshot().nodes[3].design).toBeUndefined();
    } finally { close(); }
  });

  it('refuses the whole change if any box is missing, inaccessible, or the request is invalid', async () => {
    const { map, close } = openTestMap(initial());
    try {
      const before = map.snapshot().nodes;
      for (const change of [
        { ids: ['flag', 'align'] }, { ids: ['flag', 'missing'] }, { ids: [] },
        { ids: ['flag'], value: 'invalid' }, { ids: ['flag'], field: 'format' }, {},
      ]) {
        expect((await send(map, 'Sam', { type: 'designbox', field: 'flag', value: 'green', ...change })).status).toBe(400);
        expect(map.snapshot().nodes).toEqual(before);
      }
    } finally { close(); }
  });
});
