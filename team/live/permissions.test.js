import { describe, expect, it } from 'vitest';

import { COMMANDS } from './commands.js';
import { act as actOn, openTestMap, TOKEN } from './map.harness.js';
import { WHO } from './permissions.js';
import { LINK_EDITS } from './sharing.js';

// Who may take each action on a map, asked of a real map through its API as each kind of person: an Admin, a
// member who sees the whole map, a member who sees one area, a removed member, a guest with an edit link or a
// view link, and a program on this Mac. Every action runs on a fresh map, so one never changes what the next sees.

/** @param {'view' | 'edit'} [mode] */
const state = (mode = 'edit') => ({
  title: 'Launch', prompt: 'Build it', start: 'root', linkSharing: { mode, token: TOKEN },
  people: [{ id: 'Ana', role: 'Admin', sees: 'all' }, { id: 'Duy', sees: 'all' }, { id: 'Sam', sees: 'web' }],
  removedPeople: ['Lee'],
  nodes: [
    { id: 'root', label: 'Launch', x: 0, y: 0 },
    { id: 'web', label: 'Web', x: 300, y: -90, area: 'web' }, { id: 'web2', label: 'Web two', x: 600, y: -90, area: 'web' },
    { id: 'web3', label: 'Web three', x: 300, y: -200, area: 'web' },
    { id: 'api', label: 'Api', x: 300, y: 90, area: 'api' },
  ],
  edges: [{ from: 'root', to: 'web' }, { from: 'root', to: 'web3' }, { from: 'root', to: 'api' }, { from: 'web', to: 'web2', label: 'Calls' }],
  calls: [{ id: 'c1', status: 'open', ask: 'Ship it?', for: 'Ana', node: 'api' }],
  comments: [{ id: 1, x: 0, y: 0, view: 'system', node: 'api', resolved: false, msgs: [{ who: 'Ana', text: 'Why?', at: 1 }] }],
  memory: [{ id: 'k1', text: 'Tuesdays', box: 'api' }, { id: 'k2', text: 'Mondays', box: 'web' }],
  threads: { '@Ana': [{ who: 'Ana', text: 'Hi' }], '@Duy': [{ who: 'Duy', text: 'Hi' }], '@Sam': [{ who: 'Sam', text: 'Hi' }] }, log: [],
});

/** @typedef {'Ana' | 'Duy' | 'Sam' | 'Lee' | 'edit link' | 'view link' | 'tool'} Persona */
/** A request as the persona sends it, answered by a fresh map. @param {Persona} who @param {any} a */
const act = (who, a, initial = state(who === 'view link' ? 'view' : 'edit')) => actOn(who, a, initial);
const allowed = async (/** @type {Persona} */ who, /** @type {any} */ a) => (await act(who, a)).status === 200;

