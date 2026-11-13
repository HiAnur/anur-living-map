import { afterEach, describe, expect, it, vi } from 'vitest';

import { AT_ONCE, checkItem, firstPerson, ownerOf, PER_PASS, PER_SOURCE, quotedIn, taskFrom, TEAM } from './action-items.js';

// Action drafts from someone's own words: the one check that decides each item Claude proposes, and the map making,
// preparing, refusing and handing on drafts, with the agent scripted so nothing reaches Claude.
const jobs = vi.hoisted(() => /** @type {{ kind: string, job: any, stopped: boolean }[]} */ ([]));
vi.mock('./agent.js', async (importOriginal) => {
  const real = /** @type {any} */ (await importOriginal());
  const job = (/** @type {string} */ kind) => (/** @type {any} */ j) => { const rec = { kind, job: j, stopped: false }; jobs.push(rec); return () => { rec.stopped = true; }; };
  return { ...real, agent: { ...real.agent, name: 'Scripted', ask: job('ask'), prepare: job('prepare'), run: job('run'), converse: job('converse'), reach: () => 'reads' } };
});
const { openTestMap, send } = await import('./map.harness.js');

afterEach(() => { jobs.length = 0; });

const task = (more = {}) => ({ goal: 'Send Dan the pricing', result: 'Dan has the pricing sheet', inputs: ['The pricing sheet'], steps: ['Email Dan the sheet'], evidence: ['The sent email'], ...more });
const mine = { kind: /** @type {const} */ ('chat'), id: 'chat:s1:2026-11-13', who: 'Duy', lines: ['Sounds good. I\'ll send Dan the pricing by Thursday.', 'Let me check the contract tomorrow.'] };
const map = (more = {}) => ({ people: ['Ana', 'Duy', 'Priya'], refused: [], boxes: [], canPlace: () => true, made: { pass: 0, source: 0 }, ...more });
const item = (more = {}) => ({ quote: 'I\'ll send Dan the pricing by Thursday', title: 'Send Dan the pricing', under: 'sales', task: task(), ...more });

describe('the check of one item', () => {
  it('makes a draft for the speaker from their own words, needing information and waiting on nothing', () => {
    const r = /** @type {any} */ (checkItem(item({ task: task({ readiness: 'ready', dependsOn: ['other-box'] }) }), mine, map()));
    expect(r.make).toMatchObject({ title: 'Send Dan the pricing', under: 'sales', for: '', quote: 'I\'ll send Dan the pricing by Thursday' });
    expect(r.make.task).toMatchObject({ readiness: 'needs_information', dependsOn: [] });
  });
  it('refuses a quote that is not in the speaker\'s own words', () => {
    expect(checkItem(item({ quote: 'I will wire the money today' }), mine, map())).toEqual({ refused: 'The quote is not in Duy\'s own words here.' });
    expect(checkItem(item({ quote: 'I\'ll send Dan the pricing' }), { ...mine, lines: [] }, map())).toHaveProperty('refused');
  });
  it('holds typed words exactly and speech loosely', () => {
    const misheard = 'I\'ll send Dan the pricing on Thursday';
    expect(quotedIn(misheard, mine.lines, false)).toBe(false);
    expect(quotedIn(misheard, mine.lines, true)).toBe(true);
    expect(quotedIn('I\'ll send Bob the contract on Monday', mine.lines, true)).toBe(false);
    // curly quotes and spacing are not differences
    expect(quotedIn('I’ll  send Dan the pricing', mine.lines, false)).toBe(true);
  });
  it('refuses a draft whose words do not say the speaker will do it, and logs why', () => {
    const said = { ...mine, lines: ['Dan will send the pricing by Thursday.'] };
    expect(checkItem(item({ quote: 'Dan will send the pricing by Thursday' }), said, map())).toEqual({ refused: expect.stringMatching(/does not say the speaker will do it/) });
    for (const words of ['I\'ll do it', 'I will', 'let me look', 'that one is on me', 'leave it with me', 'I\'m going to try']) expect(firstPerson(words), words).toBe(true);
    for (const words of ['we should look into pricing', 'Dan will send it', 'I won\'t']) expect(firstPerson(words), words).toBe(false);
  });
  it('makes an info box for someone else Claude names as its owner, never a draft for them', () => {
    const said = { ...mine, lines: ['Priya will check the contract.'] };
    const r = /** @type {any} */ (checkItem(item({ quote: 'Priya will check the contract', title: 'Check the contract', owner: 'priya' }), said, map()));
    expect(r.make.for).toBe('Priya');
    expect(ownerOf('the team', 'Duy', ['Duy'])).toBe(TEAM);
    expect(ownerOf('Me', 'Duy', ['Duy'])).toBe('');
    expect(ownerOf('duy', 'Duy', ['Duy'])).toBe('');
    expect(ownerOf('Sam from sales', 'Duy', ['Duy'])).toBe('Sam from sales');
  });
  it('refuses a task that is not a clear commitment, and drops blockers that name no one', () => {
    expect(checkItem(item({ task: { goal: 'Look into pricing' } }), mine, map())).toEqual({ refused: expect.stringMatching(/goal, a result/) });
    expect(taskFrom(task({ blockers: [{ detail: 'Needs sign-off', resolver: '' }, { detail: 'Needs the sheet', resolver: 'Ana' }] }))?.blockers).toEqual([{ detail: 'Needs the sheet', resolver: 'Ana' }]);
  });
  it('refuses what was said not to be an action before', () => {
    const refused = [{ quote: '"I\'ll send Dan the pricing by Thursday."', title: 'Something else', by: 'Ana', at: 1 }];
    expect(checkItem(item(), mine, map({ refused }))).toEqual({ refused: expect.stringMatching(/not to be an action/) });
    // the same task in other words, refused by the same person
    expect(checkItem(item({ quote: 'Let me check the contract tomorrow', title: 'Check contract' }), mine, map({ refused: [{ quote: 'x', title: 'Check the contract', by: 'Duy', at: 1 }] }))).toHaveProperty('refused');
  });
  it('merges a second, similarly worded item into the first', () => {
    const had = { id: 'pricing', label: 'Email Dan the pricing' };
    expect(checkItem(item(), mine, map({ boxes: [had] }))).toEqual({ merge: had, quote: 'I\'ll send Dan the pricing by Thursday' });
  });
  it('puts it under a box the speaker can use, else nowhere Claude named', () => {
    expect(/** @type {any} */ (checkItem(item(), mine, map({ canPlace: () => false }))).make.under).toBeNull();
  });
  it('makes at most 5 a pass and 20 from one source', () => {
    expect(checkItem(item(), mine, map({ made: { pass: PER_PASS, source: 0 } }))).toEqual({ refused: 'Over the limit of 5 a pass.' });
    expect(checkItem(item(), mine, map({ made: { pass: 0, source: PER_SOURCE } }))).toEqual({ refused: 'Over the limit of 20 from one chat.' });
  });
});

