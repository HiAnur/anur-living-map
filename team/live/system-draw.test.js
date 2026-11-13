import { describe, expect, it } from 'vitest';

import { allBoxesOf } from './map-walk.js';
import { evidence } from './system-build.js';
import { compact, drawSystem } from './system-draw.js';
import { api, app, repo, trading } from './system.harness.js';

// Drawing a system map end to end on made-up repos, with a scripted agent standing in for the model: code reads and
// links the facts, the agent's answers are checked, and the map is built with its levels and evidence.

/** The facts a prompt hands the agent, parsed back. @param {string} prompt @returns {any[]} */
const factsIn = (prompt) => prompt.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

/** A stand-in agent: draws each repo from the facts it is given, with one made-up citation and one line its facts do not show. */
const agent = {
  /** @param {{ prompt: string }} job */
  async answer({ prompt }) {
    const facts = factsIn(prompt);
    const id = (/** @type {(f: any) => boolean} */ test) => facts.find(test)?.id;
    if (prompt.includes('This is the platform map')) {
      const link = (/** @type {string} */ from, /** @type {string} */ to) => facts.filter((f) => f.fromRepo === from && f.toRepo === to).map((f) => f.id);
      return { value: {
        boxes: ['mobile-app', 'api-service', 'trading-service'].map((r) => ({ id: r, name: r, kind: 'library', description: `The ${r}`, facts: [`repo:${r}`], repo: r })),
        lines: [
          { from: 'mobile-app', to: 'api-service', label: 'calls routes', facts: link('mobile-app', 'api-service') },
          { from: 'api-service', to: 'trading-service', label: 'routes trades', facts: link('api-service', 'trading-service') },
          // no link joins these two the other way round
          { from: 'mobile-app', to: 'trading-service', label: 'trades', facts: link('mobile-app', 'api-service') },
        ] }, cost: { value: 0.05, unit: 'usd' }, ms: 5 };
    }
    if (prompt.includes('The repo is api-service')) {
      return { value: {
        boxes: [
          { id: 'users', name: 'Users API', kind: 'function', description: 'Serves users and orders', facts: [id((f) => f.name === 'GetUser'), id((f) => f.name === 'ListOrders'), id((f) => f.kind === 'table')] },
          { id: 'store', name: 'Users table', kind: 'store', description: 'Users by id', facts: [id((f) => f.kind === 'table')] },
          { id: 'ghost', name: 'Ghost', kind: 'function', description: 'Made up', facts: ['f999'] },
        ],
        lines: [{ from: 'users', to: 'store', label: 'reads', facts: [id((f) => f.name === 'GetUser')] }] }, cost: { value: 0.1, unit: 'usd' }, ms: 5 };
    }
    if (prompt.includes('The repo is trading-service')) {
      return { value: { boxes: [
        { id: 'trade', name: 'Trade function', kind: 'function', description: 'Places trades', facts: [id((f) => f.kind === 'construct')] },
        { id: 'chat', name: 'Trading stack', kind: 'person', description: 'Only a description says so', facts: [id((f) => f.kind === 'module' && String(f.module).includes('trading'))] },
      ], lines: [] }, cost: { value: 0.1, unit: 'usd' }, ms: 5 };
    }
    return { value: { boxes: [{ id: 'home', name: 'Home screen', kind: 'screen', description: 'Home', facts: [id((f) => f.kind === 'screens')] }], lines: [] }, cost: { value: 0.1, unit: 'usd' }, ms: 5 };
  },
};

