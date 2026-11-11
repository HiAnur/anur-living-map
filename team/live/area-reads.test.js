import { describe, expect, it } from 'vitest';

import { act, openTestMap, read } from './map.harness.js';
import { forArea } from './sharing.js';

// What a member who sees one area receives of the map, asked of a real map through its API: that area in full, and
// of every other box only the outline the page draws locked.

const state = () => ({
  title: 'T', start: 'root', log: [{ at: 1, who: 'Ana', action: 'confirmed', call: 'c1', node: 'api', text: 'Raise the bands?' }],
  people: [{ id: 'Ana', role: 'Admin', sees: 'all' }, { id: 'Sam', sees: 'web' }],
  nodes: [
    { id: 'root', label: 'Root', x: 0, y: 0 },
    { id: 'web', label: 'Web', sub: 'The site', x: 300, y: -90, area: 'web' },
    { id: 'api', label: 'Pay', sub: 'Salary bands', desc: 'Confidential pay data', x: 300, y: 90, w: 160, area: 'api',
      action: { id: 'r', by: 'Ana', stage: 'ready', brief: { goal: 'Send the bands' } }, inside: { nodes: [{ id: 'db', label: 'Db', area: 'api' }], edges: [] } },
  ],
  edges: [{ from: 'root', to: 'web' }, { from: 'web', to: 'api', label: 'Reads the bands' }],
  calls: [{ id: 'c1', status: 'confirmed', ask: 'Raise the bands?', for: 'Ana', node: 'api' }, { id: 'c2', status: 'open', ask: 'New logo?', for: 'Sam', node: 'web' }],
  comments: [{ id: 1, x: 0, y: 0, view: 'system', node: 'api', resolved: false, msgs: [{ who: 'Ana', text: 'Private api note', at: 1 }] },
    { id: 2, x: 0, y: 0, view: 'system', node: 'web', resolved: false, msgs: [{ who: 'Ana', text: 'Site note', at: 1 }] }],
  memory: [{ id: 'k1', text: 'Bands are secret', box: 'api' }, { id: 'k2', text: 'Ship on Tuesdays', box: null }],
  threads: { '@Ana>api': [{ who: 'Ana', text: 'Bands?' }], '@Sam>web': [{ who: 'Sam', text: 'Logo?' }] },
  archived: [{ box: { id: 'old', label: 'Old pay run', area: 'api', action: { by: 'Ana', stage: 'finished' } }, edges: [], in: null, by: 'Ana', at: 1 }],
});

/** The map as `who` receives it from /api/state @param {string} who */
async function stateAs(who) {
  const { map, close } = openTestMap(state());
  const { text } = await read(map, who, '/api/state');
  close();
  return JSON.parse(text);
}

describe('a one-area member', () => {
  it('receives a box outside their area only as its outline', async () => {
    const s = await stateAs('Sam'), api = s.nodes.find((/** @type {any} */ n) => n.id === 'api');
    expect(api).toEqual({ id: 'api', label: 'Pay', x: 300, y: 90, w: 160, area: 'api' });
    expect(s.nodes.find((/** @type {any} */ n) => n.id === 'web')).toMatchObject({ sub: 'The site' });
    expect(JSON.stringify(s)).not.toMatch(/Salary bands|Confidential pay data|Send the bands|Private api note|Bands are secret|Raise the bands|Old pay run|Reads the bands/);
  });
  it('keeps everything about their own area, and what belongs to no box', async () => {
    const s = await stateAs('Sam');
    expect(s.comments.map((/** @type {any} */ c) => c.id)).toEqual([2]);
    expect(s.calls.map((/** @type {any} */ c) => c.id)).toEqual(['c2']);
    expect(s.memory.map((/** @type {any} */ m) => m.id)).toEqual(['k2']);
    expect(Object.keys(s.threads)).toEqual(['@Sam>web']);
    expect(s.edges).toEqual([{ from: 'root', to: 'web' }, { from: 'web', to: 'api' }]);
    expect(s.archived).toEqual([]);
    expect(s.log).toEqual([]);
  });
  it('receives the same cut in the live updates', async () => {
    const { map, close } = openTestMap(state());
    const { text } = await read(map, 'Sam', '/api/events');
    close();
    const first = JSON.parse(/** @type {string} */ (text.match(/^event: state\ndata: (.*)$/m)?.[1]));
    expect(JSON.stringify(first)).not.toMatch(/Salary bands|Private api note/);
    expect(first.nodes.find((/** @type {any} */ n) => n.id === 'web').sub).toBe('The site');
  });
  it('never reads the outbox, where the map tells its chat everything', async () => {
    const { map, close } = openTestMap(state());
    expect((await read(map, 'Sam', '/api/outbox')).status).toBe(403);
    expect((await read(map, 'Ana', '/api/outbox')).status).toBe(200);
    close();
  });
  it('may not comment on, reply to or resolve a thread outside their area', async () => {
    for (const a of [{ type: 'comment', x: 1, y: 1, text: 'Hm', node: 'api' }, { type: 'reply', id: 1, text: 'Hm' }, { type: 'resolve', id: 1 }])
      expect((await act('Sam', a, state())).status, a.type).toBe(400);
    expect((await act('Sam', { type: 'reply', id: 2, text: 'Done' }, state())).status).toBe(200);
  });
});

describe('a member who sees the whole map', () => {
  it('receives the map as it is', async () => {
    const s = await stateAs('Ana');
    expect(s.nodes.find((/** @type {any} */ n) => n.id === 'api')).toMatchObject({ sub: 'Salary bands', action: { by: 'Ana' } });
    expect(s.comments).toHaveLength(2);
  });
});

describe('forArea', () => {
  it('cuts an earlier version the same way, boxes inside a box included', () => {
    const v = forArea({ nodes: [{ id: 'svc', label: 'Svc', area: 'web', inside: { nodes: [{ id: 'q', label: 'Q', sub: 'Queue', area: 'api' }], edges: [] } }], edges: [] }, 'web');
    expect(v.nodes[0].inside.nodes[0]).toEqual({ id: 'q', label: 'Q', area: 'api' });
  });
});
