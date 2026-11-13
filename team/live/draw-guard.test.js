import { describe, expect, it } from 'vitest';

import { guardDrawing } from './draw-guard.js';
import { act as actOn, openTestMap, send } from './map.harness.js';

// What a drawing may change, asked of a real map through its API: a box's content, on boxes in the sender's area,
// never the map's own record of a box, and questions asked but never answered.

const state = () => ({
  title: 'T', start: 'root', log: [],
  calls: [
    { id: 'open', status: 'open', ask: 'Ship the api?', text: 'Ship the api?', for: 'Ana', node: 'api' },
    { id: 'webq', status: 'open', ask: 'Ship the site?', text: 'Ship the site?', for: 'Ana', node: 'web' },
    { id: 'done', status: 'confirmed', ask: 'Use Stripe?', text: 'Use Stripe?', for: 'Ana', node: 'web', by: 'Ana', at: '1' },
  ],
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
  return { status, after, box: (/** @type {string} */ id) => /** @type {any} */ (after.nodes.find((/** @type {any} */ n) => n.id === id)),
    call: (/** @type {string} */ id) => /** @type {any} */ (after.calls.find((/** @type {any} */ c) => c.id === id)) };
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

// What the map's tools (mcp.js) send is Claude's, whatever name it gives: a change to a box a person made or changed,
// or greying out a box Claude did not make, waits as a proposal in the linked chat's pane, never drawn.
describe('Claude\'s drawing through the map\'s tools', () => {
  const linked = () => ({ ...state(), linked: [{ session: 's1', file: '/x.jsonl', owner: 'Ana', at: 1 }],
    nodes: [...state().nodes, { id: 'mine', label: 'Mine', by: 'Claude', x: 600, y: 0 }] });
  /** @param {any} a @param {any} [initial] */
  const tool = async (a, initial = linked()) => {
    const { status, after } = await actOn('tool', { type: 'edit', ...a }, initial);
    return { status, after, box: (/** @type {string} */ id) => /** @type {any} */ (after.nodes.find((/** @type {any} */ n) => n.id === id)) };
  };

  it('offers a change to a person\'s box for Apply, and draws a change to its own', async () => {
    const { status, after, box } = await tool({ by: 'Duy', nodes: [{ id: 'api', sub: 'Rewritten' }, { id: 'mine', sub: 'Mine, changed' }] });
    expect(status).toBe(200);
    expect(box('api').sub).toBeUndefined();
    expect(box('mine').sub).toBe('Mine, changed');
    expect(after.proposals).toHaveLength(1);
    expect(after.proposals[0]).toMatchObject({ session: 's1', status: 'pending', ops: ['Change Api: second line "Rewritten"'], plan: { nodes: [{ id: 'api', sub: 'Rewritten' }] } });
  });
  it('changes the person\'s box once the linked chat\'s owner presses Apply', async () => {
    const { map, close } = openTestMap(linked());
    await send(map, 'tool', { type: 'edit', nodes: [{ id: 'api', sub: 'Rewritten' }] });
    const id = /** @type {any} */ (map.snapshot()).proposals[0].id;
    expect((await send(map, 'Duy', { type: 'apply', proposal: id })).status).toBe(400);
    expect((await send(map, 'Ana', { type: 'apply', proposal: id })).status).toBe(200);
    const after = /** @type {any} */ (map.snapshot());
    close();
    expect(after.nodes.find((/** @type {any} */ n) => n.id === 'api')).toMatchObject({ sub: 'Rewritten', by: 'Ana', updatedBy: 'Ana' });
  });
  it('offers greying out a box it did not make, and greys out its own', async () => {
    const { box, after } = await tool({ nodes: [{ id: 'web', state: 'gone' }, { id: 'mine', state: 'gone' }] });
    expect(box('web').state).toBeUndefined();
    expect(box('mine').state).toBe('gone');
    expect(after.proposals[0].plan.nodes).toEqual([{ id: 'web', state: 'gone' }]);
  });
  it('holds what the call itself marks for Apply, and draws nothing of it when no chat is linked to hold it', async () => {
    const { box, after } = await tool({ propose: [{ id: 'mine', sub: 'Asked for Apply' }], edges: [{ from: 'root', to: 'mine', label: 'Starts' }] }, { ...linked(), linked: [] });
    expect(box('mine').sub).toBeUndefined();
    expect(after.proposals || []).toEqual([]);
    expect(after.edges).toContainEqual({ from: 'root', to: 'mine', label: 'Starts' });
  });
  it('moves a person\'s box into the area of someone it asks a question on it, and nothing else', async () => {
    const { box } = await tool({ nodes: [{ id: 'api', area: 'web' }], calls: [{ id: 'q1', node: 'api', for: 'Sam', ask: 'Ship it?', status: 'open' }] });
    expect(box('api').area).toBe('web');
  });
  it('leaves a signed-in person\'s own edit as it was', async () => {
    const { after } = await actOn('Duy', { type: 'edit', nodes: [{ id: 'api', sub: 'By hand' }] }, linked());
    expect(after.nodes.find((/** @type {any} */ n) => n.id === 'api').sub).toBe('By hand');
    expect(after.proposals || []).toEqual([]);
  });
});

describe('a drawing\'s questions', () => {
  it('are never answered, reassigned or moved by it, whoever sends it', async () => {
    for (const who of /** @type {const} */ (['Ana', 'Duy'])) {
      const { call } = await act(who, { type: 'edit', calls: [{ id: 'open', status: 'confirmed', by: who, for: who, node: 'web', ask: 'Ship the api today?' }] });
      expect(call('open'), who).toMatchObject({ status: 'open', for: 'Ana', node: 'api', ask: 'Ship the api today?' });
      expect(call('open').by, who).toBeUndefined();
    }
  });
  it('leave an answered question as it was', async () => {
    const { call } = await act('Duy', { type: 'edit', calls: [{ id: 'done', status: 'open', ask: 'Use Adyen?' }] });
    expect(call('done')).toMatchObject({ status: 'confirmed', ask: 'Use Stripe?', by: 'Ana' });
  });
  it('arrive open, however they were sent', async () => {
    const { call } = await act('Duy', { type: 'plan', calls: [{ id: 'new', status: 'answered', picked: 'Yes', ask: 'Launch?', for: 'Ana', node: 'web' }] });
    expect(call('new')).toMatchObject({ status: 'open', ask: 'Launch?' });
    expect(call('new').picked).toBeUndefined();
  });
  it('from a one-area member, are only on boxes in their area, and their answers change only those', async () => {
    const { call } = await act('Sam', { type: 'plan', calls: [
      { id: 'there', ask: 'Rename the api?', for: 'Ana', node: 'api' },
      { id: 'here', ask: 'Rename the site?', for: 'Ana', node: 'web', confirm: { node: 'api', sub: 'Gone' }, dispute: { node: 'web', sub: 'Kept' },
        options: [{ id: 'a', label: 'A', node: 'api', sub: 'Gone' }, { id: 'b', label: 'B', node: 'web', sub: 'Site' }] },
      { id: 'open', ask: 'Taken over' }, { id: 'webq', ask: 'Ship the site this week?' },
    ] });
    expect(call('there')).toBeUndefined();
    expect(call('here').confirm).toBeUndefined();
    expect(call('here').dispute).toEqual({ node: 'web', sub: 'Kept' });
    expect(call('here').options.map((/** @type {any} */ o) => o.id)).toEqual(['b']);
    expect(call('open').ask).toBe('Ship the api?');
    expect(call('webq').ask).toBe('Ship the site this week?');
  });
  it('are still answered through the call action, by anyone who may change their box', async () => {
    expect((await act('Sam', { type: 'call', id: 'webq', answer: 'confirm' })).call('webq')).toMatchObject({ status: 'confirmed', by: 'Sam' });
    expect((await act('Sam', { type: 'call', id: 'open', answer: 'confirm' })).call('open')).toMatchObject({ status: 'open' });
    expect((await act('Duy', { type: 'call', id: 'open', answer: 'confirm' })).call('open')).toMatchObject({ status: 'confirmed', by: 'Duy' });
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
