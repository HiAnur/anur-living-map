import { describe, expect, it } from 'vitest';

import { allBoxesOf } from './map-walk.js';
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
        { id: 'chat', name: 'Chat users', kind: 'person', description: 'Only a description says so', facts: [id((f) => f.kind === 'module')] },
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
    expect(allBoxesOf(state).find((n) => n.label === 'Chat users')?.warn).toMatch(/^Unconfirmed/);
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
