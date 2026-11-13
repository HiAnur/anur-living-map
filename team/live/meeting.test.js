// A meeting drawn live: what the recorder sends is kept and handed to the map's own chat about once a minute of
// talk, after a pause, and at the end with a last pass; a pasted transcript goes whole. The routes make a meeting's
// map with a chat of its own, owned by whoever records it, and refuse what is not theirs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { agent, chats } from './agent.js';
import { mapList } from './map-list.js';
import { mapsRoutes } from './maps-routes.js';
import { CHUNK_MS, meetingBrief, meetingJob, parseTranscript } from './meeting.js';
import { openMap } from './server.js';

const T0 = 1_700_000_000_000;
/** A meeting on a state of its own, its messages to the chat kept in `sent`. @param {Partial<Parameters<typeof meetingJob>[0]>} [o] */
function job(o = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-meeting-'));
  /** @type {any} */ const state = { title: 'Untitled map' };
  /** @type {string[]} */ const sent = [];
  let now = T0;
  const j = meetingJob({ home, getState: () => state, save() {}, push() {}, send: (t) => sent.push(t), now: () => now, pauseMs: 30, ...o });
  return { j, state, sent, home, tick: (/** @type {number} */ ms) => (now += ms) };
}
/** @param {number} s @param {string} text @param {string} [speaker] */
const seg = (s, text, speaker = 'others') => ({ text, speaker, start: T0 + s * 1000, end: T0 + s * 1000 + 900 });
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

