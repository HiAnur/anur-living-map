// A meeting drawn live: what the recorder sends is kept, asked about with no tools about once a minute of talk,
// after a pause and at the end with a last pass, checked by code and drawn; the talk counts as sent only once
// its answer landed. The routes make a meeting's map, owned by whoever records it, and refuse what is not theirs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { agent } from './agent.js';
import { mapList } from './map-list.js';
import { mapsRoutes } from './maps-routes.js';
import { MEETING_ID } from './meeting-draw.js';
import { TIDY_SCHEMA } from './meeting-tidy.js';
import { ACTIONS_SCHEMA, CHUNK_MS, meetingJob, parseTranscript, STRETCH_WORDS, SUMMARY_ID } from './meeting.js';
import { openMap } from './server.js';

const T0 = 1_700_000_000_000;
/** @param {number} s @param {string} text @param {string} [speaker] */
const seg = (s, text, speaker = 'others') => ({ text, speaker, start: T0 + s * 1000, end: T0 + s * 1000 + 900 });
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** an answer that adds one topic per call, quoting the newest line it was shown */
const topicAnswer = (/** @type {any} */ job) => {
  const now = job.prompt.split(/SAID SINCE YOU LAST LOOKED:|LAST PASS[^\n]*\n/).at(-1).trim().split('\n').filter((/** @type {string} */ l) => /: /.test(l)).at(-1) || '';
  const quote = now.replace(/^[^:]+: /, '');
  return { value: { summary: `Added "${quote}"`, ops: [{ op: 'add', kind: 'topic', title: quote.slice(0, 40), under: MEETING_ID, quote }] } };
};

/** A meeting on a state of its own; `answers` scripts what the agent answers, in turn. @param {any} [o] */
function job(o = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-meeting-'));
  /** @type {any} */ const state = { title: 'Untitled map', nodes: [], edges: [] };
  /** @type {any[]} */ const asked = [], drawn = [], said = [];
  let now = T0;
  const j = meetingJob({
    home, getState: () => state, save() {}, push() {},
    answer: async (job) => { asked.push(job); return (o.answer || topicAnswer)(job, asked.length); },
    draw: (p) => {
      drawn.push(p);
      for (const n of p.nodes) { const had = state.nodes.find((/** @type {any} */ x) => x.id === n.id); if (had) Object.assign(had, n); else state.nodes.push({ ...n }); }
      state.edges.push(...p.edges);
      const gone = new Set(p.remove || []);
      state.nodes = state.nodes.filter((/** @type {any} */ n) => !gone.has(n.id));
      state.edges = state.edges.filter((/** @type {any} */ e) => !gone.has(e.from) && !gone.has(e.to));
    },
    say: (to, text) => said.push({ to, text }),
    now: () => now, pauseMs: 30, retryMs: 40, ...o.job,
  });
  return { j, state, asked, drawn, said, home, tick: (/** @type {number} */ ms) => (now += ms) };
}

