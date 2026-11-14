// A meeting drawn live on a map. The Living Map Recorder (the Mac app) sends what was said as it hears it; the
// map keeps it in meeting.jsonl in its folder and, about once a minute of talk, after a pause, and at the end,
// asks the agent for one fresh answer with no tools (agent.answer: no tools, none of your settings, no
// connectors, no session kept): the map's instructions and memory, the meeting's boxes and lines, the last two
// minutes again and the new talk in, a fixed list of changes out. Words said in a meeting reach nothing but that
// prompt, so nobody on a call can make Claude act. meeting-draw.js checks every change against what was said
// before any of it is drawn, so what the map shows rests on code, not on the model following instructions. The
// talk counts as sent only once an answer has landed; a failed call is tried again later with the same talk.

import fs from 'node:fs';
import path from 'node:path';

import { personOf } from './draw.js';
import { checkMeetingOps, MEETING_ID, MEETING_SCHEMA, meetingInstructions, meetingPrompt } from './meeting-draw.js';
import { PROPOSE_SCHEMA } from './propose.js';

export const CHUNK_MS = 60_000;
export const SUMMARY_ID = 'meeting-summary';
export const CHUNK_WORDS = 220;
export const PAUSE_MS = 12_000;
// what came just before the new talk, shown again so a point that spans a minute boundary still reads whole
export const OVERLAP_MS = 120_000;
// the same for talk with no times (a pasted transcript): this many lines
const OVERLAP_LINES = 20;
// the most new talk one call carries, a few minutes of it: a pasted transcript, or talk that waited while Claude
// was signed out, goes a stretch at a time, so no call grows with the length of the meeting
export const STRETCH_WORDS = 600;
// what one meeting may spend on Claude, in US dollars, before the map stops asking (each answer reports its cost)
export const COST_CAP_USD = 20;
const MAX_SEGMENTS = 500;
const MAX_TEXT = 4000;
const MAX_IMPORT = 400_000;
// the end's last pass reads at most this much of the meeting
const LAST_PASS_CHARS = 60_000;
const RETRY_MS = 30_000;

// What the end-of-meeting pass may name: things the person recording said they will do. Claude only lists them;
// action-items.js decides each one (their own words, first person, a valid task, no duplicate) and makes the
// drafts, which the map then prepares as them.
const TASK = /** @type {any} */ (PROPOSE_SCHEMA).properties.nodes.items.properties.task;
export const ACTIONS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', additionalProperties: false, required: ['quote', 'title', 'task'],
        properties: {
          quote: { type: 'string', description: 'Their exact words, from a "You:" line, where they say they will do it.' },
          title: { type: 'string', description: 'Under 10 words: what they will do.' },
          sub: { type: 'string', description: 'One short line: by when, or for whom, if said.' },
          under: { type: 'string', description: 'The id of the meeting box it belongs under, from the list.' },
          task: TASK,
        },
      },
    },
  },
};
/** @param {string} by @param {string} title @param {{ id: string, label: string }[]} boxes @param {string[]} mine */
export const actionsPrompt = (by, title, boxes, mine) => [
  `The meeting "${title}" has ended. List each thing ${by || 'the person recording'} said they themselves will do, with a result someone could check (send, write, book, fix, decide…). Their lines are below, as speech recognition heard them.`,
  'Only their own commitments, in their own words: never what someone else will do, never a suggestion, and never your own idea. Quote their exact words. Fill in the task from what was said; leave out what was not. Most meetings have none or a few.',
  `\nTHE MEETING'S BOXES (id · title):\n${boxes.map((b) => `- ${b.id} · ${b.label}`).join('\n') || '(none)'}`,
  `\nWHAT ${(by || 'they').toUpperCase()} SAID:\n${mine.map((l) => `You: ${l}`).join('\n')}`,
].join('\n');

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
 *   fromWords?: (source: WordsSource, proposed: unknown) => ItemOutcome[],
 *   people?: () => string[], now?: () => number, pauseMs?: number, retryMs?: number, capUsd?: number }} o
 */
