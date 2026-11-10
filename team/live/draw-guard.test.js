import { describe, expect, it } from 'vitest';

import { guardDrawing } from './draw-guard.js';
import { act as actOn } from './map.harness.js';

// What a drawing may change, asked of a real map through its API: a box's content, on boxes in the sender's area,
// and never the map's own record of a box.

const state = () => ({
  title: 'T', start: 'root', calls: [], log: [],
  people: [{ id: 'Ana', role: 'Admin', sees: 'all' }, { id: 'Duy', sees: 'all' }, { id: 'Sam', sees: 'web' }],
  nodes: [
    { id: 'root', label: 'Root', x: 0, y: 0 },
    { id: 'web', label: 'Web', x: 300, y: -90, area: 'web' },
    { id: 'api', label: 'Api', x: 300, y: 90, area: 'api', by: 'Ana', action: { id: 'r', by: 'Ana', stage: 'ready', brief: {} },
      inside: { nodes: [{ id: 'db', label: 'Db', x: 0, y: 0 }], edges: [] } },
  ],
  edges: [{ from: 'root', to: 'web' }, { from: 'root', to: 'api' }],
});

/** @param {'Ana' | 'Duy' | 'Sam'} who @param {any} a */
async function act(who, a) {
  const { status, after } = await actOn(who, a, state());
  return { status, after, box: (/** @type {string} */ id) => /** @type {any} */ (after.nodes.find((/** @type {any} */ n) => n.id === id)) };
}
const forged = { id: 'r', by: 'Sam', stage: 'finished', completion: { status: 'completed', evidence: ['made up'] } };

describe('a drawing', () => {
  it('never writes a box\'s Action, maker or dates, whoever sends it', async () => {
    for (const type of ['edit', 'plan']) for (const who of /** @type {const} */ (['Ana', 'Duy'])) {
      const { box } = await act(who, { type, nodes: [{ id: 'api', sub: 'The api', action: forged, by: who, createdAt: 1, source: { kind: 'map' } }] });
      expect(box('api').sub, `${who} ${type}`).toBe('The api');
      expect(box('api').action, `${who} ${type}`).toMatchObject({ by: 'Ana', stage: 'ready' });
      expect(box('api').by).toBe('Ana');
    }
  });
  it('keeps what a box already holds inside, and its planned task', async () => {
    const { box } = await act('Duy', { type: 'edit', nodes: [{ id: 'api', inside: { nodes: [], edges: [] }, task: { goal: 'x' }, boxType: 'topic' }] });
    expect(box('api').inside.nodes.map((/** @type {any} */ n) => n.id)).toEqual(['db']);
    expect(box('api').task).toBeUndefined();
  });
  it('from a one-area member, changes only boxes in their area, and never an area', async () => {
    const { box } = await act('Sam', { type: 'edit', nodes: [{ id: 'api', sub: 'Mine now', area: 'web' }, { id: 'web', sub: 'Site', area: 'api' }] });
    expect(box('api')).toMatchObject({ area: 'api' });
    expect(box('api').sub).toBeUndefined();
    expect(box('web')).toMatchObject({ sub: 'Site', area: 'web' });
  });
  it('gives a one-area member\'s new box their area, and an Action on it is dropped', async () => {
    const { box } = await act('Sam', { type: 'plan', nodes: [{ id: 'blog', label: 'Blog', sub: 'Posts', area: 'api', action: forged }] });
    expect(box('blog')).toMatchObject({ area: 'web', by: 'Sam' });
    expect(box('blog').action).toBeUndefined();
  });
  it('lets a member who sees the whole map set an area', async () => {
    const { box } = await act('Duy', { type: 'edit', nodes: [{ id: 'web', area: 'api' }] });
    expect(box('web').area).toBe('api');
  });
  it('from a one-area member, draws, removes and unlinks only between boxes in their area', async () => {
    const { after, box } = await act('Sam', { type: 'plan', nodes: [{ id: 'blog', label: 'Blog', sub: 'Posts' }],
      edges: [{ from: 'web', to: 'blog', label: 'Links' }, { from: 'api', to: 'blog', label: 'Feeds' }], remove: ['api'], unlink: [{ from: 'root', to: 'api' }] });
    expect(box('api')).toBeDefined();
    expect(after.edges).toEqual(expect.arrayContaining([{ from: 'root', to: 'api' }, expect.objectContaining({ from: 'web', to: 'blog' })]));
    expect(after.edges.some((/** @type {any} */ e) => e.from === 'api' && e.to === 'blog')).toBe(false);
  });
});

describe('guardDrawing', () => {
  it('makes every box inside a new box new too', () => {
    const out = guardDrawing({ nodes: [{ id: 'svc', label: 'Svc', inside: { nodes: [{ id: 'q', label: 'Q', action: forged }] } }] }, () => undefined, 'web');
    const [svc] = /** @type {any[]} */ (out.nodes);
    expect(svc).toMatchObject({ area: 'web', inside: { nodes: [{ id: 'q', area: 'web' }], edges: [] } });
    expect(svc.inside.nodes[0].action).toBeUndefined();
  });
});