const state = () => ({
  title: 'Launch', start: 'root', linkSharing: { mode: 'restricted' },
  people: [{ id: 'Ana', role: 'Admin', sees: 'all' }, { id: 'Duy', sees: 'all' }, { id: 'Priya', sees: 'all' }, { id: 'Sam', sees: 'web' }],
  nodes: [{ id: 'root', label: 'Launch', x: 0, y: 0 }, { id: 'sales', label: 'Sales', x: 300, y: 0 }, { id: 'web', label: 'Web', x: 300, y: 200, area: 'web' }],
  edges: [{ from: 'root', to: 'sales' }, { from: 'root', to: 'web' }], calls: [], threads: {}, log: [],
});
const brief = { kind: 'other', goal: 'Send Dan the pricing', target: 'Dan', result: 'Dan has it', steps: ['Send it'], tools: [] };
const tick = () => new Promise((r) => setTimeout(r, 0));
/** the map with Duy's chat already said */
const opened = () => openTestMap(state(), 'items');
const boxOf = (/** @type {any} */ m, /** @type {string} */ id) => m.snapshot().nodes.find((/** @type {any} */ n) => n.id === id);

describe('drafts the map makes from your words', () => {
  it('makes a draft you author, prepares it as you, and stops at Ready: nothing runs, Run on its own stays off', async () => {
    const { map: m, close } = opened();
    const [out] = m.fromWords(mine, [item()]);
    expect(out).toEqual({ title: 'Send Dan the pricing', made: 'send-dan-the-pricing' });
    await tick();
    expect(jobs.filter((j) => j.kind === 'prepare')).toHaveLength(1);
    let a = boxOf(m, 'send-dan-the-pricing').action;
    expect(a).toMatchObject({ by: 'Duy', stage: 'gathering', plan: { readiness: 'needs_information', dependsOn: [] }, from: { kind: 'chat', quote: 'I\'ll send Dan the pricing by Thursday' } });
    expect(a.auto).toBeUndefined();
    expect(a.events.map((/** @type {any} */ e) => [e.what, e.by, e.auto])).toEqual([['created', 'Duy', undefined], ['preparing', 'Map', 'words']]);
    jobs[0].job.onDone('', { tools: [], denied: [] }, { status: 'ready', brief });
    a = boxOf(m, 'send-dan-the-pricing').action;
    expect(a.stage).toBe('ready');
    expect(a.auto).toBeUndefined();
    await tick();
    expect(jobs.filter((j) => j.kind === 'run')).toHaveLength(0);
    // the draft hangs under the box Claude named, and the log says why it was made
    expect(m.snapshot().edges).toContainEqual({ from: 'sales', to: 'send-dan-the-pricing' });
    expect(m.snapshot().log.map((/** @type {any} */ l) => l.result)).toEqual(['made', 'prepared']);
    close();
  });
  it('prepares at most 3 of a person\'s drafts at once, and the next when one finishes', async () => {
    const { map: m, close } = opened();
    const words = ['send Dan the pricing', 'book the venue', 'draft the launch post', 'call the printer', 'order the swag'];
    const said = { ...mine, lines: words.map((w) => `I'll ${w}.`) };
    const out = m.fromWords(said, words.map((w) => item({ quote: `I'll ${w}`, title: w[0].toUpperCase() + w.slice(1), task: task({ goal: w }) })));
    expect(out.every((/** @type {any} */ o) => o.made)).toBe(true);
    await tick();
    expect(jobs.filter((j) => j.kind === 'prepare')).toHaveLength(AT_ONCE);
    const stages = () => m.snapshot().nodes.filter((/** @type {any} */ n) => n.action).map((/** @type {any} */ n) => n.action.stage);
    expect(stages().sort()).toEqual(['draft', 'draft', 'gathering', 'gathering', 'gathering']);
    jobs[0].job.onDone('', undefined, { status: 'clarify', question: 'Which Dan?', choices: [] });
    await tick();
    expect(jobs.filter((j) => j.kind === 'prepare')).toHaveLength(AT_ONCE + 1);
    close();
  });
  it('makes nothing for someone who is not on the map, nor beyond 5 a pass', () => {
    const { map: m, close } = opened();
    expect(m.fromWords({ ...mine, who: 'Mallory' }, [item()])).toEqual([{ title: 'Send Dan the pricing', refused: 'Mallory is not someone on this map.' }]);
    const words = ['book the venue', 'draft the post', 'call the printer', 'order swag', 'hire a photographer', 'print badges', 'test the stream'];
    const out = m.fromWords({ ...mine, lines: words.map((w) => `I'll ${w}`) }, words.map((w) => item({ quote: `I'll ${w}`, title: w })));
    expect(out.filter((/** @type {any} */ o) => o.made)).toHaveLength(5);
    expect(out.slice(5)).toEqual([{ title: 'print badges', refused: 'Over the limit of 5 a pass.' }, { title: 'test the stream', refused: 'Over the limit of 5 a pass.' }]);
    expect(m.snapshot().log.filter((/** @type {any} */ l) => l.result === 'refused').map((/** @type {any} */ l) => l.why)).toEqual(['Mallory is not someone on this map.', 'Over the limit of 5 a pass.', 'Over the limit of 5 a pass.']);
    close();
  });
  it('adds the same thing said again to the box already there', async () => {
    const { map: m, close } = opened();
    m.fromWords(mine, [item()]);
    const [again] = m.fromWords({ ...mine, lines: ['I will email Dan the pricing'] }, [item({ quote: 'I will email Dan the pricing', title: 'Email Dan the pricing' })]);
    expect(again).toEqual({ title: 'Email Dan the pricing', merged: 'send-dan-the-pricing' });
    expect(boxOf(m, 'send-dan-the-pricing').action.events.at(-1)).toMatchObject({ what: 'said again', quote: 'I will email Dan the pricing' });
    close();
  });
  it('puts a one-area member\'s draft in their area, under a box the map keeps for their items', async () => {
    const { map: m, close } = opened();
    const [out] = m.fromWords({ ...mine, who: 'Sam' }, [item()]);
    const made = boxOf(m, /** @type {any} */ (out).made);
    expect(made.area).toBe('web');
    const holder = m.snapshot().nodes.find((/** @type {any} */ n) => n.itemsFor === 'Sam');
    expect(holder).toMatchObject({ label: 'Sam\'s action items', area: 'web' });
    expect(m.snapshot().edges).toContainEqual({ from: holder?.id, to: made.id });
    close();
  });
});