describe('drawing a system map', () => {
  it('builds the platform, each repo inside its box, and each box\'s components inside it', async () => {
    const { state } = await drawSystem({ folders: [app(), api(), trading()], agent });
    expect(state?.nodes.map((n) => n.label)).toEqual(['mobile-app', 'api-service', 'trading-service']);
    const apiBox = state?.nodes.find((n) => n.label === 'api-service');
    expect(apiBox?.inside?.nodes.map((n) => n.label)).toEqual(['Users API', 'Users table']);
    // the Users API box opens into its components, built by code from its facts: no model
    const usersApi = apiBox?.inside?.nodes.find((n) => n.label === 'Users API');
    expect(usersApi?.inside?.nodes.map((n) => n.label)).toEqual(['GetUser', 'ListOrders', 'users-table']);
    expect(usersApi?.inside?.edges).toEqual([expect.objectContaining({ label: 'dynamodb' })]);
    expect(allBoxesOf(state).length).toBe(3 + 2 + 3 + 1 + 1 + 1);
  });
  it('keeps each box\'s evidence and where it came from', async () => {
    const { state } = await drawSystem({ folders: [api()], agent });
    const users = allBoxesOf(state).find((n) => n.label === 'Users API');
    expect(users?.desc).toContain('function: GetUser (cdk.out/Api.template.json#UsersFnAB12CD34)');
    expect(users?.source).toMatchObject({ kind: 'code', repo: 'api-service' });
    expect(users?.origin).toBe('code');
  });
  it('links a box\'s evidence to the file and line on GitHub, at the commit it was drawn from, but not compiled output', () => {
    const reading = /** @type {any} */ ({ repo: 'api', github: { owner: 'Shop', name: 'api' }, head: { commit: 'abc123', branch: 'main' } });
    expect(evidence({ id: 'f1', kind: 'aws_call', at: 'src/users/get user.py:41', call: 'get_item' }, reading))
      .toBe('- aws call: aws_call ([src/users/get user.py:41](https://github.com/Shop/api/blob/abc123/src/users/get%20user.py#L41))');
    expect(evidence({ id: 'f2', kind: 'function', at: 'cdk.out/Api.template.json#UsersFn', name: 'GetUser' }, reading)).toBe('- function: GetUser (cdk.out/Api.template.json#UsersFn)');
    expect(evidence({ id: 'f3', kind: 'function', at: 'stacks/api.ts:12#Users', name: 'GetUser' }, reading)).toContain('(https://github.com/Shop/api/blob/abc123/stacks/api.ts#L12)');
    expect(evidence({ id: 'f4', kind: 'module', at: 'a.py:1', module: 'a.py' })).toBe('- module: a.py (a.py:1)');
  });
  it('rejects a made-up citation and a line its facts do not show, and says so', async () => {
    const { state, report } = await drawSystem({ folders: [app(), api(), trading()], agent });
    expect(allBoxesOf(state).some((n) => n.label === 'Ghost')).toBe(false);
    expect(report.rejected).toEqual(expect.arrayContaining([
      { repo: 'api-service', item: 'box "Ghost"', why: 'cites facts that do not exist: f999' },
      { repo: 'platform', item: 'line mobile-app → trading-service', why: 'its facts do not show both of its ends' },
    ]));
    expect(state?.edges.map((e) => e.label)).toEqual(['calls routes', 'routes trades']);
  });
  it('marks what only descriptions show, with a warning on the map', async () => {
    const { state } = await drawSystem({ folders: [trading()], agent });
    expect(allBoxesOf(state).find((n) => n.label === 'Trading stack')?.warn).toMatch(/^Unconfirmed/);
  });
  it('reports each repo\'s stage as it goes, and what it cost', async () => {
    /** @type {string[]} */
    const seen = [];
    const { report } = await drawSystem({ folders: [api()], agent, onProgress: (p) => seen.push(`${p.repo}:${p.stage}`) });
    expect(seen).toEqual(['api-service:reading', 'api-service:waiting', 'api-service:drawing', 'api-service:checking', 'api-service:done', 'platform:drawing', 'platform:done']);
    expect(report.costs.reduce((n, c) => n + c.value, 0)).toBeCloseTo(0.15);
    expect(report.repos[0]).toMatchObject({ repo: 'api-service', kinds: ['cloudformation'] });
  });
  it('says why a repo failed, and still draws the rest', async () => {
    const failing = { answer: async (/** @type {{ prompt: string }} */ job) => job.prompt.includes('api-service') && !job.prompt.includes('platform map') ? { error: 'Claude Code is signed out.', ms: 1 } : agent.answer(job) };
    const { state, report } = await drawSystem({ folders: [app(), api()], agent: failing });
    expect(report.progress.find((p) => p.repo === 'api-service')).toMatchObject({ stage: 'failed', error: 'Claude Code is signed out.' });
    expect(state?.nodes.map((n) => n.label)).toEqual(['mobile-app']);
  });
});

