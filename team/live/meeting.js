// A meeting drawn live on a map. The Living Map Recorder (the Mac app in mac/) sends what was said as it hears it;
// the map keeps it in meeting.jsonl in its folder and hands it, about once a minute of talk, to the map's own
// headless chat (converse in server.js), which draws the meeting on the map with living_map_change. A pause of
// PAUSE_MS sends what is waiting; the end sends the rest and asks for a last pass. A transcript pasted after the
// meeting goes in one message.

import fs from 'node:fs';
import path from 'node:path';

export const CHUNK_MS = 60_000;
export const CHUNK_WORDS = 220;
export const PAUSE_MS = 12_000;
const MAX_SEGMENTS = 500;
const MAX_TEXT = 4000;
const MAX_IMPORT = 400_000;

/** @typedef {{ speaker: 'you' | 'others', name?: string, text: string, start: number, end: number }} Said */

/** What the map's chat is told it is doing, on a meeting map. @param {string} name @param {string} by */
export function meetingBrief(name, by) {
  return [
    `You are drawing a live map of a meeting on Living Map, the team's shared map on this Mac. This map is "${name}": pass map: "${name}" to living_map_read and living_map_change.`,
    `You are sent what was said, about a minute at a time, as it happens. Lines starting "You:" are ${by || 'the person recording'}, on their microphone; lines starting "Others:" or a person's name are everyone else on the call. The words come from speech recognition: read past misheard words, and never put a misheard phrase on the map as a fact.`,
    'Keep the map a picture of the meeting someone who missed it could read in a minute: a box for each topic discussed, and inside or linked to it boxes for what was decided (say why on the second line), action items (who does it, and by when if said), open questions, and facts that matter later (numbers, dates, constraints). Lines say how boxes relate, in a few words.',
    'Each time, read the map first (living_map_read) and change what is there before adding: people come back to a point in new words. A question answered or an item settled later is updated on its box, not drawn again. Skip greetings, small talk and audio trouble. Never invent: if it was not said, it is not on the map.',
    'Read, never act: do not send, post, book, buy, or change anything outside this map.',
    'Your replies show in the chat beside the map: say in one or two short lines what you changed.',
  ].join('\n');
}

/** "HH:MM" in this Mac's time, or '' for no time. @param {number} t */
const clock = (t) => (t ? new Date(t).toTimeString().slice(0, 5) : '');
/** One line of the transcript as the chat reads it. @param {Said} s */
export const lineOf = (s) => `${s.speaker === 'you' ? 'You' : s.name || 'Others'}: ${s.text}`;
/** @param {Said[]} said */
const wordsIn = (said) => said.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);

/** A stretch of talk as one message to the chat: when it was, then what was said. @param {Said[]} said */
export function chunkText(said) {
  const from = clock(said[0]?.start || 0), to = clock(said.at(-1)?.end || 0);
  const when = from ? ` (${from}${to && to !== from ? `–${to}` : ''})` : '';
  return `Said in the meeting${when}:\n${said.map(lineOf).join('\n')}`;
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
 * One map's meeting. `send` hands a message to the map's chat, which queues it while it is busy.
 * @param {{ home: string, memory?: boolean, getState: () => any, save: () => void, push: () => void,
 *   send: (text: string) => void, now?: () => number, pauseMs?: number }} o
 */
export function meetingJob({ home, memory = false, getState, save, push, send, now = Date.now, pauseMs = PAUSE_MS }) {
  const FILE = path.join(home, 'meeting.jsonl');
  /** @type {Said[]} */ let said = [];
  try { if (!memory) said = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { /* no meeting on this map yet: nothing said */ }
  /** @type {ReturnType<typeof setTimeout> | null} */ let timer = null;
  const m = () => getState().meeting;

  /** @param {Said[]} lines */
  const keep = (lines) => {
    said.push(...lines);
    if (memory || !lines.length) return;
    fs.mkdirSync(home, { recursive: true });
    fs.appendFileSync(FILE, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  };
  // what is waiting goes to the chat; the first message says what the meeting is
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const meeting = m();
    if (!meeting || meeting.sent >= said.length) return;
    const lines = said.slice(meeting.sent);
    const first = meeting.sent === 0;
    meeting.sent = said.length; save();
    send(`${first ? `The meeting "${getState().title}" started at ${clock(meeting.at)}${meeting.app ? ` on ${meeting.app}` : ''}.\n\n` : ''}${chunkText(lines)}`);
  };

  return {
    /** @param {{ title: string, app?: string, by: string }} o */
    start({ title, app = '', by }) {
      const s = getState();
      s.title = s.renamed = title;
      s.meeting = { at: now(), app, by, live: true, sent: 0 };
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
      const waiting = said.slice(meeting.sent);
      const last = waiting.at(-1);
      if (last && (last.end - waiting[0].start >= CHUNK_MS || wordsIn(waiting) >= CHUNK_WORDS)) flush();
      else if (waiting.length) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, pauseMs);
        timer.unref?.();
      }
      return { count: lines.length };
    },
    // the rest goes, then a last pass over the whole map
    end() {
      const meeting = m();
      if (!meeting) return { error: 'This map is not a meeting.' };
      if (!meeting.live) return {};
      flush();
      meeting.live = false; meeting.ended = now(); save(); push();
      if (said.length) send('The meeting has ended. Make a last pass over the map: settle what the meeting settled, make sure every action item says who and by when if it was said, and leave open only what is still open.');
      return {};
    },
    /** @param {{ title: string, text: string, me?: string, by: string }} o @returns {{ count?: number, error?: string }} */
    importText({ title, text, me = '', by }) {
      const lines = parseTranscript(String(text || '').slice(0, MAX_IMPORT), me);
      if (!lines.length) return { error: 'The transcript has no words.' };
      const s = getState();
      s.title = s.renamed = title;
      s.meeting = { at: now(), by, live: false, imported: true, ended: now(), sent: lines.length };
      keep(lines); save(); push();
      send(`This is the whole transcript of a meeting, "${title}", that has already happened. Draw it on the map.\n\n${lines.map(lineOf).join('\n')}`);
      return { count: lines.length };
    },
    /** what was said so far, for the tests and the map's file */
    said: () => said,
    close() { if (timer) clearTimeout(timer); },
  };
}