// An action each persona may take when it is theirs to take: what it changes is on the fresh map above. Actions that
// start Claude (ask, preparing or running an Action) are only ever asked of people who may not take them.
const OK = /** @type {Record<string, any>} */ ({
  move: { type: 'move', moves: [{ id: 'web', fromX: 300, fromY: -90, x: 310, y: -80 }] },
  reparent: { type: 'reparent', id: 'web2', parent: 'web3', parents: ['web'], moves: [{ id: 'web2', fromX: 600, fromY: -90, x: 600, y: -200 }] },
  tidy: { type: 'tidy' }, add: { type: 'add', label: 'New', x: 900, y: 0 }, connect: { type: 'connect', from: 'web2', to: 'web' },
  remove: { type: 'remove', id: 'web2' }, unlink: { type: 'unlink', from: 'web', to: 'web2' },
  resize: { type: 'resize', id: 'web', x: 300, y: -90, w: 200, h: 60 }, relabel: { type: 'relabel', from: 'web', to: 'web2', label: 'Sends' },
  renamebox: { type: 'renamebox', id: 'web', label: 'Website' }, describebox: { type: 'describebox', id: 'web', sub: 'The site' },
  rename: { type: 'rename', title: 'Spring launch' }, comment: { type: 'comment', x: 1, y: 2, text: 'Hm' },
  reply: { type: 'reply', id: 1, text: 'Because' }, resolve: { type: 'resolve', id: 1 },
  editmemory: { type: 'editmemory', id: 'k2', text: 'Fridays' }, forget: { type: 'forget', id: 'k2' },
  call: { type: 'call', id: 'c1', answer: 'confirm' }, describemap: { type: 'describemap', description: 'Spring' },
  contextmap: { type: 'contextmap', id: 'gtm', include: false }, savenow: { type: 'savenow' }, autosave: { type: 'autosave', on: false },
  open: { type: 'open' }, execute: { type: 'execute' }, planmd: { type: 'planmd' }, actionbox: { type: 'actionbox', id: 'web' },
  plan: { type: 'plan', nodes: [{ id: 'billing', label: 'Billing', sub: 'Stripe' }], note: 'n' },
  edit: { type: 'edit', nodes: [{ id: 'billing', label: 'Billing', sub: 'Stripe' }], note: 'n' },
  pr: { type: 'pr', id: '#1', title: 'Billing' }, newchat: { type: 'newchat' }, reset: { type: 'reset' },
});
// the same actions on a box outside the area the one-area member, Sam, sees
const OUTSIDE = /** @type {Record<string, any>} */ ({
  move: { type: 'move', moves: [{ id: 'api', fromX: 300, fromY: 90, x: 310, y: 100 }] },
  reparent: { type: 'reparent', id: 'api', parent: 'web', parents: ['root'], moves: [{ id: 'api', fromX: 300, fromY: 90, x: 600, y: 0 }] },
  connect: { type: 'connect', from: 'api', to: 'web' },
  remove: { type: 'remove', id: 'api' }, unlink: { type: 'unlink', from: 'root', to: 'api' },
  resize: { type: 'resize', id: 'api', x: 300, y: 90, w: 200, h: 60 }, relabel: { type: 'relabel', from: 'root', to: 'api', label: 'Calls' },
  renamebox: { type: 'renamebox', id: 'api', label: 'API' }, describebox: { type: 'describebox', id: 'api', sub: 'The api' },
  editmemory: { type: 'editmemory', id: 'k1', text: 'Fridays' }, forget: { type: 'forget', id: 'k1' },
  ask: { type: 'ask', node: 'api', text: 'What next?' }, actionbox: { type: 'actionbox', id: 'api' },
});