describe('a meeting on a map', () => {
  it('starts with a meeting box at the centre of the map', () => {
    const { j, state } = job();
    j.start({ title: 'Launch sync', app: 'Zoom', by: 'Harshit' });
    expect(state).toMatchObject({ title: 'Launch sync', start: MEETING_ID, meeting: { app: 'Zoom', by: 'Harshit', live: true, sent: 0 } });
    expect(state.nodes[0]).toMatchObject({ id: MEETING_ID, label: 'Launch sync' });
    j.close();
  });

  it('waits for a minute of talk, asks once with no tools, draws only what passes the checks', async () => {
    const { j, state, asked, said } = job();
    j.start({ title: 'Launch sync', by: 'Harshit' });
    j.add([seg(0, 'Launch date first.', 'you'), seg(20, "Let's decide on Friday.")]);
    expect(asked).toEqual([]);
    j.add([seg(CHUNK_MS / 1000, 'Now pricing.')]);
    await j.idle();
    expect(asked).toHaveLength(1);
    expect(asked[0].schema).toBeTruthy();
    expect(asked[0].prompt).toContain('"You:" are Harshit');
    expect(asked[0].prompt).toMatch(/SAID SINCE YOU LAST LOOKED:\n\(\d\d:\d\d–\d\d:\d\d\)\nYou: Launch date first\.\nOthers: Let's decide on Friday\.\nOthers: Now pricing\./);
    expect(state.nodes.map((/** @type {any} */ n) => n.label)).toEqual(['Launch sync', 'Now pricing.']);
    expect(state.meeting).toMatchObject({ sent: 3, boxes: [state.nodes[1].id], kinds: { [state.nodes[1].id]: 'topic' } });
    expect(said).toEqual([{ to: 'Harshit', text: 'Added 1 topic.' }]);
    j.close();
  });

  it('shows the last two minutes again, as already on the map', async () => {
    const { j, asked } = job();
    j.start({ title: 'M', by: 'Harshit' });
    j.add([seg(0, 'First point here.'), seg(CHUNK_MS / 1000, 'Second point here.')]);
    await j.idle();
    j.add([seg(100, 'Third point here.'), seg(100 + CHUNK_MS / 1000, 'Fourth point here.')]);
    await j.idle();
    expect(asked[1].prompt).toMatch(/SAID BEFORE \(already on the map\):\n.*\nOthers: First point here\.\nOthers: Second point here\./);
    expect(asked[1].prompt).toMatch(/SAID SINCE YOU LAST LOOKED:\n.*\nOthers: Third point here\.\nOthers: Fourth point here\.$/m);
    // more than two minutes back is on the map and is not sent again
    j.add([seg(260, 'Fifth point here.'), seg(260 + CHUNK_MS / 1000, 'Sixth point here.')]);
    await j.idle();
    expect(asked[2].prompt).toMatch(/SAID BEFORE \(already on the map\):\n.*\nOthers: Fourth point here\.\n/);
    expect(asked[2].prompt).not.toContain('Third point here.');
    expect(asked[2].prompt).not.toContain('First point here.');
    j.close();
  });

  it('asks each time with only the prompt and the answer\'s shape, and the map as it is now', async () => {
    const { j, state, asked } = job();
    j.start({ title: 'M', by: 'Harshit' });
    state.memory = [
      { kind: 'instruction', box: null, text: 'Write titles in plain words.' },
      { kind: 'memory', box: MEETING_ID, text: 'Dan is the customer.' },
      { kind: 'memory', box: 'elsewhere', text: 'Not about this meeting.' },
    ];
    j.add([seg(0, 'Pricing first.'), seg(CHUNK_MS / 1000, 'Free tier or trial?')]);
    await j.idle();
    expect(Object.keys(asked[0]).sort()).toEqual(['prompt', 'schema']);
    expect(asked[0].prompt).toContain('INSTRUCTIONS THE TEAM SET FOR THIS MAP (follow them):\n- Write titles in plain words.');
    expect(asked[0].prompt).toContain("THE MAP'S MEMORY (it may be out of date):\n- Dan is the customer.");
    expect(asked[0].prompt).not.toContain('Not about this meeting.');
    const [a] = state.meeting.boxes;
    state.edges.push({ from: a, to: a, label: 'blocks' });
    j.add([seg(70, 'Next one.'), seg(70 + CHUNK_MS / 1000, 'And another.')]);
    await j.idle();
    expect(asked[1].prompt).toContain(`LINES BETWEEN THEM:\n- ${a} blocks ${a}`);
    j.close();
  });

  it('sends talk that waited in stretches of a few minutes, so no call grows with the meeting', async () => {
    const line = (/** @type {number} */ i) => `Point ${i} ${Array.from({ length: 49 }, (_, k) => `w${i}x${k}`).join(' ')}.`;
    const { j, state, asked } = job({ answer: (/** @type {any} */ jb, /** @type {number} */ n) => (n === 1 ? { error: 'signed out' } : topicAnswer(jb)) });
    j.start({ title: 'M', by: 'Harshit' });
    j.add([seg(0, line(0)), seg(CHUNK_MS / 1000, line(1))]);
    await j.idle();
    expect(state.meeting.sent).toBe(0);
    // signed out for a while: twenty minutes of talk wait
    for (let i = 2; i < 30; i++) j.add([seg(i * 40, line(i))]);
    await wait(80); await j.idle();
    expect(state.meeting.sent).toBe(30);
    const sent = asked.slice(1).map((/** @type {any} */ a) => a.prompt.split('SAID SINCE YOU LAST LOOKED:')[1].split('\n').filter((/** @type {string} */ l) => l.startsWith('Others:')).length);
    expect(sent.length).toBeGreaterThanOrEqual(3);
    for (const n of sent) expect(n * 51).toBeLessThanOrEqual(STRETCH_WORDS + 51);
    expect(sent.reduce((a, b) => a + b, 0)).toBe(30);
    j.close();
  });

  it('stops asking once the meeting reaches its spending cap, says so once, and keeps the talk', async () => {
    const { j, state, asked, said } = job({ answer: (/** @type {any} */ jb) => ({ ...topicAnswer(jb), cost: { value: 0.3, unit: 'usd' } }), job: { capUsd: 0.5 } });
    j.start({ title: 'M', by: 'Harshit' });
    for (let k = 0; k < 3; k++) {
      j.add([seg(k * 100, `${['Pricing', 'Launch', 'Hiring'][k]} first.`), seg(k * 100 + CHUNK_MS / 1000, `${['Budget', 'Venue', 'Travel'][k]} next.`)]);
      await j.idle();
    }
    expect(asked).toHaveLength(2);
    expect(state.meeting).toMatchObject({ sent: 4, capped: true, cost: { value: 0.6, unit: 'usd' } });
    expect(state.meeting.error).toMatch(/\$0\.5 limit/);
    expect(said.filter((/** @type {any} */ s) => /limit/.test(s.text))).toHaveLength(1);
    expect(j.said()).toHaveLength(6);
    j.close();
  });

  it('keeps the talk when a call fails, and sends it again later with what came after', async () => {
    const { j, state, asked } = job({ answer: (/** @type {any} */ job, /** @type {number} */ n) => (n === 1 ? { error: 'signed out' } : topicAnswer(job)) });
    j.start({ title: 'M', by: 'Harshit' });
    j.add([seg(0, 'Point one is here.'), seg(CHUNK_MS / 1000, 'Point two is here.')]);
    await j.idle();
    expect(state.meeting).toMatchObject({ sent: 0, error: 'signed out' });
    j.add([seg(70, 'Point three is here.')]);
    await wait(120); await j.idle();
    expect(state.meeting.sent).toBe(3);
    expect(state.meeting.error).toBeUndefined();
    expect(asked.at(-1).prompt).toContain('Point one is here.\nOthers: Point two is here.\nOthers: Point three is here.');
    j.close();
  });

  it('sends refused items back once with the reasons, then keeps what landed', async () => {
    const { j, state, asked } = job({ answer: (/** @type {any} */ job, /** @type {number} */ n) => n === 1
      ? { value: { summary: 'two', ops: [{ op: 'add', kind: 'topic', title: 'Budget', under: MEETING_ID, quote: 'the budget is forty thousand' }, { op: 'add', kind: 'topic', title: 'Pricing', under: MEETING_ID, quote: 'Now pricing' }] } }
      : { value: { summary: 'fixed', ops: [] } } });
    j.start({ title: 'M', by: 'Harshit' });
    j.add([seg(0, 'Now pricing.'), seg(CHUNK_MS / 1000, 'Free tier or trial?')]);
    await j.idle();
    expect(asked).toHaveLength(2);
    expect(asked[1].prompt).toMatch(/WERE REFUSED[\s\S]*Budget[\s\S]*its quote is not in what was said/);
    expect(state.nodes.map((/** @type {any} */ n) => n.label)).toEqual(['M', 'Pricing']);
    expect(state.meeting.refused).toEqual([expect.objectContaining({ why: 'its quote is not in what was said' })]);
    j.close();
  });

  it('sends what waits after a pause, and at the end the rest and a last pass', async () => {
    const { j, state, asked } = job({ answer: (/** @type {any} */ jb) => (jb.prompt.includes('LAST PASS') || jb.schema === TIDY_SCHEMA ? { value: { summary: 'Tidied', ops: [] } } : topicAnswer(jb)) });
    j.start({ title: 'Standup', by: 'Harshit' });
    j.add([seg(0, 'Quick one about the deploy.')]);
    await wait(80); await j.idle();
    expect(asked).toHaveLength(1);
    j.add([seg(30, 'And the release notes too.')]);
    expect(j.end()).toEqual({});
    await wait(20); await j.idle(); await wait(20); await j.idle();
    expect(asked).toHaveLength(4);
    expect(asked[1].prompt).toContain('And the release notes too.');
    expect(asked[2].prompt).toContain('LAST PASS');
    // then the tidy pass, over the two topics drawn
    expect(asked[3].schema).toBe(TIDY_SCHEMA);
    expect(state.meeting).toMatchObject({ live: false, done: true, sent: 2 });
    expect(j.add([seg(40, 'late')])).toEqual({ error: 'That meeting has ended.' });
  });

  it('keeps a summary box of what was decided and who does what, built by code and out of the model\'s reach', async () => {
    const { j, state, asked } = job({ answer: (/** @type {any} */ jb, /** @type {number} */ n) => (n > 1 ? { value: { summary: '', ops: [] } } : { value: { summary: 'Launch', ops: [
      { op: 'add', ref: 't', kind: 'topic', title: 'Launch date', under: MEETING_ID, quote: 'Launch date first' },
      { op: 'add', kind: 'decision', title: 'Launch Tuesday', sub: 'Friday is too risky', under: 't', quote: 'decide on Tuesday' },
      { op: 'add', kind: 'action', title: 'Review onboarding', under: 't', owner: 'Priya', due: 'Monday', quote: 'Priya will review the onboarding screens by Monday' },
    ] } }) });
    j.start({ title: 'Launch sync', by: 'Harshit' });
    j.add([seg(0, 'Launch date first.', 'you'), seg(20, "Let's decide on Tuesday, Friday is too risky."), seg(CHUNK_MS / 1000, 'Priya will review the onboarding screens by Monday.')]);
    await j.idle();
    const summary = state.nodes.find((/** @type {any} */ n) => n.id === SUMMARY_ID);
    expect(summary).toMatchObject({ label: 'Summary and next steps', sub: '1 decided · 1 to do' });
    expect(summary.desc).toBe('Decided:\n- Launch Tuesday — Friday is too risky\n\nNext steps:\n- Review onboarding (Priya · Monday)');
    expect(state.edges).toContainEqual({ from: MEETING_ID, to: SUMMARY_ID });
    expect(state.meeting.boxes).not.toContain(SUMMARY_ID);
    // the next step does not see it as one of the meeting's boxes to change
    j.add([seg(70, 'Next up is pricing.'), seg(70 + CHUNK_MS / 1000, 'Free tier or trial?')]);
    await j.idle();
    expect(asked[1].prompt).not.toContain(SUMMARY_ID);
    j.close();
  });

  it('never puts a box with no name on the map, even for a question asked and answered in one answer', async () => {
    const { j, state, drawn } = job({ answer: (/** @type {any} */ jb, /** @type {number} */ n) => (n > 1 ? { value: { summary: '', ops: [] } } : { value: { summary: '', ops: [
      { op: 'add', ref: 't', kind: 'topic', title: 'Launch date', under: MEETING_ID, quote: 'Launch date first' },
      { op: 'add', ref: 'q', kind: 'question', title: 'Which day do we launch?', sub: 'Answered: Tuesday', under: 't', quote: 'Launch date first' },
      { op: 'add', kind: 'decision', title: 'Launch Tuesday', under: 't', quote: 'decide on Tuesday', link: { rel: 'answers', to: 'q' } },
    ] } }) });
    j.start({ title: 'Launch sync', by: 'Harshit' });
    j.add([seg(0, 'Launch date first.', 'you'), seg(CHUNK_MS / 1000, "Let's decide on Tuesday.")]);
    await j.idle();
    // what the map was asked to draw: one entry per box, every new one named
    for (const p of drawn) expect(new Set(p.nodes.map((/** @type {any} */ x) => x.id)).size).toBe(p.nodes.length);
    const ids = state.nodes.map((/** @type {any} */ x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const box of state.nodes) expect(box.label).toBeTruthy();
    expect(state.nodes.find((/** @type {any} */ x) => x.id === 'm-which-day-do-we')).toMatchObject({ sub: 'Answered · Tuesday', state: '' });
    j.close();
  });

  it('keeps finer detail as notes on a point, and logs each one', async () => {
    const { j, state } = job({ answer: (/** @type {any} */ jb, /** @type {number} */ n) => (n > 1 ? { value: { summary: '', ops: [] } } : { value: { summary: 'Launch', ops: [
      { op: 'add', ref: 't', kind: 'topic', title: 'Launch date', under: MEETING_ID, quote: 'Launch date first' },
      { op: 'add', ref: 'd', kind: 'decision', title: 'Launch Tuesday', under: 't', quote: 'decide on Tuesday' },
      { op: 'add', kind: 'fact', title: 'Friday too risky', under: 'd', quote: 'Friday is too risky' },
      { op: 'note', id: 't', text: 'Design is ready', quote: 'design is ready' },
    ] } }) });
    j.start({ title: 'Launch sync', by: 'Harshit' });
    j.add([seg(0, 'Launch date first.', 'you'), seg(20, "Let's decide on Tuesday, Friday is too risky."), seg(CHUNK_MS / 1000, 'And design is ready.')]);
    await j.idle();
    expect(state.meeting.boxes).toHaveLength(2);
    const [t, d] = state.meeting.boxes.map((/** @type {string} */ id) => state.nodes.find((/** @type {any} */ n) => n.id === id));
    expect(d.desc).toBe('"decide on Tuesday"\n- Friday too risky — "Friday is too risky"');
    expect(t.desc).toBe('"Launch date first"\n- Design is ready — "design is ready"');
    expect(state.meeting.log.map((/** @type {any} */ x) => x.did)).toEqual(['noted', 'noted', 'moved to notes']);
    j.close();
  });

  it('tidies the map once the last pass is in, before the Action drafts: merges and folds what Claude drew, never a person\'s box', async () => {
    /** @type {string[]} */ const laidOut = [];
    const tidy = { summary: 'Merged the two launch topics, folded one point', ops: [
      { op: 'merge', id: 'm-launch-plan', into: 'm-launch-date' },
      { op: 'fold', id: 'm-design-is-ready' },
      { op: 'fold', id: 'm-launch-tuesday' },
    ] };
    const { j, state, asked, said } = job({
      answer: (/** @type {any} */ jb, /** @type {number} */ n) => {
        if (jb.schema === TIDY_SCHEMA) return { value: tidy, cost: { value: 0.1, unit: 'usd' } };
        if (jb.schema === ACTIONS_SCHEMA) return { value: { items: [] } };
        return { value: { summary: '', ops: n > 1 ? [] : [
          { op: 'add', ref: 't', kind: 'topic', title: 'Launch date', under: MEETING_ID, quote: 'Launch date first' },
          { op: 'add', kind: 'decision', title: 'Launch Tuesday', under: 't', quote: 'decide on Tuesday' },
          { op: 'add', kind: 'fact', title: 'Design is ready', under: 't', quote: 'design is ready' },
          { op: 'add', ref: 'p', kind: 'topic', title: 'Launch plan', under: MEETING_ID, quote: 'Friday is too risky' },
          { op: 'add', kind: 'fact', title: 'Friday too risky', under: 'p', quote: 'Friday is too risky' },
        ] } };
      },
      job: { people: () => ['Harshit'], fromWords: () => [], layout: () => { laidOut.push(state.meeting.done ? 'after done' : 'before done'); } },
    });
    j.start({ title: 'Launch sync', by: 'Harshit' });
    j.add([seg(0, 'Launch date first.', 'you'), seg(20, "Let's decide on Tuesday, Friday is too risky."), seg(CHUNK_MS / 1000, 'And design is ready.')]);
    await j.idle();
    // a person changed this one: the tidy pass leaves it where it is
    state.nodes.find((/** @type {any} */ n) => n.id === 'm-launch-tuesday').updatedBy = 'Priyanka';
    j.end();
    for (let i = 0; i < 40 && !state.meeting.actionsDone; i++) await wait(10);
    await j.idle();
    expect(asked.map((/** @type {any} */ a) => a.schema === TIDY_SCHEMA ? 'tidy' : a.schema === ACTIONS_SCHEMA ? 'actions' : a.prompt.includes('LAST PASS') ? 'last' : 'stretch'))
      .toEqual(['stretch', 'last', 'tidy', 'actions']);
    expect(asked[2].prompt).not.toContain('SAID');
    expect(asked[2].prompt).toContain('- m-launch-plan · topic · Launch plan (under meeting)');
    const ids = state.nodes.map((/** @type {any} */ n) => n.id);
    expect(ids).not.toContain('m-launch-plan');
    expect(ids).not.toContain('m-design-is-ready');
    expect(ids).toEqual(expect.arrayContaining(['m-launch-tuesday', 'm-friday-too-risky']));
    expect(state.meeting.boxes).toEqual(['m-launch-date', 'm-launch-tuesday', 'm-friday-too-risky']);
    // the merged topic's point now hangs under the topic it joined
    expect(state.edges).toContainEqual({ from: 'm-launch-date', to: 'm-friday-too-risky' });
    expect(state.nodes.find((/** @type {any} */ n) => n.id === 'm-launch-date').desc).toBe('"Launch date first"\n- Launch plan — "Friday is too risky"\n- Design is ready — "design is ready"');
    expect(state.meeting.log.filter((/** @type {any} */ x) => x.did === 'merged' || x.did === 'folded').map((/** @type {any} */ x) => [x.did, x.id, x.into]))
      .toEqual([['merged', 'm-launch-plan', 'm-launch-date'], ['folded', 'm-design-is-ready', 'm-launch-date']]);
    expect(state.meeting.refused.at(-1).why).toBe('Launch Tuesday was written by a person: the meeting leaves it');
    expect(state.meeting.cost).toEqual({ value: 0.1, unit: 'usd' });
    // the chat hears what code applied, never the model's own summary
    expect(said.map((/** @type {any} */ s) => s.text)).toEqual(['Added 2 topics, 3 points.', 'Tidied: merged 1, folded 1 (1 refused). 2 points left, within the target of 20.']);
    expect(state.meeting.tidy).toEqual({ merged: 1, folded: 1, promoted: 0, refused: 1, points: 2, target: 20, reached: true });
    expect(laidOut).toEqual(['before done']);
    expect(state.meeting).toMatchObject({ tidyDone: true, done: true });
    j.close();
  });

  it('asks the tidy pass once more when the map is still over its target, and says the target was missed', async () => {
    const { j, state, asked, said } = job({
      answer: (/** @type {any} */ jb, /** @type {number} */ n) => {
        if (jb.schema === TIDY_SCHEMA) return { value: { summary: 'Tidied it all', ops: [{ op: 'fold', id: 'm-launch-tuesday' }] } };
        return { value: { summary: '', ops: n > 1 ? [] : [
          { op: 'add', ref: 't', kind: 'topic', title: 'Launch date', under: MEETING_ID, quote: 'Launch date first' },
          { op: 'add', kind: 'decision', title: 'Launch Tuesday', under: 't', quote: 'decide on Tuesday' },
          { op: 'add', kind: 'fact', title: 'Design is ready', under: 't', quote: 'design is ready' },
        ] } };
      },
      job: { tidyTarget: 1 },
    });
    j.start({ title: 'Launch sync', by: 'Harshit' });
    j.add([seg(0, 'Launch date first.', 'you'), seg(20, "Let's decide on Tuesday."), seg(CHUNK_MS / 1000, 'And design is ready.')]);
    await j.idle();
    j.end();
    for (let i = 0; i < 40 && !state.meeting.done; i++) await wait(10);
    const tidies = asked.filter((/** @type {any} */ a) => a.schema === TIDY_SCHEMA);
    expect(tidies).toHaveLength(2);
    expect(tidies[0].prompt).toContain('It has 2 points; the target is at most 1. Propose enough merges and folds to remove at least 1.');
    expect(tidies[1].prompt).toMatch(/LEFT THE MAP OVER THE TARGET[\s\S]*Launch Tuesday is a decision: it stays a box/);
    expect(state.meeting.tidy).toMatchObject({ points: 2, target: 1, reached: false });
    expect(said.at(-1).text).toBe('Tidied: nothing changed (2 refused). 2 points left, over the target of 1.');
    j.close();
  });

  it('shows topics talked about in the latest stretches in full, the others by title, so each call stays about the same size', async () => {
    const { j, asked } = job({ answer: (/** @type {any} */ jb, /** @type {number} */ n) => {
      const quote = jb.prompt.split('SAID SINCE YOU LAST LOOKED:').at(-1).trim().split('\n').at(-1).replace(/^[^:]+: /, '');
      return { value: { summary: '', ops: [{ op: 'add', kind: 'topic', title: `Part ${['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'][n - 1]}`, sub: `Line ${n}`, under: MEETING_ID, quote }] } };
    } });
    j.start({ title: 'M', by: 'Harshit' });
    for (let k = 0; k < 6; k++) { j.add([seg(k * 70, `Point ${k} here.`), seg(k * 70 + CHUNK_MS / 1000, `More on ${k} now.`)]); await j.idle(); }
    const last = asked.at(-1).prompt;
    // stretch 6: parts touched in stretches 3 to 5 in full, parts alpha and bravo by title
    expect(last).toContain('- m-part-alpha · topic · Part alpha (under meeting)\n');
    expect(last).toContain('- m-part-charlie · topic · Part charlie · Line 3 (under meeting)');
    expect(last).toContain('- m-part-echo · topic · Part echo · Line 5 (under meeting)');
    expect(last).toMatch(/titles only/);
    j.close();
  });

  it('skips the tidy pass once the meeting reached its spending cap', async () => {
    const { j, state, asked } = job({ answer: (/** @type {any} */ jb) => ({ ...topicAnswer(jb), cost: { value: 0.3, unit: 'usd' } }), job: { capUsd: 0.5 } });
    j.start({ title: 'M', by: 'Harshit' });
    j.add([seg(0, 'Pricing first.'), seg(CHUNK_MS / 1000, 'Budget next.')]);
    await j.idle();
    j.add([seg(70, 'Hiring first.'), seg(70 + CHUNK_MS / 1000, 'Travel next.')]);
    await j.idle();
    j.end();
    await wait(20); await j.idle();
    expect(asked.some((/** @type {any} */ a) => a.schema === TIDY_SCHEMA)).toBe(false);
    expect(state.meeting.capped).toBe(true);
    j.close();
  });

  it('ends by sending only your own words to the action check, which makes the drafts', async () => {
    /** @type {any[]} */ const checked = [];
    const { j, state, asked, said } = job({
      answer: (/** @type {any} */ jb) => (jb.schema === ACTIONS_SCHEMA
        ? { value: { items: [{ quote: "I'll send Dan the pricing by Thursday", title: 'Send Dan the pricing', task: { goal: 'g', result: 'r', inputs: [], steps: ['s'], evidence: ['e'], dependsOn: [] } }] } }
        : { value: { summary: '', ops: [] } }),
      job: { people: () => ['Harshit'], fromWords: (/** @type {any} */ src, /** @type {any} */ items) => { checked.push({ src, items }); return [{ title: items[0].title, made: 'm-draft' }]; } },
    });
    j.start({ title: 'Pricing sync', by: 'Harshit' });
    j.add([seg(0, "I'll send Dan the pricing by Thursday.", 'you'), seg(5, 'Priya will check the contract.')]);
    j.end();
    for (let i = 0; i < 30 && !state.meeting.actions; i++) await wait(10);
    const pass = asked.find((/** @type {any} */ a) => a.schema === ACTIONS_SCHEMA);
    expect(pass.prompt).toContain("You: I'll send Dan the pricing by Thursday.");
    expect(pass.prompt).not.toContain('Priya will check the contract');
    expect(checked).toEqual([{ src: { kind: 'meeting', id: expect.stringContaining('meeting:Pricing sync:'), who: 'Harshit', lines: ["I'll send Dan the pricing by Thursday."], spoken: true }, items: expect.any(Array) }]);
    expect(state.meeting.actions).toEqual([{ title: 'Send Dan the pricing', made: 'm-draft' }]);
    expect(said.at(-1).text).toMatch(/^Made 1 Action draft from what you said, now preparing/);
    j.close();
  });

  it('hangs a draft named under a point under that point\'s topic, so the map stays two levels', async () => {
    /** @type {any[]} */ const checked = [];
    const task = { goal: 'g', result: 'r', inputs: [], steps: ['s'], evidence: ['e'], dependsOn: [] };
    const { j, state } = job({
      answer: (/** @type {any} */ jb, /** @type {number} */ n) => {
        if (jb.schema === ACTIONS_SCHEMA) return { value: { items: [
          { quote: "I'll send Dan the pricing by Thursday", title: 'Send Dan the pricing', under: 'm-send-pricing', task },
          { quote: "I'll send Dan the pricing by Thursday", title: 'Again', under: 'm-pricing', task },
        ] } };
        if (jb.schema === TIDY_SCHEMA) return { value: { summary: '', ops: [] } };
        return { value: { summary: '', ops: n > 1 ? [] : [
          { op: 'add', ref: 't', kind: 'topic', title: 'Pricing', under: MEETING_ID, quote: "I'll send Dan the pricing" },
          { op: 'add', kind: 'action', title: 'Send pricing', under: 't', owner: 'Harshit', quote: "I'll send Dan the pricing by Thursday" },
        ] } };
      },
      job: { people: () => ['Harshit'], fromWords: (/** @type {any} */ src, /** @type {any} */ items) => { checked.push(items); return []; } },
    });
    j.start({ title: 'Pricing sync', by: 'Harshit' });
    j.add([seg(0, "I'll send Dan the pricing by Thursday.", 'you'), seg(CHUNK_MS / 1000, 'Sounds good.')]);
    await j.idle();
    j.end();
    for (let i = 0; i < 40 && !checked.length; i++) await wait(10);
    expect(checked[0].map((/** @type {any} */ x) => x.under)).toEqual(['m-pricing', 'm-pricing']);
    expect(state.meeting.boxes).toEqual(['m-pricing', 'm-send-pricing']);
    j.close();
  });

  it('counts a question answered as a decision among what was decided', async () => {
    const { j, state } = job({ answer: (/** @type {any} */ jb, /** @type {number} */ n) => ({ value: { summary: '', ops: n === 1 ? [
      { op: 'add', ref: 't', kind: 'topic', title: 'Launch date', under: MEETING_ID, quote: 'Launch date first' },
      { op: 'add', kind: 'question', title: 'Which day do we launch?', under: 't', quote: 'Launch date first' },
    ] : n === 2 ? [{ op: 'update', id: 'm-which-day-do-we', sub: 'Tuesday', quote: 'decide on Tuesday', answered: 'decide on Tuesday', as: 'decision' }] : [] } }) });
    j.start({ title: 'Launch sync', by: 'Harshit' });
    j.add([seg(0, 'Launch date first.', 'you'), seg(CHUNK_MS / 1000, 'Next.')]);
    await j.idle();
    j.add([seg(70, "Let's decide on Tuesday."), seg(70 + CHUNK_MS / 1000, 'Done.')]);
    await j.idle();
    expect(state.nodes.find((/** @type {any} */ x) => x.id === 'm-which-day-do-we')).toMatchObject({ sub: 'Decided · Tuesday', state: '' });
    expect(state.nodes.find((/** @type {any} */ x) => x.id === SUMMARY_ID)).toMatchObject({ sub: '1 decided · 0 to do' });
    j.close();
  });

  it('makes no drafts when the recorder\'s name is not one of the map\'s people, and says why', async () => {
    let calls = 0;
    const { j, state, asked, said } = job({ job: { people: () => ['Priyanka'], fromWords: () => { calls++; return []; } } });
    j.start({ title: 'M', by: 'Harshit' });
    j.add([seg(0, "I'll write the notes.", 'you')]);
    j.end();
    for (let i = 0; i < 30 && !state.meeting.actionsDone; i++) await wait(10);
    await wait(20);
    expect(asked.some((/** @type {any} */ a) => a.schema === ACTIONS_SCHEMA)).toBe(false);
    expect(calls).toBe(0);
    expect(said.at(-1).text).toMatch(/"Harshit" is not one of this map's people/);
    j.close();
  });

  it('refuses words on a map that is not a meeting, and a list that is not one', () => {
    const { j } = job();
    expect(j.add([seg(0, 'hi')]).error).toBe('This map is not a meeting.');
    j.start({ title: 'M', by: 'Harshit' });
    expect(j.add('words').error).toMatch(/list/);
    expect(j.add([{ text: '  ' }, 'nonsense', { text: 'kept', speaker: 'someone', start: -4 }])).toEqual({ count: 1 });
    expect(j.said()[0]).toMatchObject({ speaker: 'others', text: 'kept', start: T0 });
    j.close();
  });

  it('keeps what was said in the map\'s folder, and sends what was waiting after a restart', async () => {
    const first = job({ job: { memory: false } });
    first.j.start({ title: 'Kept', by: 'Harshit' });
    first.j.add([seg(0, 'First words here.')]);
    first.j.close();
    expect(fs.readFileSync(path.join(first.home, 'meeting.jsonl'), 'utf8')).toContain('First words here.');
    /** @type {any[]} */ const asked = [];
    const again = meetingJob({ home: first.home, getState: () => first.state, save() {}, push() {}, draw() {}, say() {},
      answer: async (jb) => { asked.push(jb); return topicAnswer(jb); } });
    expect(again.said()).toHaveLength(1);
    await wait(20); await again.idle();
    expect(asked[0].prompt).toContain('First words here.');
    again.close();
  });

  it('draws a pasted transcript in stretches, with your lines as yours, then a last pass', async () => {
    const { j, state, asked } = job();
    expect(j.importText({ title: 'Pasted', text: '  ', by: 'Harshit' }).error).toBe('The transcript has no words.');
    // 120 lines of 12 words: about 1,440 words, so three stretches
    const long = Array.from({ length: 120 }, (_, i) => `Priya: ${Array.from({ length: 12 }, (_, k) => `w${i}x${k}`).join(' ')}.`).join('\n');
    expect(j.importText({ title: 'Pasted', text: `${long}\nHarshit Khandelwal: I will write the notes.`, me: 'Harshit Khandelwal', by: 'Harshit' })).toEqual({ count: 121 });
    for (let i = 0; i < 50 && !state.meeting.done; i++) await wait(10);
    expect(state.meeting).toMatchObject({ imported: true, live: false, done: true, sent: 121 });
    const stretches = asked.filter((/** @type {any} */ a) => !a.prompt.includes('LAST PASS') && a.schema !== TIDY_SCHEMA);
    expect(stretches.length).toBe(3);
    // each shows what came just before it again, already on the map
    expect(stretches[1].prompt).toMatch(/SAID BEFORE \(already on the map\):\n(Priya: .*\n){20}\nSAID SINCE/);
    expect(asked.at(-3).prompt).toContain('You: I will write the notes.');
    expect(asked.at(-2).prompt).toContain('LAST PASS');
    expect(asked.at(-1).schema).toBe(TIDY_SCHEMA);
  });

  it('keeps a pasted transcript\'s place when a call fails, and goes on from there', async () => {
    const { j, state, asked } = job({ answer: (/** @type {any} */ jb, /** @type {number} */ n) => (n === 2 ? { error: 'signed out' } : topicAnswer(jb)) });
    const long = Array.from({ length: 120 }, (_, i) => `Priya: ${Array.from({ length: 12 }, (_, k) => `w${i}x${k}`).join(' ')}.`).join('\n');
    j.importText({ title: 'Pasted', text: long, by: 'Harshit' });
    for (let i = 0; i < 50 && !state.meeting.done; i++) await wait(10);
    expect(state.meeting).toMatchObject({ done: true, sent: 120 });
    // the second stretch failed and was asked again with the same talk
    expect(asked[2].prompt.split('SAID SINCE')[1]).toBe(asked[1].prompt.split('SAID SINCE')[1]);
  });
});

describe('a transcript pasted after the meeting', () => {
  it('reads the formats notes apps write', () => {
    expect(parseTranscript([
      '[00:01:02] Priya Shah: We should ship Friday.',
      '(1:05) Me: Agreed.',
      'Speaker 2 (00:12): What about QA?',
      '',
      'Harshit  0:20',
      "I'll take QA.",
      'Okay',
      'Dan:',
      'Sounds good.',
    ].join('\n'), 'harshit').map(({ speaker, name, text }) => ({ speaker, ...(name ? { name } : {}), text }))).toEqual([
      { speaker: 'others', name: 'Priya Shah', text: 'We should ship Friday.' },
      { speaker: 'you', text: 'Agreed.' },
      { speaker: 'others', name: 'Speaker 2', text: 'What about QA?' },
      { speaker: 'you', text: "I'll take QA." },
      { speaker: 'you', text: 'Okay' },
      { speaker: 'others', name: 'Dan', text: 'Sounds good.' },
    ]);
    expect(parseTranscript('we agreed.\nfine by me').map((s) => s.speaker)).toEqual(['others', 'others']);
  });
});

describe('the meeting routes', () => {
  /** @type {(() => void)[]} */ const undo = [];
  afterEach(() => { for (const u of undo.splice(0)) u(); });

  function server() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-meeting-routes-'));
    /** @type {any[]} */ const asked = [];
    const answer = vi.spyOn(agent, 'answer').mockImplementation(async (/** @type {any} */ j) => { asked.push(j); return { ...topicAnswer(j), ms: 1 }; });
    // every way the agent could be given tools: a meeting uses none of them
    const tooled = /** @type {const} */ (['converse', 'ask', 'prepare', 'run']).map((k) => vi.spyOn(agent, k).mockImplementation(() => () => {}));
    const deps = { DIR: home, MAPS: path.join(home, 'maps'), PROJECT: '', PROJECTS: path.join(home, 'projects.json'), mapName: path.basename };
    const maps = mapList({ ...deps, openMap });
    const routes = mapsRoutes({ ...deps, maps });
    undo.push(() => { for (const m of maps.named.values()) m.close(); maps.main?.close(); answer.mockRestore(); for (const t of tooled) t.mockRestore(); fs.rmSync(home, { recursive: true, force: true }); });
    /** @param {string} p @param {any} data @param {string | null} [who] @param {boolean} [tool] */
    const post = async (p, data, who = null, tool = true) => {
      const req = Object.assign(Readable.from([JSON.stringify(data)]), { method: 'POST', headers: tool ? {} : { origin: 'http://localhost', cookie: 'x=1' } });
      /** @type {any} */ let result;
      await routes(req, {}, new URL(`http://localhost${p}`), who, (/** @type {number} */ status, /** @type {any} */ body) => { result = { status, body }; return true; });
      return result;
    };
    return { maps, post, asked, tooled, answer };
  }

  it('makes a meeting\'s map, and the recorder\'s words are drawn on it with no chat and no tools', async () => {
    const { maps, post, asked, tooled } = server();
    expect((await post('/api/meetings', {})).status).toBe(400);
    const r = await post('/api/meetings', { title: 'Launch sync', app: 'Zoom', by: 'Harshit' });
    expect(r).toEqual({ status: 200, body: { name: 'launch-sync', title: 'Launch sync', href: '/launch-sync/' } });
    const map = maps.mapCalled('launch-sync');
    expect(map.snapshot()).toMatchObject({ title: 'Launch sync', start: MEETING_ID, admins: ['Harshit'], meeting: { by: 'Harshit', live: true } });

    const words = { segments: [seg(0, 'Launch date first.', 'you'), seg(CHUNK_MS / 1000, 'Friday works for design.')] };
    expect(await post('/api/meetings/launch-sync/segments', words)).toEqual({ status: 200, body: { ok: true, count: 2 } });
    await map.meeting.idle();
    expect(asked).toHaveLength(1);
    // one no-tool answer (agent.answer: no tools, settings or connectors), handed nothing but its prompt and shape
    expect(Object.keys(asked[0]).sort()).toEqual(['prompt', 'schema']);
    for (const t of tooled) expect(t).not.toHaveBeenCalled();
    const s = map.snapshot();
    expect(s.nodes.find((/** @type {any} */ n) => n.label === 'Friday works for design.')).toMatchObject({ by: 'Claude' });
    // every box the page gets is an info box: a meeting's kinds stay with the meeting, never a type or a look
    for (const n of s.nodes) for (const k of ['kind', 'boxType', 'type', 'action']) expect(n).not.toHaveProperty(k);
    expect(s.threads['@Harshit'].at(-1)).toMatchObject({ who: 'Claude', text: 'Added 1 topic.' });

    expect(await post('/api/meetings/launch-sync/end', {})).toEqual({ status: 200, body: { ok: true } });
    for (let i = 0; i < 20 && !map.snapshot().meeting.done; i++) await wait(10);
    expect(asked.at(-1).prompt).toContain('LAST PASS');
    for (const t of tooled) expect(t).not.toHaveBeenCalled();
    expect((await post('/api/meetings/launch-sync/segments', words)).status).toBe(400);
  });

  it('draws a question asked and answered in one answer as one named box on the real map', async () => {
    const { maps, post, answer } = server();
    answer.mockImplementation(async () => ({ ms: 1, value: { summary: '', ops: [
      { op: 'add', ref: 't', kind: 'topic', title: 'Launch date', under: MEETING_ID, quote: 'Launch date first' },
      { op: 'add', ref: 'q', kind: 'question', title: 'Which day do we launch?', sub: 'Answered: Tuesday', under: 't', quote: 'Launch date first' },
      { op: 'add', kind: 'decision', title: 'Launch Tuesday', under: 't', quote: 'decide on Tuesday', link: { rel: 'answers', to: 'q' } },
    ] } }));
    await post('/api/meetings', { title: 'Launch sync', by: 'Harshit' });
    await post('/api/meetings/launch-sync/segments', { segments: [seg(0, 'Launch date first.', 'you'), seg(CHUNK_MS / 1000, "Let's decide on Tuesday.")] });
    const map = maps.mapCalled('launch-sync');
    await map.meeting.idle();
    const nodes = map.snapshot().nodes, ids = nodes.map((/** @type {any} */ n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of nodes) expect(n.label).toBeTruthy();
    expect(nodes.find((/** @type {any} */ n) => n.id === 'm-which-day-do-we')).toMatchObject({ label: 'Which day do we launch?', sub: 'Answered · Tuesday' });
  });

  it('names an untitled meeting after its app and time, and a person signed in records as themself', async () => {
    const { post, maps } = server();
    const r = await post('/api/meetings', { app: 'Zoom', by: 'Someone else' }, 'Priyanka', false);
    expect(r.body.title).toMatch(/^Meeting on Zoom, /);
    expect(maps.mapCalled(r.body.name).snapshot().meeting.by).toBe('Priyanka');
  });

  it('draws a pasted transcript as a meeting map, and refuses one with no words', async () => {
    const { post, asked, maps } = server();
    expect((await post('/api/meetings/import', { title: 'Empty', text: ' ', by: 'Harshit' })).status).toBe(400);
    expect(maps.everyMap()).toEqual([]);
    const r = await post('/api/meetings/import', { title: 'Yesterday', text: 'Priya: We cut the ads spend.', by: 'Harshit' });
    expect(r.status).toBe(200);
    for (let i = 0; i < 20 && !maps.mapCalled('yesterday').snapshot().meeting.done; i++) await wait(10);
    expect(asked[0].prompt).toContain('Priya: We cut the ads spend.');
  });

  it('refuses a stranger, an unknown map and a map that is not a meeting', async () => {
    const { post, maps } = server();
    expect((await post('/api/meetings', { by: 'Harshit' }, null, false)).status).toBe(401);
    expect((await post('/api/meetings/nowhere/segments', { segments: [] })).status).toBe(404);
    maps.mapCalled('plain').blank();
    expect((await post('/api/meetings/plain/segments', { segments: [seg(0, 'hi')] })).body.error).toBe('This map is not a meeting.');
    expect((await post('/api/meetings/plain/x/end', {})).status).toBe(404);
  });
});
