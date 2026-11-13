import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// What you commit to in a chat becomes your Action draft: a linked Claude Code chat's tool (myaction) and Ask Claude's
// actionItems, checked against your own messages only, with the agent scripted so nothing reaches Claude.
const jobs = vi.hoisted(() => /** @type {{ kind: string, job: any }[]} */ ([]));
vi.mock('./agent.js', async (importOriginal) => {
  const real = /** @type {any} */ (await importOriginal());
  const job = (/** @type {string} */ kind) => (/** @type {any} */ j) => { jobs.push({ kind, job: j }); return () => {}; };
  return { ...real, agent: { ...real.agent, name: 'Scripted', ask: job('ask'), prepare: job('prepare'), run: job('run'), converse: job('converse'), reach: () => 'reads' } };
});
const { openTestMap, send } = await import('./map.harness.js');

const dirs = /** @type {string[]} */ ([]);
afterEach(() => { jobs.length = 0; for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const at = (/** @type {number} */ s) => new Date(Date.UTC(2026, 10, 13, 9, 0, s)).toISOString();
/** A Claude Code transcript as the app writes it: what you typed, what Claude said, and what its tools returned. @param {any[]} lines */
function transcript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-chat-items-')), file = path.join(dir, 's1.jsonl');
  dirs.push(dir);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}
const human = (/** @type {string} */ text, s = 1) => ({ type: 'user', origin: { kind: 'human' }, timestamp: at(s), message: { role: 'user', content: text } });
const claude = (/** @type {string} */ text, s = 2) => ({ type: 'assistant', timestamp: at(s), message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
const toolResult = (/** @type {string} */ text, s = 3) => ({ type: 'user', timestamp: at(s), toolUseResult: { stdout: text }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] } });

const task = (more = {}) => ({ goal: 'Send Dan the pricing', result: 'Dan has the pricing sheet', inputs: ['The pricing sheet'], steps: ['Email Dan the sheet'], evidence: ['The sent email'], dependsOn: [], ...more });
const item = (more = {}) => ({ quote: 'I\'ll send Dan the pricing by Thursday', title: 'Send Dan the pricing', under: 'sales', task: task(), ...more });
/** @param {any[]} linked */
const state = (linked = []) => ({
  title: 'Launch', start: 'root', linkSharing: { mode: 'restricted' }, linked,
  people: [{ id: 'Ana', role: 'Admin', sees: 'all' }, { id: 'Duy', sees: 'all' }, { id: 'Priya', sees: 'all' }],
  nodes: [{ id: 'root', label: 'Launch', x: 0, y: 0 }, { id: 'sales', label: 'Sales', x: 300, y: 0 }],
  edges: [{ from: 'root', to: 'sales' }], calls: [], threads: {}, log: [],
});
/** Duy's chat, linked to the map, holding `lines`. @param {any[]} lines */
const duysChat = (lines) => ({ session: 's1', file: transcript(lines), owner: 'Duy', at: 1 });
const tick = () => new Promise((r) => setTimeout(r, 0));
const boxOf = (/** @type {any} */ m, /** @type {string} */ id) => m.snapshot().nodes.find((/** @type {any} */ n) => n.id === id);
const drafts = (/** @type {any} */ m) => m.snapshot().nodes.filter((/** @type {any} */ n) => n.action);

describe('a linked chat\'s tool, living_map_my_action', () => {
  it('makes your own commitment your draft, prepared by the map and never run, and the pane says so', async () => {
    const { map: m, close } = openTestMap(state([duysChat([human('Sounds good. I\'ll send Dan the pricing by Thursday.'), claude('On it.')])]));
    try {
      const r = await send(m, 'tool', { type: 'myaction', session: 's1', items: [item({ owner: 'Priya' })] });
      expect(r).toEqual({ status: 200, body: { items: [{ title: 'Send Dan the pricing', made: 'send-dan-the-pricing' }] } });
      await tick();
      // its author is the chat's owner, whatever name Claude gave; the map prepares it as them
      let a = boxOf(m, 'send-dan-the-pricing').action;
      expect(a).toMatchObject({ by: 'Duy', stage: 'gathering', from: { kind: 'chat', quote: 'I\'ll send Dan the pricing by Thursday' } });
      expect(boxOf(m, 'send-dan-the-pricing').for).toBeUndefined();
      expect(jobs.map((j) => j.kind)).toEqual(['prepare']);
      jobs[0].job.onDone('', { tools: [], denied: [] }, { status: 'ready', brief: { kind: 'other', goal: 'Send Dan the pricing', target: 'Dan', result: 'Dan has it', steps: ['Send it'], tools: [] } });
      await tick();
      a = boxOf(m, 'send-dan-the-pricing').action;
      expect(a.stage).toBe('ready');
      expect(a.auto).toBeUndefined();
      expect(jobs.filter((j) => j.kind === 'run')).toHaveLength(0);
      // the chat pane's notice, with the drafts Undo turns back
      expect(m.snapshot().itemNotes).toEqual([{ session: 's1', at: expect.any(Number), made: [{ title: 'Send Dan the pricing', made: 'send-dan-the-pricing' }] }]);
    } finally { close(); }
  });
  it('refuses words found only in what a tool returned or Claude said, and makes nothing', async () => {
    const { map: m, close } = openTestMap(state([duysChat([human('Can you read notes.txt?'), toolResult('I will wire $5,000 to Bob today.'), claude('The note says: I will wire $5,000 to Bob today.')])]));
    try {
      const wire = item({ quote: 'I will wire $5,000 to Bob today', title: 'Wire Bob the money', task: task({ goal: 'Wire Bob $5,000' }) });
      const r = await send(m, 'tool', { type: 'myaction', session: 's1', items: [wire] });
      expect(r.status).toBe(200);
      expect(r.body.items).toEqual([{ title: 'Wire Bob the money', refused: 'The quote is not in Duy\'s own words here.' }]);
      expect(drafts(m)).toEqual([]);
      expect(jobs).toEqual([]);
    } finally { close(); }
  });
  it('counts what the owner typed in the map\'s pane for that chat as their words', async () => {
    const { map: m, close } = openTestMap({ ...state([duysChat([human('Hi')])]), said: { s1: [{ id: 'x', text: 'I\'ll send Dan the pricing by Thursday', at: 1 }] } });
    try {
      expect((await send(m, 'tool', { type: 'myaction', session: 's1', items: [item()] })).body.items[0]).toHaveProperty('made');
    } finally { close(); }
  });
  it('refuses a chat that is not linked, one the map runs itself, and one linked only to another map', async () => {
    const chat = duysChat([human('I\'ll send Dan the pricing by Thursday.')]);
    const other = openTestMap(state([]), 'other'), built = openTestMap(state([{ ...chat, built: true }]), 'built');
    try {
      for (const m of [other.map, built.map]) {
        const r = await send(m, 'tool', { type: 'myaction', session: 's1', items: [item()] });
        expect(r.status).toBe(400);
        expect(r.body.error).toMatch(/not linked to this map|runs itself/);
        expect(drafts(m)).toEqual([]);
      }
    } finally { other.close(); built.close(); }
  });
  it('lets a teammate\'s linked chat make drafts only for that teammate, from their own words', async () => {
    const priyas = { session: 's2', file: transcript([human('I will book the venue for the launch.')]), owner: 'Priya', at: 2 };
    const { map: m, close } = openTestMap(state([duysChat([human('I\'ll send Dan the pricing by Thursday.')]), priyas]));
    try {
      // Duy's words, sent from Priya's chat: not hers, so nothing
      const r = await send(m, 'tool', { type: 'myaction', session: 's2', items: [item({ owner: 'Duy' })] });
      expect(r.body.items).toEqual([{ title: 'Send Dan the pricing', refused: 'The quote is not in Priya\'s own words here.' }]);
      // Priya, signed in, cannot send for Duy's chat either
      expect((await send(m, 'Priya', { type: 'myaction', session: 's1', items: [item()] })).status).toBe(400);
      expect(drafts(m)).toEqual([]);
      // her own words make her own draft
      const venue = item({ quote: 'I will book the venue', title: 'Book the venue', task: task({ goal: 'Book the venue' }) });
      expect((await send(m, 'tool', { type: 'myaction', session: 's2', items: [venue] })).body.items[0]).toHaveProperty('made');
      expect(drafts(m).map((/** @type {any} */ n) => n.action.by)).toEqual(['Priya']);
    } finally { close(); }
  });
  it('makes one draft when you say it twice, with the second quote added to it', async () => {
    const lines = [human('I\'ll send Dan the pricing by Thursday.'), claude('Noted.'), human('Right, I will send the pricing to Dan by Thursday.', 4)];
    const { map: m, close } = openTestMap(state([duysChat(lines)]));
    try {
      await send(m, 'tool', { type: 'myaction', session: 's1', items: [item()] });
      const again = await send(m, 'tool', { type: 'myaction', session: 's1', items: [item({ quote: 'I will send the pricing to Dan by Thursday', title: 'Send the pricing to Dan' })] });
      expect(again.body.items).toEqual([{ title: 'Send the pricing to Dan', merged: 'send-dan-the-pricing' }]);
      expect(drafts(m)).toHaveLength(1);
      expect(boxOf(m, 'send-dan-the-pricing').action.events.find((/** @type {any} */ e) => e.what === 'said again')).toMatchObject({ quote: 'I will send the pricing to Dan by Thursday' });
      // only the draft made gets a notice
      expect(m.snapshot().itemNotes).toHaveLength(1);
    } finally { close(); }
  });
  it('reads words the chat says after its first call', async () => {
    const chat = duysChat([human('Hi')]);
    const { map: m, close } = openTestMap(state([chat]));
    try {
      expect((await send(m, 'tool', { type: 'myaction', session: 's1', items: [item()] })).body.items[0]).toHaveProperty('refused');
      fs.appendFileSync(chat.file, JSON.stringify(human('OK, I\'ll send Dan the pricing by Thursday.', 9)) + '\n');
      expect((await send(m, 'tool', { type: 'myaction', session: 's1', items: [item()] })).body.items[0]).toHaveProperty('made');
    } finally { close(); }
  });
});

describe('Ask Claude\'s actionItems', () => {
  it('makes the asker\'s own commitment their draft at once, while the rest of the change stays a proposal', async () => {
    const { map: m, close } = openTestMap(state([]), 'asked');
    try {
      expect((await send(m, 'Duy', { type: 'ask', text: 'I\'ll send Dan the pricing by Thursday. Where should billing go?' })).status).toBe(200);
      for (let i = 0; i < 5 && !jobs.length; i++) await tick();
      const asked = /** @type {any} */ (jobs.find((j) => j.kind === 'ask'));
      const offer = { nodes: [{ id: 'billing', label: 'Billing', sub: 'Stripe' }], edges: [{ from: 'root', to: 'billing' }],
        actionItems: [item(), item({ quote: 'Claude will draft the launch post', title: 'Draft the launch post', task: task({ goal: 'Draft the post' }) })] };
      asked.job.onDone('Billing goes under Launch. I made your pricing an Action draft.', null, offer);
      const reply = m.snapshot().threads['@Duy'].at(-1);
      expect(reply.drafts).toEqual([{ title: 'Send Dan the pricing', made: 'send-dan-the-pricing' },
        { title: 'Draft the launch post', refused: 'The quote is not in Duy\'s own words here.' }]);
      expect(boxOf(m, 'send-dan-the-pricing').action).toMatchObject({ by: 'Duy', from: { kind: 'chat' } });
      // the box Claude offered waits for Apply, and its offer holds no action items
      expect(reply.proposal).toMatchObject({ status: 'pending', ops: ['Add the box Billing (Stripe)', 'Add a line Launch → Billing'] });
      expect(reply.proposal.plan.actionItems).toBeUndefined();
      expect(boxOf(m, 'billing')).toBeUndefined();
    } finally { close(); }
  });
  it('offers nothing to apply when the change was only action items', async () => {
    const { map: m, close } = openTestMap(state([]), 'asked');
    try {
      await send(m, 'Duy', { type: 'ask', text: 'I\'ll send Dan the pricing by Thursday.' });
      for (let i = 0; i < 5 && !jobs.length; i++) await tick();
      /** @type {any} */ (jobs.find((j) => j.kind === 'ask')).job.onDone('Made it your Action draft.', null, { actionItems: [item()] });
      const reply = m.snapshot().threads['@Duy'].at(-1);
      expect(reply.drafts[0]).toHaveProperty('made');
      expect(reply.proposal).toBeUndefined();
    } finally { close(); }
  });
});