describe('saying no, and taking an item on', () => {
  it('Not an action stops preparation first, leaves an info box, and the same words never make a draft again', async () => {
    const { map: m, close } = opened();
    m.fromWords(mine, [item()]);
    await tick();
    expect((await send(m, 'Priya', { type: 'actionnotaction', id: 'send-dan-the-pricing' })).status).toBe(400);
    expect((await send(m, 'Duy', { type: 'actionnotaction', id: 'send-dan-the-pricing' })).status).toBe(200);
    expect(jobs[0].stopped).toBe(true);
    const n = boxOf(m, 'send-dan-the-pricing');
    expect(n.action).toBeUndefined();
    expect(n.boxType).toBe('topic');
    // a late answer from the stopped preparation changes nothing
    jobs[0].job.onDone('', undefined, { status: 'ready', brief });
    expect(boxOf(m, 'send-dan-the-pricing').action).toBeUndefined();
    const [again] = m.fromWords(mine, [item({ title: 'Pricing for Dan' })]);
    expect(again).toHaveProperty('refused', 'It was said not to be an action, or not theirs, before.');
    expect(m.snapshot().log.filter((/** @type {any} */ l) => l.result === 'undone')).toHaveLength(1);
    close();
  });
  it('Not mine names whose it is, and only that person can Take it on: their draft, prepared for them', async () => {
    const { map: m, close } = opened();
    m.fromWords(mine, [item()]);
    expect((await send(m, 'Duy', { type: 'actionnotmine', id: 'send-dan-the-pricing', to: 'Nobody' })).status).toBe(400);
    expect((await send(m, 'Duy', { type: 'actionnotmine', id: 'send-dan-the-pricing', to: 'Priya' })).status).toBe(200);
    const n = boxOf(m, 'send-dan-the-pricing');
    expect(n).toMatchObject({ for: 'Priya', sub: 'For Priya', task: { goal: 'Send Dan the pricing' } });
    expect(n.action).toBeUndefined();
    expect((await send(m, 'Ana', { type: 'actiontakeon', id: 'send-dan-the-pricing' })).status).toBe(400);
    jobs.length = 0;
    expect((await send(m, 'Priya', { type: 'actiontakeon', id: 'send-dan-the-pricing' })).status).toBe(200);
    const a = boxOf(m, 'send-dan-the-pricing').action;
    expect(a).toMatchObject({ by: 'Priya', stage: 'gathering', from: { took: true, said: 'Duy' } });
    expect(a.events.at(-1)).toMatchObject({ what: 'preparing', by: 'Map', auto: 'taken' });
    await tick();
    expect(jobs.filter((j) => j.kind === 'prepare')).toHaveLength(1);
    // taken on, it is theirs like any Action: no Not mine
    expect((await send(m, 'Priya', { type: 'actionnotmine', id: 'send-dan-the-pricing', to: 'Duy' })).status).toBe(400);
    close();
  });
  it('an item for the team is anyone\'s to take on who can see it; the first to press it is its author', async () => {
    const { map: m, close } = opened();
    const [out] = m.fromWords({ ...mine, lines: ['Someone has to check the contract.'] }, [item({ quote: 'Someone has to check the contract', title: 'Check the contract', owner: 'the team' })]);
    const id = /** @type {any} */ (out).info;
    expect(out).toMatchObject({ for: TEAM });
    expect(boxOf(m, id)).toMatchObject({ for: TEAM, sub: 'For the team' });
    expect((await send(m, 'Sam', { type: 'actiontakeon', id })).status).toBe(400);
    expect((await send(m, 'Ana', { type: 'actiontakeon', id })).status).toBe(200);
    expect((await send(m, 'Priya', { type: 'actiontakeon', id })).status).toBe(400);
    expect(boxOf(m, id).action.by).toBe('Ana');
    close();
  });
  it('Claude\'s own suggested Action, once applied, is never marked as your words', async () => {
    const { map: m, close } = openTestMap({ ...state(), proposals: [{ id: 'p1', session: 's1', status: 'pending', made: 1, ops: ['Add the Action'], plan: { nodes: [{ id: 'email-dan', label: 'Email Dan', boxType: 'action', task: task() }], edges: [], remove: [], unlink: [] } }],
      linked: [{ session: 's1', file: '/x.jsonl', owner: 'Duy', at: 1 }] }, 'suggested');
    expect((await send(m, 'Duy', { type: 'apply', proposal: 'p1' })).status).toBe(200);
    const a = boxOf(m, 'email-dan').action;
    expect(a.from).toEqual({ kind: 'suggested', at: expect.any(Number) });
    expect((await send(m, 'Duy', { type: 'actionnotaction', id: 'email-dan' })).status).toBe(400);
    expect(jobs).toHaveLength(0);
    close();
  });
});
