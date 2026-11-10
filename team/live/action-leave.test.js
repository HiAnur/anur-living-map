import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { leaving } from './action-leave.js';
import { taskSource } from './action-plan.js';
import { actionLeaving, STAGES } from './action-stages.js';
import { openMap } from './server.js';

// How a box holding an Action leaves the map, asked of a real map through its API: deleted only before it has run,
// archived after, each only by its author or an Admin, and never while Claude prepares or runs it.

const TOKEN = 'b'.repeat(64);
/** @param {Record<string, any>} [action] the Action on the box `web` @param {Record<string, any>} [more] */
const state = (action = { by: 'Duy', stage: 'draft' }, more = {}) => ({
  title: 'Launch', prompt: 'Build it', start: 'root', linkSharing: { mode: 'edit', token: TOKEN },
  people: [{ id: 'Ana', role: 'Admin', sees: 'all' }, { id: 'Duy', sees: 'all' }, { id: 'Sam', sees: 'all' }],
  nodes: [
    { id: 'root', label: 'Launch', x: 0, y: 0 },
    { id: 'web', label: 'Web', x: 300, y: -90, action: { id: 'r1', ...action } },
    { id: 'next', label: 'Next', x: 600, y: -90 },
  ],
  edges: [{ from: 'root', to: 'web' }, { from: 'web', to: 'next', label: 'Then' }],
  calls: [], log: [], ...more,
});
/** a finished Action whose completion code verified */
const done = (/** @type {any} */ n) => ({ by: 'Duy', stage: 'finished', session: 's', completion: { status: 'completed', evidence: ['Sent'] }, source: taskSource(n) });

/** @param {'Ana' | 'Duy' | 'Sam' | 'edit link' | 'tool'} who @param {any} a @param {any} initial */
async function act(who, a, initial) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-leave-'));
  const map = openMap({ name: 'leave', home, memory: true, initialState: initial });
  const link = who === 'edit link', tool = who === 'tool';
  const headers = tool ? { host: 'localhost' } : { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(link ? {} : { cookie: 'lm_session=x' }) };
  /** @type {any[]} */
  const steps = Array.isArray(a) ? a : [a];
  let status = 0;
  for (const step of steps) {
    const req = Object.assign(Readable.from([JSON.stringify(tool ? { by: 'Duy', ...step } : step)]), { method: 'POST', url: link ? `/api/act?share=${TOKEN}` : '/api/act', headers });
    const res = { writeHead(/** @type {number} */ s) { status = s; return res; }, end() { return res; }, setHeader() {}, write() {}, on() {} };
    await map.handle(req, res, '/api/act', /** @type {any} */ (link || tool ? null : who));
    if (status !== 200) break;
  }
  const after = map.snapshot();
  map.close(); fs.rmSync(home, { recursive: true, force: true });
  return { status, after };
}
const remove = { type: 'remove', id: 'web' }, archive = { type: 'actionarchive', id: 'web' };
const web = (/** @type {any} */ s) => s.nodes.find((/** @type {any} */ n) => n.id === 'web');

describe('deleting a box that holds an Action', () => {
  it('before it runs, its author or an Admin may, and nobody else', async () => {
    for (const who of /** @type {const} */ (['Duy', 'Ana', 'tool'])) {
      const { status, after } = await act(who, remove, state());
      expect(status, who).toBe(200);
      expect(web(after), who).toBeUndefined();
    }
    for (const who of /** @type {const} */ (['Sam', 'edit link'])) expect((await act(who, remove, state())).status, who).toBe(400);
  });
  it('is refused once it has run', async () => {
    for (const stage of ['finished', 'blocked', 'unconfirmed'])
      for (const who of /** @type {const} */ (['Duy', 'Ana'])) expect((await act(who, remove, state({ by: 'Duy', stage }))).status, `${who} ${stage}`).toBe(400);
  });
  // opening a map ends any preparing or running it held, as a restart does, so these are asked of the rule itself
  it('is refused while Claude prepares or runs it, with what to do first', () => {
    const map = /** @type {any} */ (state());
    expect(leaving(map, /** @type {any} */ ({ action: { by: 'Duy', stage: 'gathering' } }), 'Ana')).toMatch(/Cancel it first/);
    expect(leaving(map, /** @type {any} */ ({ action: { by: 'Duy', stage: 'running' } }), 'Duy')).toMatch(/Stop it first/);
  });
  it('is refused for a whole branch that holds an Action that has run', async () => {
    expect((await act('Duy', { type: 'remove', id: 'root', cascade: true }, state({ by: 'Duy', stage: 'finished' }))).status).toBe(400);
    expect((await act('Duy', { type: 'remove', id: 'root', cascade: true }, state())).status).toBe(200);
  });
  it('never happens in a drawing Claude sends', async () => {
    const { status, after } = await act('Duy', { type: 'plan', note: 'n', remove: ['web', 'next'] }, state());
    expect(status).toBe(200);
    expect(web(after)).toBeDefined();
    expect(after.nodes.some((/** @type {any} */ n) => n.id === 'next')).toBe(false);
  });
  it('lets the Actions that waited on it stop waiting', async () => {
    const waits = { id: 'later', label: 'Later', x: 900, y: 0, action: { id: 'r2', by: 'Sam', stage: 'waiting', plan: { dependsOn: ['web'] }, waiting: [{ id: 'web' }] } };
    const { after } = await act('Duy', remove, { ...state(), nodes: [...state().nodes, waits] });
    const later = /** @type {any} */ (after.nodes.find((/** @type {any} */ n) => n.id === 'later'))?.action;
    expect(later.plan.dependsOn).toEqual([]);
    expect(later.stage).toBe('draft');
    expect(later.events.map((/** @type {any} */ e) => e.what)).toContain('unblocked');
  });
});