describe('who may take each action', () => {
  it('a view link may take none', async () => {
    for (const type of [...Object.keys(COMMANDS), 'cursor']) expect((await act('view link', { type })).status, type).toBe(403);
  });
  it('a removed member may take none', async () => {
    for (const type of [...Object.keys(COMMANDS), 'cursor']) expect((await act('Lee', { type })).status, type).toBe(403);
  });
  it('an edit link may take only the editing actions, as Guest', async () => {
    for (const type of Object.keys(COMMANDS)) if (!LINK_EDITS.has(type)) expect((await act('edit link', { ...(OK[type] || { type }) })).status, type).toBe(403);
    for (const type of LINK_EDITS) if (OK[type]) expect(await allowed('edit link', OK[type]), type).toBe(true);
    // a guest is no person on the map, so no area limits it
    expect(await allowed('edit link', OUTSIDE.remove)).toBe(true);
    expect((await act('edit link', OK.comment)).after.comments.at(-1).msgs[0].who).toBe('Guest');
  });
  it('only an Admin may press Execute or ask for plan.md', async () => {
    // both wait until every question on the map is answered
    const answered = () => ({ ...state(), calls: [] });
    for (const type of ['execute', 'planmd']) {
      expect((await act('Ana', OK[type], answered())).status, type).toBe(200);
      for (const who of /** @type {Persona[]} */ (['Duy', 'Sam', 'tool'])) expect((await act(who, OK[type], answered())).status, `${who} ${type}`).toBe(400);
    }
  });
  it('only a member who sees the whole map may describe it or choose its background maps', async () => {
    for (const type of ['describemap', 'contextmap']) {
      for (const who of /** @type {Persona[]} */ (['Ana', 'Duy', 'tool'])) expect(await allowed(who, OK[type]), `${who} ${type}`).toBe(true);
      expect(await allowed('Sam', OK[type]), type).toBe(false);
    }
  });
  it('a one-area member may change only boxes in their area', async () => {
    for (const [type, a] of Object.entries(OUTSIDE)) {
      expect(await allowed('Sam', a), `outside: ${type}`).toBe(false);
      if (type !== 'ask') expect(await allowed('Duy', a), `whole map: ${type}`).toBe(true);
    }
    for (const type of Object.keys(OUTSIDE)) if (OK[type]) expect(await allowed('Sam', OK[type]), `inside: ${type}`).toBe(true);
  });
  it('a one-area member drawing out of a box outside their area gets the new box in their area, without the line', async () => {
    const { status, after } = await act('Sam', { type: 'add', label: 'New', x: 900, y: 0, from: 'api' });
    expect(status).toBe(200);
    expect(after.nodes.find((/** @type {any} */ n) => n.label === 'New')?.area).toBe('web');
    expect(after.edges.some((/** @type {any} */ e) => e.from === 'api' && e.to === 'new')).toBe(false);
  });
  it('a one-area member may move one box outside their area by its id: only a drag of several boxes checks', async () => {
    expect(await allowed('Sam', { type: 'move', id: 'api', x: 310, y: 100 })).toBe(true);
  });
  it('a one-area member may still take the actions with no area: these change the whole map', async () => {
    for (const type of ['rename', 'tidy', 'reset', 'savenow', 'autosave', 'call', 'comment', 'reply', 'resolve', 'plan', 'edit', 'pr', 'open', 'newchat'])
      expect(await allowed('Sam', OK[type]), type).toBe(true);
  });
  it('a member and a program on this Mac may take every other action that is theirs', async () => {
    for (const [type, a] of Object.entries(OK)) {
      if (['execute', 'planmd', 'newchat'].includes(type)) continue;
      expect(await allowed('Duy', a), `Duy ${type}`).toBe(true);
      expect(await allowed('tool', a), `tool ${type}`).toBe(true);
    }
  });
  it('only the owner of the linked chat may drop its change or write to it', async () => {
    const linked = () => ({ ...state(), linked: [{ session: 's1', file: '/x.jsonl', owner: 'Ana', at: 1 }],
      proposals: [{ id: 'p1', session: 's1', status: 'pending', made: 1, ops: ['x'], plan: { nodes: [], edges: [] } }] });
    for (const a of [{ type: 'drop', proposal: 'p1' }, { type: 'say', text: 'Hello' }]) {
      expect((await act('Duy', a, linked())).status, `Duy ${a.type}`).toBe(400);
      expect((await act('Ana', a, linked())).status, `Ana ${a.type}`).toBe(200);
    }
  });
  it('only an Admin may hand an Action over, to a member who can use its box', async () => {
    const owned = () => ({ ...state(), nodes: state().nodes.map((n) => n.id === 'web' || n.id === 'api' ? { ...n, action: { by: 'Duy', stage: 'ready', id: 'r', brief: {} } } : n) });
    expect((await act('Ana', { type: 'actionhandover', id: 'web', to: 'Sam' }, owned())).status).toBe(200);
    expect((await act('Duy', { type: 'actionhandover', id: 'web', to: 'Sam' }, owned())).status).toBe(400);
    expect((await act('Ana', { type: 'actionhandover', id: 'web', to: 'Nobody' }, owned())).status).toBe(400);
    expect((await act('Ana', { type: 'actionhandover', id: 'api', to: 'Sam' }, owned())).status).toBe(400);
    expect((await act('edit link', { type: 'actionhandover', id: 'web', to: 'Sam' }, owned())).status).toBe(403);
    const { after } = await act('Ana', { type: 'actionhandover', id: 'web', to: 'Sam' }, owned());
    expect(after.nodes.find((/** @type {any} */ n) => n.id === 'web')?.action?.by).toBe('Sam');
  });
  it('only the person who started an Action box may go on with it', async () => {
    const started = () => ({ ...state(), nodes: state().nodes.map((n) => n.id === 'web' ? { ...n, action: { by: 'Ana', stage: 'draft' } } : n) });
    expect((await act('Duy', { type: 'actioncancel', id: 'web' }, started())).status).toBe(400);
    expect((await act('Ana', { type: 'actioncancel', id: 'web' }, started())).status).toBe(200);
  });
});

describe('an edit through the cloud copy', () => {
  it('takes only what an edit link may, whoever it says it is', () => {
    const { map, close } = openTestMap({ ...state(), calls: [] });
    expect(map.editShared({ ...OK.rename, by: 'Guest 1a2b3c' }).ok).toBe(true);
    for (const a of [OK.execute, OK.describemap, OK.reset, { type: 'cursor', x: 1, y: 1 }]) expect(map.editShared({ ...a, by: 'Owner' }).ok, a.type).toBe(false);
    close();
  });
});

describe('the table in permissions.js', () => {
  it('has a row for every action a map takes', () => {
    expect(Object.keys(WHO).sort()).toEqual([...Object.keys(COMMANDS), 'cursor'].sort());
  });
  it('gives an edit link the same actions as before it was a table', () => {
    expect([...LINK_EDITS].sort()).toEqual(['add', 'comment', 'connect', 'cursor', 'describebox', 'move', 'redo', 'relabel', 'remove', 'rename', 'renamebox', 'reparent', 'reply', 'resize', 'resolve', 'tidy', 'undo', 'unlink']);
  });
});
