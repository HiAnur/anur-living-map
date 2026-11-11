import { execFileSync } from 'node:child_process';
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
function jobOn(draw, initial = /** @type {any} */ ({ nodes: [], edges: [] }), /** @type {any} */ gh = undefined, /** @type {any} */ work = undefined) {
  const home = tmp(), state = initial, pushes = /** @type {any[]} */ ([]);
  const job = systemJob({ home, getState: () => state, save: () => {}, push: () => pushes.push(structuredClone(state.drawing)), agent: { answer: async () => ({ ms: 0 }) }, draw, ...(gh ? { github: () => gh } : {}), ...(work ? { work: () => work } : {}) });
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
    expect(JSON.parse(fs.readFileSync(path.join(home, 'system-folders.json'), 'utf8'))).toEqual({ folders: ['/x/api'], repos: [] });
  });
  it('shows each repo of a new map as soon as it is drawn, and leaves a map drawn again as it is until the end', async () => {
    const reading = (/** @type {string} */ repo) => ({ repo, kinds: ['python'], head: null, facts: [{ id: 'f1', kind: 'function', at: 'a.py:1', name: 'Fn' }] });
    const drawn = { boxes: [{ id: 'fn', name: 'Fn', kind: 'function', description: 'Does it', facts: ['f1'] }], lines: [], rejected: [], leftOut: [] };
    /** @type {any[]} */
    const seen = [];
    let release = () => {};
    const draw = async (/** @type {any} */ o) => {
      o.onDrawn(reading('api'), drawn);
      seen.push(state.nodes.map((/** @type {any} */ n) => n.label));
      await new Promise((/** @type {any} */ r) => { release = r; });
      return { state: built, report: report([]), cancelled: false };
    };
    const { state, job } = jobOn(draw);
    job.start({ folders: ['/x/api', '/x/bot'], by: 'Sam' });
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual(['api']);
    expect(state.nodes[0].inside.nodes.map((/** @type {any} */ n) => n.label)).toEqual(['Fn']);
    release();
    await until(() => state.drawing.status === 'done');
    expect(state.nodes).toEqual(built.nodes);
    // drawn again over a map that has boxes: nothing changes until the drawing is done
    seen.length = 0;
    job.retry('Sam');
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual(['api']);
    expect(state.nodes).toEqual(built.nodes);
    release();
    await until(() => state.drawing.status === 'done');
  });
  it('stops when cancelled and leaves the map as it was', async () => {
    const stopped = { state: null, report: report([{ repo: 'api', stage: 'cancelled' }]), cancelled: true };
    const { state, job } = jobOn((/** @type {any} */ o) => new Promise((resolve) => { if (o.signal.aborted) resolve(stopped); o.signal.addEventListener('abort', () => resolve(stopped)); }));
    job.start({ folders: ['/x/api'], by: 'Harshit' });
    expect(job.cancel()).toBe(true);
    await until(() => state.drawing.status === 'cancelled');
    expect(state.nodes).toEqual([]);
    expect(job.cancel()).toBe(false);
  });
  it('draws again reusing each repo already drawn at the same commit', async () => {
    /** @type {any[]} */
    const reused = [];
    const kept = { boxes: [], lines: [] };
    const { state, job } = jobOn(async (/** @type {any} */ o) => {
      // a reading and a drawing shaped as the real ones, so showing the repo on the map as it is drawn works
      const api = { repo: 'api', head: { commit: 'c1' }, kinds: [], facts: [] }, bot = { repo: 'bot', head: { commit: 'c2' }, kinds: [], facts: [] };
      reused.push([o.reuse(api), o.reuse(bot)]);
      o.onDrawn(api, kept);
      return { state: built, report: report([{ repo: 'api', stage: 'done' }, { repo: 'bot', stage: 'failed', error: 'signed out' }]), cancelled: false };
    });
    job.start({ folders: ['/x/api', '/x/bot'], by: 'Harshit' });
    await until(() => state.drawing.status === 'failed');
    // failed because the report says bot failed, not because the drawing crashed
    expect(state.drawing.error).toBeUndefined();
    expect(state.drawing.progress.find((/** @type {any} */ p) => p.repo === 'bot')).toMatchObject({ stage: 'failed', error: 'signed out' });
    expect(job.retry('Harshit')).toBe(true);
    await until(() => reused.length === 2 && state.drawing.status !== 'running');
    expect(state.drawing.error).toBeUndefined();
    expect(reused).toEqual([[null, null], [kept, null]]);
  });
  it('downloads GitHub repos first as whoever asked, and keeps one GitHub would not give on the panel with why', async () => {
    /** @type {any[]} */
    const asked = [];
    const gh = { fetchRepo: async (/** @type {string} */ who, /** @type {any} */ r) => {
      asked.push(`${who}:${r.owner}/${r.name}`);
      if (r.name === 'secret') throw new Error('GitHub said 404 for /repos/Shop/secret.');
      return { folder: `/cache/${r.name}`, commit: 'c1', branch: 'main' };
    } };
    /** @type {string[]} */
    let drawnFrom = [];
    const { state, job } = jobOn(async (/** @type {any} */ o) => {
      drawnFrom = o.folders;
      return { state: built, report: report([{ repo: 'api', stage: 'done', boxes: 2 }]), cancelled: false };
    }, undefined, gh);
    job.start({ folders: ['/x/local'], repos: [{ owner: 'Shop', name: 'api' }, { owner: 'Shop', name: 'secret' }], by: 'Sam' });
    await until(() => state.drawing.status !== 'running');
    expect(asked).toEqual(['Sam:Shop/api', 'Sam:Shop/secret']);
    expect(drawnFrom).toEqual(['/x/local', '/cache/api']);
    expect(state.drawing).toMatchObject({ status: 'failed', repos: 3, progress: [{ repo: 'secret', stage: 'failed', error: 'GitHub said 404 for /repos/Shop/secret.' }, { repo: 'api', stage: 'done' }] });
    expect(state.nodes).toEqual(built.nodes);
  });
  it('hands a side chat the code behind the map that the asker may read, and no more', async () => {
    const folder = (/** @type {string} */ n) => { const d = path.join(tmp(), n); fs.mkdirSync(d); return d; };
    const local = folder('local-svc'), api = folder('api'), secret = folder('secret');
    const gh = { fetchRepo: async (/** @type {string} */ _who, /** @type {any} */ r) => ({ folder: r.name === 'api' ? api : secret, commit: 'c1', branch: 'main' }),
      canRead: async (/** @type {string} */ who, /** @type {string} */ _owner, /** @type {string} */ name) => who === 'Sam' && name === 'api' };
    const { state, job } = jobOn(async () => ({ state: built, report: { ...report([]), repos: [{ repo: 'local-svc', root: local, unread: [] }, { repo: 'api', root: api, unread: [] }, { repo: 'secret', root: secret, unread: [] }] }, cancelled: false }), undefined, gh);
    job.start({ folders: [local], repos: [{ owner: 'Shop', name: 'api' }, { owner: 'Shop', name: 'secret' }], by: 'Harshit' });
    await until(() => state.drawing.status !== 'running');
    // a folder on this Mac only for whoever drew the map; a GitHub repo only if GitHub lets the asker read it
    expect(await job.codeFor('Harshit')).toEqual([{ repo: 'local-svc', folder: local }]);
    expect(await job.codeFor('Sam')).toEqual([{ repo: 'api', folder: api }]);
    expect(await job.codeFor('Guest')).toEqual([]);
  });
  it('works on a repo in a clone on this Mac, for whoever may read it, and on the drawn code when there is no clone and no build', async () => {
    const folder = (/** @type {string} */ n) => { const d = path.join(tmp(), n); fs.mkdirSync(d); return d; };
    const local = folder('local-svc'), api = folder('api'), web = folder('web');
    const gh = { fetchRepo: async (/** @type {string} */ _who, /** @type {any} */ r) => ({ folder: r.name === 'api' ? api : web, commit: 'c1', branch: 'main' }),
      canRead: async (/** @type {string} */ who) => who === 'Sam' };
    const work = { workIn: async (/** @type {string} */ _owner, /** @type {string} */ name, /** @type {boolean} */ build) => name === 'api' ? { cwd: '/clones/api' } : build ? { cwd: '/fresh/web' } : { error: '' } };
    const { state, job } = jobOn(async () => ({ state: built, report: { ...report([]), repos: [{ repo: 'local-svc', root: local, unread: [] }, { repo: 'api', root: api, unread: [] }, { repo: 'web', root: web, unread: [] }] }, cancelled: false }), undefined, gh, work);
    job.start({ folders: [local], repos: [{ owner: 'Shop', name: 'api' }, { owner: 'Shop', name: 'web' }], by: 'Harshit' });
    await until(() => state.drawing.status !== 'running');
    expect(await job.workFor('api', 'Sam', true)).toEqual({ cwd: '/clones/api' });
    expect(await job.workFor('web', 'Sam', false)).toEqual({ cwd: web });
    expect(await job.workFor('web', 'Sam', true)).toEqual({ cwd: '/fresh/web' });
    expect(await job.workFor('api', 'Guest', false)).toEqual({ error: expect.stringContaining('GitHub does not let you read Shop/api') });
    expect(await job.workFor('local-svc', 'Harshit', true)).toEqual({ cwd: local });
    expect(await job.workFor('local-svc', 'Sam', true)).toEqual({ error: expect.stringContaining("only Harshit can run Actions in it") });
    expect(await job.workFor('nowhere', 'Sam', true)).toEqual({ error: 'nowhere is not one of this map\'s repos.' });
  });
  it('hides private repos from someone until GitHub says they may read them, and public ones from no one', async () => {
    const gh = { fetchRepo: async (/** @type {string} */ _who, /** @type {any} */ r) => ({ folder: `/cache/${r.name}`, commit: 'c1', branch: 'main', private: r.name !== 'site' }),
      canRead: async (/** @type {string} */ who, /** @type {string} */ _owner, /** @type {string} */ name) => who === 'Sam' && name === 'api' };
    const { state, job } = jobOn(async () => ({ state: built, report: { ...report([]), repos: [{ repo: 'api', root: '/cache/api', unread: [] }, { repo: 'billing', root: '/cache/billing', unread: [] }, { repo: 'site', root: '/cache/site', unread: [] }] }, cancelled: false }), undefined, gh);
    job.start({ repos: [{ owner: 'Shop', name: 'api' }, { owner: 'Shop', name: 'billing' }, { owner: 'Shop', name: 'site' }], by: 'Sam' });
    await until(() => state.drawing.status !== 'running');
    expect([...job.hiddenFor(null)].sort()).toEqual(['api', 'billing']);
    expect(job.holdsPrivate()).toBe(true);
    let told = 0;
    // until GitHub answers, every private repo stays hidden; then only what Sam may not read, and his page is told
    expect([...job.hiddenFor('Sam', () => told++)].sort()).toEqual(['api', 'billing']);
    await until(() => told === 1);
    expect([...job.hiddenFor('Sam')]).toEqual(['billing']);
  });
  it('says which repos have newer commits than the drawing read, only those the asker may read, and only with their GitHub link', async () => {
    const heads = /** @type {Record<string, string>} */ ({ api: 'c2', billing: 'c2', site: 'c1' });
    const gh = { fetchRepo: async (/** @type {string} */ _who, /** @type {any} */ r) => ({ folder: `/cache/${r.name}`, commit: 'c1', branch: 'main', private: r.name !== 'site' }),
      canRead: async (/** @type {string} */ who, /** @type {string} */ _owner, /** @type {string} */ name) => who === 'Sam' && name !== 'billing',
      status: (/** @type {string} */ who) => ({ linked: who === 'Sam' ? 'sam' : null }),
      headOf: async (/** @type {string} */ _who, /** @type {string} */ _owner, /** @type {string} */ name) => heads[name] };
    const repos = ['api', 'billing', 'site'].map((repo) => ({ repo, root: `/cache/${repo}`, head: { commit: 'c1', branch: 'main' }, unread: [] }));
    const { state, job } = jobOn(async () => ({ state: built, report: { ...report([]), repos }, cancelled: false }), undefined, gh);
    job.start({ repos: ['api', 'billing', 'site'].map((name) => ({ owner: 'Shop', name })), by: 'Sam' });
    await until(() => state.drawing.status !== 'running');
    let told = 0;
    job.hiddenFor('Sam', () => told++);
    await until(() => told === 1);
    // billing changed too, but Sam may not read it; Kim has no GitHub link, so nothing on GitHub is asked for Kim
    expect(await job.changed('Sam')).toEqual(['api']);
    expect(await job.changed('Kim')).toEqual([]);
  });
  it("finds a repo's box from a clone of it on this Mac, by its GitHub origin or the very folder drawn", async () => {
    const folder = (/** @type {string} */ n) => { const d = path.join(tmp(), n); fs.mkdirSync(d); return d; };
    const local = folder('local-svc'), clone = folder('my-api'), other = folder('other');
    execFileSync('git', ['init', '-q', clone]);
    execFileSync('git', ['-C', clone, 'remote', 'add', 'origin', 'git@github.com:shop/API.git']);
    const gh = { fetchRepo: async () => ({ folder: '/cache/api', commit: 'c1', branch: 'main' }) };
    const drawn = { nodes: [{ id: 'system-orders', label: 'Orders', source: { repo: 'api' } }, { id: 'system-svc', label: 'Svc', source: { repo: 'local-svc' } }], edges: [], start: 'system-orders' };
    const { state, job } = jobOn(async () => ({ state: drawn, report: { ...report([]), repos: [{ repo: 'local-svc', root: local, unread: [] }, { repo: 'api', root: '/cache/api', unread: [] }] }, cancelled: false }), undefined, gh);
    job.start({ folders: [local], repos: [{ owner: 'Shop', name: 'api' }], by: 'Harshit' });
    await until(() => state.drawing.status !== 'running');
    expect(job.boxOf(clone)).toBe('system-orders');
    expect(job.boxOf(local)).toBe('system-svc');
    expect(job.boxOf(other)).toBeNull();
  });
  it('holds what a redraw would change for review, and applies it, with what people did since, or keeps the map', async () => {
    const was = { nodes: [{ id: 'system-api', label: 'api', origin: 'code', source: { repo: 'api' } }], edges: [], start: 'system-api' };
    const next = { nodes: [{ id: 'system-api', label: 'API service', origin: 'code', source: { repo: 'api' } }, { id: 'system-jobs', label: 'jobs', origin: 'code', source: { repo: 'jobs' } }], edges: [], start: 'system-api' };
    const { state, job } = jobOn(async () => ({ state: structuredClone(next), report: report([]), cancelled: false }), structuredClone(was));
    job.start({ folders: ['/x/api'], by: 'Sam' });
    await until(() => state.drawing.status === 'done');
    // nothing on the map yet: the changes wait, by repo
    expect(state.nodes).toEqual(was.nodes);
    expect(state.redraw).toMatchObject({ by: 'Sam', count: 2, changes: [{ what: 'changed', label: 'API service', was: 'api', repo: 'api' }, { what: 'added', label: 'jobs', repo: 'jobs' }] });
    // someone adds a box meanwhile: applying keeps it
    state.nodes.push({ id: 'mine', label: 'My note' });
    expect(job.applyRedraw()).toBe(true);
    expect(state.nodes.map((/** @type {any} */ n) => n.label)).toEqual(['API service', 'jobs', 'My note']);
    expect(state.redraw).toBeUndefined();
    expect(job.applyRedraw()).toBe(false);
    // drawn again and dropped: the map stays as it is
    const kept = structuredClone(state.nodes);
    next.nodes[0].label = 'API';
    job.retry('Sam');
    await until(() => state.drawing.status === 'done' && !!state.redraw);
    expect(job.dropRedraw()).toBe(true);
    expect(state.nodes).toEqual(kept);
  });
  it('notices new commits by itself, as whoever drew the map, and keeps them in the drawing', async () => {
    const heads = /** @type {Record<string, string>} */ ({ api: 'c2', site: 'c1' });
    const gh = { fetchRepo: async (/** @type {string} */ _who, /** @type {any} */ r) => ({ folder: `/cache/${r.name}`, commit: 'c1', branch: 'main', private: false }),
      canRead: async () => true, status: () => ({ linked: 'sam' }), headOf: async (/** @type {string} */ _who, /** @type {string} */ _owner, /** @type {string} */ name) => heads[name] };
    const repos = ['api', 'site'].map((repo) => ({ repo, root: `/cache/${repo}`, head: { commit: 'c1', branch: 'main' }, unread: [] }));
    const { state, job, pushes } = jobOn(async () => ({ state: built, report: { ...report([]), repos }, cancelled: false }), undefined, gh);
    job.start({ repos: ['api', 'site'].map((name) => ({ owner: 'Shop', name })), by: 'Sam' });
    await until(() => state.drawing.status === 'done');
    const told = pushes.length;
    const stop = job.watch(20);
    await until(() => (state.drawing.newCommits || []).length === 1);
    stop();
    expect(state.drawing.newCommits).toEqual(['api']);
    expect(pushes.length).toBeGreaterThan(told);
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
  /** @type {any} */
  const linkedAs = { who: '' };
  const gh = /** @type {any} */ ({ status: (/** @type {string} */ who) => ({ linked: who === linkedAs.who ? 'octo' : null, pending: null }) });
  const routes = systemRoutes({ maps, home, github: () => gh });
  /** @param {string} route @param {any} [data] @param {{ who?: string, local?: boolean }} [o] */
  const call = async (route, data, { who = 'Harshit', local = true } = {}) => {
    const headers = local ? { host: 'localhost:4323', origin: 'http://localhost:4323', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : { host: 'living-map.example.com', origin: 'https://evil.example' };
    const req = Object.assign(Readable.from(data ? [JSON.stringify(data)] : []), { method: data ? 'POST' : 'GET', headers });
    let result;
    await routes(req, {}, new URL(`http://localhost${route}`), who, (/** @type {number} */ status, /** @type {any} */ body) => { result = { status, body }; return true; });
    return /** @type {any} */ (result);
  };
  it('answers only someone signed in on a page this Mac serves', async () => {
    expect((await call('/api/systemmap/github', undefined, { who: '' })).status).toBe(401);
    expect((await call('/api/systemmap/github', undefined, { local: false })).status).toBe(403);
    expect((await call('/api/systemmap/repos')).status).toBe(404);
  });
  it('says who you are on GitHub, and draws from GitHub only once you have linked it, with names GitHub could have', async () => {
    expect((await call('/api/systemmap/github')).body).toEqual({ linked: null, pending: null });
    expect((await call('/api/systemmap/github', undefined, { local: false })).status).toBe(403);
    expect((await call('/api/systemmap', { repos: [{ owner: 'Shop', name: 'api' }] })).status).toBe(401);
    linkedAs.who = 'Harshit';
    expect((await call('/api/systemmap/github')).body).toEqual({ linked: 'octo', pending: null });
    expect((await call('/api/systemmap', { repos: [{ owner: 'Shop', name: '../etc' }] })).status).toBe(400);
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
    // the list of maps says how many repos it was drawn from and when
    expect(map.summary()).toMatchObject({ system: 'done', repos: 2, drawn: expect.any(Number) });
    expect((await call('/api/systemmap/cancel', { name: 'shop-system' })).status).toBe(409);
    expect((await call('/api/systemmap/retry', { name: 'shop-system' }, { who: 'Sam' })).status).toBe(403);
    expect((await call('/api/systemmap/retry', { name: 'shop-system' })).status).toBe(200);
    await until(() => map.snapshot().drawing?.status === 'done');
    expect((await call('/api/systemmap/retry', { name: 'nowhere' })).status).toBe(404);
  });
});