describe('stopping and drawing again', () => {
  it('stops when cancelled: the agent is stopped, nothing is built, and every unfinished repo says so', async () => {
    const stop = new AbortController();
    const slow = { answer: (/** @type {{ signal?: AbortSignal }} */ job) => new Promise((resolve) => {
      if (job.signal?.aborted) resolve({ stopped: true, ms: 1 });
      job.signal?.addEventListener('abort', () => resolve({ stopped: true, ms: 1 }));
    }) };
    const result = drawSystem({ folders: [app(), api()], agent: slow, signal: stop.signal,
      onProgress: (p) => { if (p.stage === 'drawing') stop.abort(); } });
    const { state, report, cancelled } = await result;
    expect(cancelled).toBe(true);
    expect(state).toBeNull();
    expect(report.progress.map((p) => p.stage)).toEqual(['cancelled', 'cancelled']);
  });
  it('reuses a repo\'s earlier drawing when asked, and asks the agent only about the rest', async () => {
    /** @type {string[]} */
    const asked = [];
    const counting = { answer: (/** @type {{ prompt: string }} */ job) => { asked.push(job.prompt.includes('platform map') ? 'platform' : /The repo is ([\w-]+)/.exec(job.prompt)?.[1] || ''); return agent.answer(job); } };
    /** @type {Map<string, any>} */
    const kept = new Map();
    await drawSystem({ folders: [app(), api()], agent: counting, onDrawn: (r, d) => kept.set(r.repo, d) });
    asked.length = 0;
    const { state, report } = await drawSystem({ folders: [app(), api()], agent: counting, reuse: (r) => r.repo === 'api-service' ? kept.get(r.repo) : null });
    expect(asked).toEqual(['mobile-app', 'platform']);
    expect(report.progress.find((p) => p.repo === 'api-service')).toMatchObject({ stage: 'done', reused: true });
    expect(state?.nodes.find((n) => n.label === 'api-service')?.inside?.nodes.map((n) => n.label)).toEqual(['Users API', 'Users table']);
  });
  it('keeps every box the box it was when the agent draws it again under other ids', async () => {
    /** @type {Map<string, any>} */
    const kept = new Map();
    const first = await drawSystem({ folders: [app(), api()], agent, onDrawn: (r, d) => kept.set(r.repo, d) });
    // the same drawings, every id changed: a repo's box by another word, a box's id with its punctuation gone or a new word
    const other = (/** @type {string} */ id) => ({ 'mobile-app': 'app', 'api-service': 'repo', users: 'usersapi', store: 'table', home: 'home-screen' })[id] || id;
    /** @type {string[]} */
    const prompts = [];
    const renaming = { answer: async (/** @type {{ prompt: string }} */ job) => {
      prompts.push(job.prompt);
      const a = await agent.answer(job);
      return { ...a, value: { boxes: a.value.boxes.map((/** @type {any} */ b) => ({ ...b, id: other(b.id) })), lines: a.value.lines.map((/** @type {any} */ l) => ({ ...l, from: other(l.from), to: other(l.to) })) } };
    } };
    const platform = (first.state?.nodes || []).map((n) => ({ id: n.id.slice(7), name: n.label, repo: /** @type {any} */ (n).source?.repo }));
    const again = await drawSystem({ folders: [app(), api()], agent: renaming, before: (repo) => repo === null ? platform : kept.get(repo)?.boxes || null });
    const ids = (/** @type {any} */ state) => allBoxesOf(state).map((/** @type {any} */ n) => n.id);
    expect(ids(again.state)).toEqual(ids(first.state));
    expect(again.state?.edges).toEqual(first.state?.edges);
    expect(again.state?.nodes.find((n) => n.label === 'api-service')?.inside?.edges).toEqual(first.state?.nodes.find((n) => n.label === 'api-service')?.inside?.edges);
    // the agent is told what was drawn before, for the repo it draws and for the platform
    expect(prompts.find((p) => p.includes('The repo is api-service'))).toContain('users (Users API); store (Users table)');
    expect(prompts.find((p) => p.includes('platform map'))).toContain('mobile-app (mobile-app); api-service (api-service)');
  });
});

describe('a repo with nothing to read', () => {
  it('fails at once with why, rather than waiting for ever', async () => {
    const { report } = await drawSystem({ folders: [repo('empty', { 'README.md': '# nothing here\n' })], agent });
    expect(report.progress[0]).toMatchObject({ repo: 'empty', stage: 'failed', error: 'Code found nothing it can read in this repo.' });
  });
});

describe('compact', () => {
  it('keeps the most structural facts first within its size, and says when it cut', () => {
    const facts = [{ id: 'f1', kind: 'import', at: 'a', imports: 'x' }, { id: 'f2', kind: 'function', at: 'b', name: 'Fn' }];
    expect(compact(facts).facts.map((l) => JSON.parse(l).id)).toEqual(['f2', 'f1']);
    expect(compact(facts, 50)).toEqual({ facts: ['{"id":"f2","kind":"function","name":"Fn"}'], cut: true });
  });
});