describe('a meeting on a map', () => {
  it('waits for a minute of talk, then sends it with what the meeting is', () => {
    const { j, state, sent } = job();
    j.start({ title: 'Launch sync', app: 'Zoom', by: 'Harshit' });
    expect(state).toMatchObject({ title: 'Launch sync', renamed: 'Launch sync', meeting: { app: 'Zoom', by: 'Harshit', live: true, sent: 0 } });
    expect(j.add([seg(0, 'Launch date first.', 'you'), seg(20, "Let's decide on Friday.")])).toEqual({ count: 2 });
    expect(sent).toEqual([]);
    j.add([seg(CHUNK_MS / 1000, 'Now pricing.')]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^The meeting "Launch sync" started at \d\d:\d\d on Zoom\.\n\nSaid in the meeting \(\d\d:\d\d–\d\d:\d\d\):\nYou: Launch date first\.\nOthers: Let's decide on Friday\.\nOthers: Now pricing\.$/);
    expect(state.meeting.sent).toBe(3);
    j.close();
  });

  it('sends what waits once nobody has spoken for a while, and only what is new', async () => {
    const { j, sent } = job();
    j.start({ title: 'Standup', by: 'Harshit' });
    j.add([seg(0, 'Quick one.')]);
    j.add([seg(2, 'Still here.')]);
    await wait(80);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Others: Quick one.\nOthers: Still here.');
    j.add([seg(30, 'One more thing.', 'you')]);
    await wait(80);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[1].replace(/^The meeting/, ''));
    expect(sent[1]).toMatch(/^Said in the meeting .*:\nYou: One more thing\.$/);
    j.close();
  });

  it('ends with what is left and a last pass, then takes no more words', () => {
    const { j, state, sent } = job();
    j.start({ title: 'Review', by: 'Harshit' });
    j.add([seg(0, 'Who reviews it?')]);
    expect(j.end()).toEqual({});
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain('Others: Who reviews it?');
    expect(sent[1]).toMatch(/^The meeting has ended\. Make a last pass/);
    expect(state.meeting.live).toBe(false);
    expect(j.add([seg(5, 'late')])).toEqual({ error: 'That meeting has ended.' });
    expect(j.end()).toEqual({});
    expect(sent).toHaveLength(2);
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

  it('keeps what was said in the map\'s folder, and sends what was waiting after a restart', () => {
    const { j, state, sent, home } = job({ memory: false });
    j.start({ title: 'Kept', by: 'Harshit' });
    j.add([seg(0, 'First words.')]);
    j.close();
    expect(fs.readFileSync(path.join(home, 'meeting.jsonl'), 'utf8')).toContain('First words.');
    const again = meetingJob({ home, getState: () => state, save() {}, push() {}, send: (t) => sent.push(t), pauseMs: 30 });
    expect(again.said()).toHaveLength(1);
    again.end();
    expect(sent[0]).toContain('Others: First words.');
  });

  it('sends a pasted transcript whole, with your lines as yours', () => {
    const { j, state, sent } = job();
    expect(j.importText({ title: 'Pasted', text: '  ', by: 'Harshit' }).error).toBe('The transcript has no words.');
    expect(j.importText({ title: 'Pasted', text: 'Priya: We ship Friday.\nHarshit Khandelwal: I will write the notes.', me: 'Harshit Khandelwal', by: 'Harshit' })).toEqual({ count: 2 });
    expect(state.meeting).toMatchObject({ imported: true, live: false });
    expect(sent).toEqual([expect.stringMatching(/^This is the whole transcript of a meeting, "Pasted".*\n\nPriya: We ship Friday\.\nYou: I will write the notes\.$/s)]);
  });

  it('tells the chat whose words are whose, and to draw only what was said', () => {
    const brief = meetingBrief('launch-sync', 'Harshit');
    expect(brief).toContain('pass map: "launch-sync"');
    expect(brief).toContain('"You:" are Harshit');
    expect(brief).toMatch(/Never invent/);
    expect(brief).toMatch(/Read, never act/);
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
    const converse = vi.spyOn(agent, 'converse').mockImplementation((/** @type {any} */ j) => { asked.push(j); setTimeout(j.onClose); return () => {}; });
    const find = vi.spyOn(chats, 'findChat').mockImplementation(() => null);
    const deps = { DIR: home, PROJECT: '', PROJECTS: path.join(home, 'projects.json'), mapName: path.basename };
    const maps = mapList({ ...deps, openMap, demo: () => ({ people: [] }) });
    const routes = mapsRoutes({ ...deps, maps });
    undo.push(() => { for (const m of maps.named.values()) m.close(); maps.main?.close(); converse.mockRestore(); find.mockRestore(); fs.rmSync(home, { recursive: true, force: true }); });
    /** @param {string} p @param {any} data @param {string | null} [who] @param {boolean} [tool] */
    const post = async (p, data, who = null, tool = true) => {
      const req = Object.assign(Readable.from([JSON.stringify(data)]), { method: 'POST', headers: tool ? {} : { origin: 'http://localhost', cookie: 'x=1' } });
      /** @type {any} */ let result;
      await routes(req, {}, new URL(`http://localhost${p}`), who, (/** @type {number} */ status, /** @type {any} */ body) => { result = { status, body }; return true; });
      return result;
    };
    return { maps, post, asked, home };
  }

  it('makes a meeting\'s map with its own chat, and the recorder\'s words reach that chat', async () => {
    const { maps, post, asked } = server();
    expect((await post('/api/meetings', {})).status).toBe(400);
    const r = await post('/api/meetings', { title: 'Launch sync', app: 'Zoom', by: 'Harshit' });
    expect(r).toEqual({ status: 200, body: { name: 'launch-sync', title: 'Launch sync', href: '/launch-sync/' } });
    const map = maps.mapCalled('launch-sync'), s = map.snapshot();
    expect(s).toMatchObject({ title: 'Launch sync', meeting: { by: 'Harshit', app: 'Zoom', live: true } });
    expect(s.linked[0]).toMatchObject({ owner: 'Harshit', built: true });

    const words = { segments: [seg(0, 'Launch date first.', 'you'), seg(CHUNK_MS / 1000, 'Friday works.')] };
    expect(await post('/api/meetings/launch-sync/segments', words)).toEqual({ status: 200, body: { ok: true, count: 2 } });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ first: true, session: s.linked[0].session, cwd: expect.stringContaining('launch-sync') });
    expect(asked[0].system).toContain('live map of a meeting');
    expect(asked[0].prompt).toContain('You: Launch date first.\nOthers: Friday works.');

    expect(await post('/api/meetings/launch-sync/end', {})).toEqual({ status: 200, body: { ok: true } });
    await wait(20);
    expect(asked.at(-1).prompt).toMatch(/^The meeting has ended/);
    expect(asked.at(-1).first).toBe(false);
    expect((await post('/api/meetings/launch-sync/segments', words)).status).toBe(400);
  });

  it('names an untitled meeting after its app and time, and a person signed in records as themself', async () => {
    const { post, maps } = server();
    const r = await post('/api/meetings', { app: 'Zoom', by: 'Someone else' }, 'Priyanka', false);
    expect(r.body.title).toMatch(/^Meeting on Zoom, /);
    expect(maps.mapCalled(r.body.name).snapshot().meeting.by).toBe('Priyanka');
  });

  it('files a pasted transcript as a meeting map, and refuses one with no words', async () => {
    const { post, asked, maps } = server();
    expect((await post('/api/meetings/import', { title: 'Empty', text: ' ', by: 'Harshit' })).status).toBe(400);
    expect(maps.everyMap()).toEqual([]);
    const r = await post('/api/meetings/import', { title: 'Yesterday', text: 'Priya: We cut the ads spend.', by: 'Harshit' });
    expect(r.status).toBe(200);
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
