import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { agent } from './agent.js';
import { mapList } from './map-list.js';
import { openMap } from './server.js';
import { systemJob } from './system-job.js';
import { systemRoutes } from './system-routes.js';
import { api, app } from './system.harness.js';

// Drawing a system map in the background for one map, and the routes that start, stop and retry it. The drawing
// itself is a stand-in here (system-draw.test.js tests it); this is about where its progress goes.

const dirs = /** @type {string[]} */ ([]);
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-sysjob-')); dirs.push(d); return d; };
const until = async (/** @type {() => boolean} */ ok) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); expect(ok()).toBe(true); };

/** A map's state and a job on it, with a scripted drawing. @param {any} draw */
function jobOn(draw, initial = /** @type {any} */ ({ nodes: [], edges: [] })) {
  const home = tmp(), state = initial, pushes = /** @type {any[]} */ ([]);
  const job = systemJob({ home, getState: () => state, save: () => {}, push: () => pushes.push(structuredClone(state.drawing)), agent: { answer: async () => ({ ms: 0 }) }, draw });
  return { home, state, pushes, job };
}
const built = { nodes: [{ id: 'system-api', label: 'api' }], edges: [], start: 'system-api' };
const report = (/** @type {any[]} */ progress) => ({ repos: [{ repo: 'api', unread: [] }, { repo: 'ts', unread: ['run `npx cdk synth`'] }], rejected: [{ item: 'x' }], leftOut: 3, costs: [{ value: 0.2, unit: 'usd' }, { value: 0.1, unit: 'usd' }], ms: 9, progress });

describe('a system map drawing in the background', () => {
  it('shows each repo\'s stage live, builds the map when done, and keeps where the code sits out of the map', async () => {
    const { home, state, pushes, job } = jobOn(async (/** @type {any} */ o) => {
      o.onProgress({ repo: 'api', stage: 'drawing' });
      o.onProgress({ repo: 'api', stage: 'done', boxes: 4 });
      return { state: built, report: report([{ repo: 'api', stage: 'done', boxes: 4 }]), cancelled: false };
    });
    expect(job.start({ folders: ['/x/api'], by: 'Harshit' })).toBe(true);
    expect(job.start({ folders: ['/x/api'], by: 'Harshit' })).toBe(false);
    await until(() => state.drawing.status === 'done');
    expect(pushes.map((d) => d.progress.map((/** @type {any} */ p) => p.stage).join())).toEqual(['', 'drawing', 'done', 'done']);
    expect(state.nodes).toEqual(built.nodes);
    expect(state.drawing).toMatchObject({ by: 'Harshit', repos: 1, rejected: 1, leftOut: 3, cost: { value: 0.30000000000000004 }, unread: [{ repo: 'ts', why: 'run `npx cdk synth`' }] });
    expect(JSON.stringify(state)).not.toContain('/x/api');
    expect(JSON.parse(fs.readFileSync(path.join(home, 'system-folders.json'), 'utf8'))).toEqual(['/x/api']);
  });
  it('stops when cancelled and leaves the map as it was', async () => {
    const { state, job } = jobOn((/** @type {any} */ o) => new Promise((resolve) => o.signal.addEventListener('abort', () => resolve({ state: null, report: report([{ repo: 'api', stage: 'cancelled' }]), cancelled: true }))));
    job.start({ folders: ['/x/api'], by: 'Harshit' });
    expect(job.cancel()).toBe(true);
    await until(() => state.drawing.status === 'cancelled');
    expect(state.nodes).toEqual([]);
    expect(job.cancel()).toBe(false);
  });
  it('draws again reusing each repo already drawn at the same commit', async () => {
    /** @type {any[]} */
    const reused = [];
    const { state, job } = jobOn(async (/** @type {any} */ o) => {
      const api = { repo: 'api', head: { commit: 'c1' } }, bot = { repo: 'bot', head: { commit: 'c2' } };
      reused.push([o.reuse(api), o.reuse(bot)]);
      o.onDrawn(api, { boxes: ['kept'] });
      return { state: built, report: report([{ repo: 'api', stage: 'done' }, { repo: 'bot', stage: 'failed', error: 'signed out' }]), cancelled: false };
    });
    job.start({ folders: ['/x/api', '/x/bot'], by: 'Harshit' });
    await until(() => state.drawing.status === 'failed');
    expect(job.retry('Harshit')).toBe(true);
    await until(() => reused.length === 2 && state.drawing.status !== 'running');
    expect(reused).toEqual([[null, null], [{ boxes: ['kept'] }, null]]);
  });
  it('shows a drawing the server stopped in the middle of as stopped, ready to draw again', () => {
    const { state } = jobOn(async () => ({}), { nodes: [], edges: [], drawing: { status: 'running', progress: [{ repo: 'api', stage: 'drawing' }, { repo: 'bot', stage: 'done' }] } });
    expect(state.drawing).toMatchObject({ status: 'stopped', progress: [{ stage: 'cancelled' }, { stage: 'done' }] });
  });
});

