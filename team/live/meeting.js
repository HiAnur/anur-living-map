// A meeting drawn live on a map. The Living Map Recorder (the Mac app in mac/) sends what was said as it hears it;
// the map keeps it in meeting.jsonl in its folder and, about once a minute of talk, after a pause, and at the end,
// asks the agent for one answer with no tools (agent.answer): the meeting's boxes and the new talk in, a fixed
// list of changes out. meeting-draw.js checks every change against what was said before any of it is drawn, so
// what the map shows rests on code, not on the model following instructions. The talk counts as sent only once
// an answer has landed; a failed call is tried again later with the same talk and more.

import fs from 'node:fs';
import path from 'node:path';

import { checkMeetingOps, MEETING_ID, MEETING_SCHEMA, meetingInstructions, meetingPrompt } from './meeting-draw.js';

export const CHUNK_MS = 60_000;
export const CHUNK_WORDS = 220;
export const PAUSE_MS = 12_000;
// what came just before the new talk, shown again so a point that spans a minute boundary still reads whole
export const OVERLAP_MS = 120_000;
const MAX_SEGMENTS = 500;
const MAX_TEXT = 4000;
const MAX_IMPORT = 400_000;
// a pasted transcript goes in stretches of about this many words
const IMPORT_WORDS = 900;
// the end's last pass reads at most this much of the meeting
const LAST_PASS_CHARS = 60_000;
const RETRY_MS = 30_000;

/** @typedef {{ speaker: 'you' | 'others', name?: string, text: string, start: number, end: number }} Said */

/** "HH:MM" in this Mac's time, or '' for no time. @param {number} t */
const clock = (t) => (t ? new Date(t).toTimeString().slice(0, 5) : '');
/** One line of the transcript as the agent reads it. @param {Said} s */
export const lineOf = (s) => `${s.speaker === 'you' ? 'You' : s.name || 'Others'}: ${s.text}`;
/** @param {Said[]} said */
const wordsIn = (said) => said.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);

/** A stretch of talk: when it was, then what was said. @param {Said[]} said */
export function chunkText(said) {
  const from = clock(said[0]?.start || 0), to = clock(said.at(-1)?.end || 0);
  const when = from ? `(${from}${to && to !== from ? `–${to}` : ''})\n` : '';
  return `${when}${said.map(lineOf).join('\n')}`;
}

/** @param {unknown} v @param {number} n */
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
/** @param {unknown} v */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The recorder's segments, checked: words kept, a speaker that is you or others, times in ms (now when missing).
 * @param {unknown} segments @param {number} now @returns {Said[] | null}
 */
export function checkSegments(segments, now) {
  if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS) return null;
  /** @type {Said[]} */ const out = [];
  for (const raw of segments) {
    if (!raw || typeof raw !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (raw), text = str(r.text, MAX_TEXT);
    if (!text) continue;
    const start = num(r.start) || now;
    out.push({ speaker: r.speaker === 'you' ? 'you' : 'others', text, start, end: Math.max(start, num(r.end) || start) });
  }
  return out;
}