describe('archiving a box whose Action has run', () => {
  it('takes it off the map with its lines, keeps its Action, and Restore puts it back', async () => {
    const ran = state(done(state().nodes[1]));
    const { status, after } = await act('Duy', archive, ran);
    expect(status).toBe(200);
    expect(web(after)).toBeUndefined();
    expect(after.edges.some((/** @type {any} */ e) => e.from === 'web' || e.to === 'web')).toBe(false);
    expect(after.archived[0]).toMatchObject({ by: 'Duy', box: { id: 'web', action: { stage: 'finished', completion: { status: 'completed' } } } });
    const back = await act('Duy', [archive, { type: 'actionunarchive', id: 'web' }], ran);
    expect(back.status).toBe(200);
    expect(web(back.after).action.events.map((/** @type {any} */ e) => e.what)).toEqual(['archived', 'restored']);
    expect(back.after.edges).toEqual(expect.arrayContaining([{ from: 'root', to: 'web' }, { from: 'web', to: 'next', label: 'Then' }]));
    expect(back.after.archived).toEqual([]);
  });
  it('is for its author or an Admin, and only once it has run', async () => {
    const ran = () => state({ by: 'Duy', stage: 'blocked', session: 's' });
    expect((await act('Ana', archive, ran())).status).toBe(200);
    expect((await act('Sam', archive, ran())).status).toBe(400);
    expect((await act('edit link', archive, ran())).status).toBe(403);
    expect((await act('Duy', archive, state())).status).toBe(400);
    expect((await act('Sam', [{ ...archive, by: 'Duy' }], ran())).status).toBe(400);
    expect((await act('Duy', [archive, { type: 'actionunarchive', id: 'web' }], ran())).status).toBe(200);
    // Sam neither started it nor is an Admin, so Sam cannot bring it back either
    const archived = { ...ran(), nodes: ran().nodes.filter((n) => n.id !== 'web'), archived: [{ box: ran().nodes[1], edges: [], in: null, by: 'Duy', at: 1 }] };
    expect((await act('Sam', { type: 'actionunarchive', id: 'web' }, archived)).status).toBe(400);
  });
  it('still counts for the Actions that wait on it', async () => {
    const waits = { id: 'later', label: 'Later', x: 900, y: 0, action: { id: 'r2', by: 'Sam', stage: 'waiting', plan: { dependsOn: ['web'] }, waiting: [{ id: 'web' }] } };
    const ran = state(done(state().nodes[1]));
    const { after } = await act('Duy', archive, { ...ran, nodes: [...ran.nodes, waits] });
    const later = /** @type {any} */ (after.nodes.find((/** @type {any} */ n) => n.id === 'later'))?.action;
    expect(later.plan.dependsOn).toEqual(['web']);
    expect(later.stage).toBe('draft');
  });
  it('keeps its id from a new box drawn while it is archived', async () => {
    const ran = state(done(state().nodes[1]));
    const { after } = await act('Duy', [archive, { type: 'add', label: 'Web', x: 0, y: 300 }], ran);
    expect(after.nodes.at(-1)?.id).toBe('web-2');
  });
});

describe('the server\'s rule', () => {
  it('is the page\'s, with an Admin found on the map', () => {
    const map = /** @type {any} */ (state());
    for (const stage of STAGES) for (const by of ['Duy', 'Ana', 'Sam']) {
      const n = { id: 'x', label: 'X', action: { by: 'Duy', stage } };
      const server = leaving(map, /** @type {any} */ (n), by), page = actionLeaving(n.action, by, by === 'Ana');
      expect(page === 'remove' || page === 'archive' ? page : 'no', `${by} ${stage}`).toBe(server === 'remove' || server === 'archive' ? server : 'no');
    }
  });
});