describe('the system map routes', () => {
  const home = tmp(), DIR = tmp();
  const work = path.join(home, 'workspace');
  const repoAt = (/** @type {string} */ made) => { const to = path.join(work, path.basename(made)); fs.mkdirSync(work, { recursive: true }); fs.cpSync(made, to, { recursive: true }); fs.mkdirSync(path.join(to, '.git')); return to; };
  const folders = [repoAt(app()), repoAt(api())];
  fs.mkdirSync(path.join(work, 'notes'));
  const maps = mapList({ openMap, DIR, PROJECT: '', PROJECTS: path.join(DIR, 'projects.json'), mapName: path.basename, demo: () => ({ people: [] }) });
  const routes = systemRoutes({ maps, PROJECT: '', home });
  /** @param {string} route @param {any} [data] @param {{ who?: string, local?: boolean }} [o] */
  const call = async (route, data, { who = 'Harshit', local = true } = {}) => {
    const headers = local ? { host: 'localhost:4323', origin: 'http://localhost:4323', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : { host: 'living-map.example.com', origin: 'https://evil.example' };
    const req = Object.assign(Readable.from(data ? [JSON.stringify(data)] : []), { method: data ? 'POST' : 'GET', headers });
    let result;
    await routes(req, {}, new URL(`http://localhost${route}`), who, (/** @type {number} */ status, /** @type {any} */ body) => { result = { status, body }; return true; });
    return /** @type {any} */ (result);
  };
  it('lists the repos in a folder, only to someone signed in on this Mac', async () => {
    expect((await call('/api/systemmap/repos', undefined, { who: '' })).status).toBe(401);
    expect((await call('/api/systemmap/repos', undefined, { local: false })).status).toBe(403);
    expect((await call('/api/systemmap/repos?under=/etc')).status).toBe(400);
    const r = await call('/api/systemmap/repos');
    expect(r.body).toEqual({ under: work, repos: [{ name: 'api-service', folder: folders[1] }, { name: 'mobile-app', folder: folders[0] }] });
  });
  it('draws a new map from the repos chosen, and lets whoever started it stop or retry it', async () => {
    vi.spyOn(agent, 'answer').mockImplementation(async () => ({ value: { boxes: [], lines: [] }, cost: { value: 0.01, unit: 'usd' }, ms: 1 }));
    expect((await call('/api/systemmap', { folders: ['/etc'] })).status).toBe(400);
    expect((await call('/api/systemmap', { folders: [path.join(work, 'notes')] })).status).toBe(400);
    const started = await call('/api/systemmap', { title: 'Shop system', folders });
    expect(started).toEqual({ status: 200, body: { name: 'shop-system', href: '/shop-system/' } });
    const map = maps.mapCalled('shop-system');
    await until(() => map.snapshot().drawing?.status === 'done');
    expect(map.snapshot()).toMatchObject({ title: 'Shop system', drawing: { by: 'Harshit', repos: 2 } });
    expect((await call('/api/systemmap/cancel', { name: 'shop-system' })).status).toBe(409);
    expect((await call('/api/systemmap/retry', { name: 'shop-system' }, { who: 'Sam' })).status).toBe(403);
    expect((await call('/api/systemmap/retry', { name: 'shop-system' })).status).toBe(200);
    await until(() => map.snapshot().drawing?.status === 'done');
    expect((await call('/api/systemmap/retry', { name: 'nowhere' })).status).toBe(404);
  });
});