// Leading times as notes apps write them: [00:01:02], (1:02), 00:01 -
const TIME = /^\s*(?:[[(]?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?[\])]?\s*[-–]?\s*)+/;
// "Priya:", "Speaker 2:", "Priya Shah (00:12):"
const NAMED = /^([A-Z][\p{L}\d .'’-]{0,40}?)(?:\s*[([]\d{1,2}:\d{2}(?::\d{2})?[\])])?\s*:\s+(.+)$/u;
// a name alone on its line ("Priya:", "Priya Shah  0:02"), naming who speaks in the lines under it
const ALONE = /^([A-Z][\p{L}\d .'’-]{0,40}?)\s*(?::|\s\d{1,2}:\d{2}(?::\d{2})?)\s*$/u;

/**
 * A pasted transcript as what was said: one line each, with the speaker's name when the line has one. Lines under
 * `me` (or "Me"/"You") are yours.
 * @param {string} text @param {string} [me] @returns {Said[]}
 */
export function parseTranscript(text, me = '') {
  /** @type {Said[]} */ const out = [];
  const mine = me.trim().toLowerCase();
  /** @type {string | undefined} */ let name;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(TIME, '').trim();
    if (!line) continue;
    const alone = ALONE.exec(line);
    if (alone && line.split(/\s+/).length <= 5) { name = alone[1].trim(); continue; }
    const m = NAMED.exec(line), who = m ? m[1].trim() : name, words = m ? m[2].trim() : line;
    const you = !!who && ((!!mine && who.toLowerCase() === mine) || /^(you|me)$/i.test(who));
    out.push(you ? { speaker: 'you', text: words, start: 0, end: 0 } : { speaker: 'others', ...(who ? { name: who } : {}), text: words, start: 0, end: 0 });
  }
  return out;
}

/**
 * One map's meeting.
 * @param {{ home: string, memory?: boolean, getState: () => any, save: () => void, push: () => void,
 *   answer: (job: { prompt: string, schema: object }) => Promise<{ value?: unknown, error?: string, cost?: { value: number, unit: string } }>,
 *   draw: (drawing: { nodes: any[], edges: any[] }) => void, say: (to: string, text: string) => void,
 *   people?: () => string[], now?: () => number, pauseMs?: number, retryMs?: number }} o
 */
export function meetingJob({ home, memory = false, getState, save, push, answer, draw, say, people = () => [], now = Date.now, pauseMs = PAUSE_MS, retryMs = RETRY_MS }) {
  const FILE = path.join(home, 'meeting.jsonl');
  /** @type {Said[]} */ let said = [];
  try { if (!memory) said = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* no meeting on this map yet: nothing said */ }
  /** @type {ReturnType<typeof setTimeout> | null} */ let timer = null;
  /** @type {Promise<void> | null} */ let running = null;
  let closed = false, lastPassDue = false;
  const m = () => getState().meeting;

  /** @param {Said[]} lines */
  const keep = (lines) => {
    said.push(...lines);
    if (memory || !lines.length) return;
    fs.mkdirSync(home, { recursive: true });
    fs.appendFileSync(FILE, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  };
  const later = (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(); }, ms);
    timer.unref?.();
  };

  // the meeting's boxes as the agent and the checks know them; one a person wrote or changed is theirs
  const ownBoxes = () => {
    const meeting = m(), s = getState(), mine = new Set(meeting?.boxes || []);
    const parent = new Map((s.edges || []).filter((/** @type {any} */ e) => !e.label).map((/** @type {any} */ e) => [e.to, e.from]));
    return (s.nodes || []).filter((/** @type {any} */ n) => mine.has(n.id) && n.state !== 'gone').map((/** @type {any} */ n) => ({
      id: n.id, label: n.label, sub: n.sub || '', kind: meeting.kinds?.[n.id] || 'topic', under: parent.get(n.id) || MEETING_ID,
      locked: !!n.updatedBy && n.updatedBy !== 'Claude',
    }));
  };

  /**
   * One answer over `lines` (the new talk) with `before` (shown again), checked and drawn; refused items go back
   * once with the reasons. True when an answer landed.
   * @param {Said[]} lines @param {Said[]} before @param {boolean} last
   */
  async function ask(lines, before, last) {
    const meeting = m(), s = getState();
    const talk = chunkText([...before, ...lines]);
    const taken = new Set((s.nodes || []).map((/** @type {any} */ n) => n.id));
    const ctx = { talk, by: meeting.by, people: people(), taken };
    let retry = '', drawn = 0, summary = '';
    for (let round = 0; round < 2; round++) {
      const prompt = `${meetingInstructions(meeting.by, s.title)}\n\n${meetingPrompt({ boxes: ownBoxes(), before: before.length ? chunkText(before) : '', now: chunkText(lines), last, retry })}`;
      const r = await answer({ prompt, schema: MEETING_SCHEMA });
      if (closed) return false;
      if (r.cost) meeting.cost = { value: (meeting.cost?.value || 0) + r.cost.value, unit: r.cost.unit };
      if (!r.value) { meeting.error = r.error || 'The agent did not answer.'; return round > 0; }
      const checked = checkMeetingOps(r.value, { ...ctx, boxes: ownBoxes() });
      if (checked.nodes.length || checked.edges.length) {
        draw({ nodes: checked.nodes, edges: checked.edges });
        for (const b of checked.added) { (meeting.boxes ||= []).push(b.id); (meeting.kinds ||= {})[b.id] = b.kind; }
        for (const b of checked.changed) if (b.id && !b.gone && meeting.kinds) meeting.kinds[b.id] = meeting.kinds[b.id] || 'topic';
      }
      drawn += checked.added.length + checked.changed.length;
      summary = String(/** @type {any} */ (r.value).summary || '').slice(0, 200) || summary;
      (meeting.refused ||= []).push(...checked.refused.map((x) => ({ at: now(), why: x.why, op: JSON.stringify(x.op).slice(0, 400) })));
      meeting.refused = meeting.refused.slice(-200);
      // only a box that never landed is worth a second try
      const again = checked.refused.filter((x) => x.op?.op !== 'link');
      if (!again.length) break;
      retry = again.map((x) => `- ${JSON.stringify(x.op).slice(0, 300)}: ${x.why}`).join('\n');
    }
    delete meeting.error;
    if (summary || drawn) say(meeting.by, `${summary || `Updated ${drawn} box${drawn === 1 ? '' : 'es'}.`}`);
    return true;
  }

  // How much of the talk may go now: all of it once a minute's worth is waiting, after a pause, or at the end.
  // One call at a time; what arrives meanwhile goes in the next. The talk counts as sent only once its answer
  // landed, so a failed call loses nothing: it is tried again later with the same talk and more.
  let ready = 0;
  async function run() {
    const meeting = m();
    if (!meeting || closed) return;
    const to = Math.min(ready, said.length), from = meeting.sent;
    if (to > from) {
      const lines = said.slice(from, to), start = lines[0].start;
      const before = start ? said.slice(0, from).filter((x) => x.start && start - x.start <= OVERLAP_MS) : said.slice(Math.max(0, from - 20), from);
      const ok = await ask(lines, before, false);
      if (closed) return;
      if (ok) meeting.sent = to;
      save(); push();
      if (!ok) { later(go, retryMs); return; }
    }
    if (lastPassDue && meeting.sent >= said.length) {
      lastPassDue = false;
      let text = 0; const all = [];
      for (let i = said.length - 1; i >= 0 && text < LAST_PASS_CHARS; i--) { all.unshift(said[i]); text += said[i].text.length; }
      const ok = all.length ? await ask(all, [], true) : true;
      if (closed) return;
      if (ok) { meeting.done = true; save(); push(); } else { lastPassDue = true; later(go, retryMs); }
    }
  }
  function go() {
    if (running || closed) return;
    running = run().finally(() => {
      running = null;
      const meeting = m();
      if (meeting && !closed && !timer && (meeting.sent < Math.min(ready, said.length) || (lastPassDue && meeting.sent >= said.length))) go();
    });
  }
  // after a restart, talk that was never sent goes as soon as the map is up
  if (getState().meeting && getState().meeting.sent < said.length) { ready = said.length; if (!getState().meeting.live && !getState().meeting.done) lastPassDue = true; setTimeout(go, 0).unref?.(); }

  return {
    /** @param {{ title: string, app?: string, by: string }} o */
    start({ title, app = '', by }) {
      const s = getState();
      s.title = s.renamed = title;
      s.meeting = { at: now(), app, by, live: true, sent: 0, boxes: [], kinds: {} };
      draw({ nodes: [{ id: MEETING_ID, label: title.slice(0, 60), sub: `Meeting${app ? ` on ${app}` : ''}, ${new Date(now()).toDateString()}` }], edges: [] });
      s.start = MEETING_ID;
      save(); push();
    },
    /** @param {unknown} segments @returns {{ count?: number, error?: string }} */
    add(segments) {
      const meeting = m();
      if (!meeting) return { error: 'This map is not a meeting.' };
      if (!meeting.live) return { error: 'That meeting has ended.' };
      const lines = checkSegments(segments, now());
      if (!lines) return { error: `Send "segments" as a list of at most ${MAX_SEGMENTS}.` };
      keep(lines);
      const waiting = said.slice(meeting.sent), last = waiting.at(-1);
      if (last && (last.end - waiting[0].start >= CHUNK_MS || wordsIn(waiting) >= CHUNK_WORDS)) { ready = said.length; go(); }
      else if (waiting.length) later(() => { ready = said.length; go(); }, pauseMs);
      return { count: lines.length };
    },
    // the rest goes, then a last pass over the meeting
    end() {
      const meeting = m();
      if (!meeting) return { error: 'This map is not a meeting.' };
      if (!meeting.live) return {};
      meeting.live = false; meeting.ended = now(); save(); push();
      if (timer) { clearTimeout(timer); timer = null; }
      ready = said.length;
      lastPassDue = said.length > 0;
      go();
      return {};
    },
    /** @param {{ title: string, text: string, me?: string, by: string }} o @returns {{ count?: number, error?: string }} */
    importText({ title, text, me = '', by }) {
      const lines = parseTranscript(String(text || '').slice(0, MAX_IMPORT), me);
      if (!lines.length) return { error: 'The transcript has no words.' };
      this.start({ title, by });
      const meeting = m();
      meeting.live = false; meeting.imported = true; meeting.ended = now();
      keep(lines); save(); push();
      // in stretches, as if it were happening, so the same checks hold every step
      void (async () => {
        let from = 0;
        while (from < lines.length && !closed) {
          let to = from, n = 0;
          while (to < lines.length && n < IMPORT_WORDS) n += lines[to++].text.split(/\s+/).length;
          const ok = await ask(lines.slice(from, to), lines.slice(Math.max(0, from - 10), from), false);
          if (closed) return;
          if (!ok) { meeting.error ||= 'Drawing the transcript stopped part way.'; save(); push(); return; }
          meeting.sent = from = to; save(); push();
        }
        if (!closed && await ask(lines.slice(-400), [], true)) { meeting.done = true; save(); push(); }
      })();
      return { count: lines.length };
    },
    /** what was said so far, for the tests and the map's file */
    said: () => said,
    /** resolves once the call under way, if any, has finished */
    idle: () => running || Promise.resolve(),
    close() { closed = true; if (timer) clearTimeout(timer); },
  };
}