export function meetingJob({ home, memory = false, getState, save, push, answer, draw, say, fromWords, people = () => [], now = Date.now, pauseMs = PAUSE_MS, retryMs = RETRY_MS, capUsd = COST_CAP_USD }) {
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
  /** @returns {{ id: string, label: string, sub: string, kind: string, under: string, locked: boolean }[]} */
  const ownBoxes = () => {
    const meeting = m(), s = getState(), mine = new Set(meeting?.boxes || []);
    const parent = new Map((s.edges || []).filter((/** @type {any} */ e) => !e.label).map((/** @type {any} */ e) => [e.to, e.from]));
    return (s.nodes || []).filter((/** @type {any} */ n) => mine.has(n.id) && n.state !== 'gone').map((/** @type {any} */ n) => ({
      id: n.id, label: n.label, sub: n.sub || '', kind: meeting.kinds?.[n.id] || 'topic', under: parent.get(n.id) || MEETING_ID,
      locked: !!personOf(n),
    }));
  };
  // the rest of the map the call is shown: the team's instructions and memory for the whole map or the meeting's
  // boxes, and the labelled lines between those boxes
  const mapContext = () => {
    const s = getState(), mine = new Set([MEETING_ID, ...(m()?.boxes || [])]);
    const kept = (/** @type {string} */ kind) => (s.memory || []).filter((/** @type {any} */ x) => x?.kind === kind && (!x.box || mine.has(x.box)))
      .map((/** @type {any} */ x) => String(x.text || '').slice(0, 300)).filter(Boolean);
    const lines = (s.edges || []).filter((/** @type {any} */ e) => e.label && mine.has(e.from) && mine.has(e.to))
      .map((/** @type {any} */ e) => ({ from: String(e.from), to: String(e.to), label: String(e.label) }));
    return { rules: kept('instruction'), notes: kept('memory'), lines };
  };
  // Past the meeting's spending cap the map stops asking, says so once in the recorder's chat, and keeps the talk.
  // A cap is checked only in dollars; an agent that reports another unit is never stopped by it.
  const capped = () => { const c = m()?.cost; return !!c && c.unit === 'usd' && c.value >= capUsd; };
  const stopAtCap = () => {
    const meeting = m();
    if (!meeting || !capped()) return false;
    if (!meeting.capped) {
      meeting.capped = true;
      meeting.error = `This meeting reached its $${capUsd} limit for Claude, so the map stopped updating.`;
      say(meeting.by, `${meeting.error} What is said is still kept.`);
      save(); push();
    }
    return true;
  };

  // "Summary and next steps" under the meeting box, rebuilt by code from the meeting's decision and action
  // boxes after each step: no model writes it, so it lists exactly what the map holds
  const summarize = () => {
    const meeting = m(), boxes = ownBoxes();
    const decided = boxes.filter((b) => meeting.kinds?.[b.id] === 'decision'), todo = boxes.filter((b) => meeting.kinds?.[b.id] === 'action');
    if (!decided.length && !todo.length) return;
    const rest = (/** @type {string} */ sub, /** @type {string} */ word) => sub.replace(new RegExp(`^${word}(?: · )?`), '');
    const desc = [
      decided.length ? `Decided:\n${decided.map((b) => `- ${b.label}${rest(b.sub, 'Decided') ? ` — ${rest(b.sub, 'Decided')}` : ''}`).join('\n')}` : '',
      todo.length ? `Next steps:\n${todo.map((b) => `- ${b.label}${rest(b.sub, 'Action') ? ` (${rest(b.sub, 'Action')})` : ''}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    const had = (getState().nodes || []).some((/** @type {any} */ n) => n.id === SUMMARY_ID);
    draw({ nodes: [{ id: SUMMARY_ID, label: 'Summary and next steps', sub: `${decided.length} decided · ${todo.length} to do`, desc: desc.slice(0, 1500) }],
      edges: had ? [] : [{ from: MEETING_ID, to: SUMMARY_ID }] });
  };

  // Once the meeting is over: what the person recording said they will do becomes their Action drafts, through
  // action-items.js. Only their own lines are the source, and only when the name the recorder sends is one of
  // the map's people; otherwise nothing is made and they are told why.
  async function actionPass() {
    const meeting = m();
    if (!fromWords || !meeting || meeting.actionsDone || stopAtCap()) return;
    meeting.actionsDone = true; save();
    const by = String(meeting.by || ''), mine = said.filter((s) => s.speaker === 'you').map((s) => s.text);
    if (!mine.length) return;
    if (!people().includes(by)) {
      say(by, `No Action drafts from this meeting: "${by}" is not one of this map's people. Set your name in the recorder to match your sign-in.`);
      return;
    }
    const r = await answer({ prompt: actionsPrompt(by, getState().title, ownBoxes(), mine), schema: ACTIONS_SCHEMA });
    if (closed) return;
    if (r.cost) meeting.cost = { value: (meeting.cost?.value || 0) + r.cost.value, unit: r.cost.unit };
    const items = /** @type {any} */ (r.value)?.items;
    if (!Array.isArray(items) || !items.length) { save(); push(); return; }
    const out = fromWords({ kind: 'meeting', id: `meeting:${getState().title}:${meeting.at}`, who: by, lines: mine, spoken: true }, items);
    meeting.actions = out.map((o) => ({ title: o.title, ...('made' in o ? { made: o.made } : 'info' in o ? { for: o.for } : 'merged' in o ? { merged: o.merged } : { refused: o.refused }) }));
    const made = out.filter((o) => 'made' in o);
    if (made.length) say(by, `Made ${made.length} Action draft${made.length === 1 ? '' : 's'} from what you said, now preparing (check they're yours): ${made.map((o) => o.title).join('; ')}.`);
    save(); push();
  }

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
      if (capped()) return round > 0;
      const shown = { ...mapContext(), boxes: ownBoxes(), before: before.length ? chunkText(before) : '', now: chunkText(lines), last, retry };
      const prompt = `${meetingInstructions(meeting.by, s.title)}\n\n${meetingPrompt(shown)}`;
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
    if (drawn) summarize();
    if (summary || drawn) say(meeting.by, `${summary || `Updated ${drawn} box${drawn === 1 ? '' : 'es'}.`}`);
    return true;
  }

  // How much of the talk may go now: what is waiting once a minute's worth is, after a pause, or at the end, at
  // most a stretch per call. One call at a time; what arrives meanwhile goes in the next. The talk counts as sent
  // only once its answer landed, so a failed call loses nothing: it is tried again later with the same talk.
  let ready = 0;
  async function run() {
    const meeting = m();
    if (!meeting || closed || stopAtCap()) return;
    const end = Math.min(ready, said.length), from = meeting.sent;
    if (end > from) {
      let to = from, n = 0;
      while (to < end && n < STRETCH_WORDS) n += wordsIn([said[to++]]);
      const lines = said.slice(from, to), start = lines[0].start;
      const before = start ? said.slice(0, from).filter((x) => x.start && start - x.start <= OVERLAP_MS) : said.slice(Math.max(0, from - OVERLAP_LINES), from);
      const ok = await ask(lines, before, false);
      if (closed) return;
      if (ok) meeting.sent = to;
      save(); push();
      if (!ok) { if (!stopAtCap()) later(go, retryMs); return; }
    }
    if (lastPassDue && meeting.sent >= said.length) {
      lastPassDue = false;
      let text = 0; const all = [];
      for (let i = said.length - 1; i >= 0 && text < LAST_PASS_CHARS; i--) { all.unshift(said[i]); text += said[i].text.length; }
      const ok = all.length ? await ask(all, [], true) : true;
      if (closed) return;
      if (ok) { meeting.done = true; save(); push(); await actionPass(); } else { lastPassDue = true; if (!stopAtCap()) later(go, retryMs); }
    }
  }
  function go() {
    if (running || closed) return;
    running = run().finally(() => {
      running = null;
      const meeting = m();
      if (meeting && !closed && !timer && !capped() && (meeting.sent < Math.min(ready, said.length) || (lastPassDue && meeting.sent >= said.length))) go();
    });
  }
  // after a restart, talk that was never sent goes as soon as the map is up, and an ended meeting gets its last pass
  const was = getState().meeting;
  if (was && !was.done && (was.sent < said.length || (!was.live && said.length))) {
    ready = said.length;
    if (!was.live) lastPassDue = true;
    setTimeout(go, 0).unref?.();
  }

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
      // the same path as live talk, a stretch at a time, so the same checks and retries hold every step
      ready = said.length; lastPassDue = true;
      go();
      return { count: lines.length };
    },
    /** what was said so far, for the tests and the map's file */
    said: () => said,
    /** resolves once no call is under way, including the next stretch a finished one starts */
    async idle() { while (running) await running; },
    close() { closed = true; if (timer) clearTimeout(timer); },
  };
}
