// Action drafts from a person's own words. Wherever Claude hears someone commit to something (a meeting they
// recorded, their own chat with Claude), it only proposes the item; this module is the one place that decides
// whether it becomes an Action draft, an info box naming someone else, a note on a box already there, or nothing.
//
// The entry point, for a chat's tool and a meeting's end:
//
//   items.fromWords(source, proposed) → ItemOutcome[]   (openMap hands it out as map.fromWords)
//     source    WordsSource (types.d.ts): { kind, id, who, lines, spoken? }
//               who     whose words these are, one of the map's people: the caller knows it from where the words
//                       came from (the linked chat's owner, the meeting's recorder), never from a name Claude wrote
//               lines   only that person's own words: nothing Claude, a tool, a web page or anyone else said
//               id      what the cap per source counts by: one meeting, or "chat:<session>:<day>" for one chat a day
//               spoken  speech, matched loosely; typed text must hold the quote as it was written
//     proposed  what Claude sent, one { quote, title, sub?, under?, task, owner? } per item, trusted for nothing
//     outcome   per item, in order: { title, made } | { title, info, for } | { title, merged } | { title, refused }
//
// checkItem decides each item, by these checks in order; each can only refuse:
//   1. the quote is in `lines` (exactly for typed text; for speech, 80% of its longer words in one line or two)
//   2. its author is `who`; an `owner` naming anyone else makes an info box for them (`for`, set by code), else the
//      quote must say the speaker will do it ("I'll", "I will", "let me", "on me"…)
//   3. its task passes readPlannedTask, then readiness is "needs_information" and it waits on nothing
//   4. it is not on the map's refused list (Not an action, Not mine)
//   5. it is not a duplicate of the person's Actions and action items they can see (sameThing): the quote is added
//      to that box instead
//   6. it goes under `under` when the person can use that box, else under a box code keeps for their items
//   7. at most PER_PASS boxes a pass and PER_SOURCE from one source
// A draft is made through actions.begin with `from`, so who may do what with it is as for any Action, and Run on its
// own stays off. The map then prepares it as its author, at most AT_ONCE at a time per person (pump): preparation
// only reads and stops at Ready to execute or Needs clarity; Execute stays the author's click. Every outcome goes
// into the map's log with its reason.
import { note } from './action-box.js';
import { readPlannedTask } from './action-plan.js';
import { sameThing } from './name-words.js';

export const PER_PASS = 5, PER_SOURCE = 20, AT_ONCE = 3;
/** `for` on an item for the whole team or no one in particular: anyone who can see it may take it on. */
export const TEAM = '*';
const KINDS = ['meeting', 'chat', 'prompt'];

/** Text as quotes are compared: lower case, straight quotes, single spaces. @param {unknown} t */
const loose = (t) => String(t ?? '').toLowerCase().replace(/[‘’ʼ]/g, '\'').replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
/** A quote without the marks and stops Claude puts around it. @param {unknown} t */
const bare = (t) => loose(t).replace(/^[\s"'.,;:!?…-]+|[\s"'.,;:!?…-]+$/g, '');
/** The words of a quote that tell it apart, as the chat map's quote check reads them. @param {string} t */
const longer = (t) => t.split(/[^a-z0-9']+/).filter((w) => w.length > 2);

/**
 * Whether `quote` is in one of `lines`: as written, or, for speech, which a transcript mishears, with 80% of its
 * longer words (at least 4 of them) in one line or two lines running.
 * @param {string} quote @param {string[]} lines @param {boolean} spoken
 */
export function quotedIn(quote, lines, spoken) {
  const q = bare(quote), said = lines.map(loose);
  if (q.length < 6) return false;
  if (said.some((l) => l.includes(q))) return true;
  if (!spoken) return false;
  const words = longer(q);
  if (words.length < 4) return false;
  const near = said.flatMap((l, i) => [l, `${l} ${said[i + 1] || ''}`]);
  return near.some((l) => { const have = new Set(longer(l)); return words.filter((w) => have.has(w)).length / words.length >= 0.8; });
}

/** Whether the words say the speaker will do it: "Dan will send it", said by you, is not yours. */
export const FIRST_PERSON = /(^|[^a-z'])(i'll|i will|i shall|i'm going to|i am going to|i'm gonna|i'm on it|let me|on me|leave (it|that|this) (with|to) me|i need to|i have to|i must)($|[^a-z'])/;
/** @param {string} quote */
export const firstPerson = (quote) => FIRST_PERSON.test(loose(quote));

const SELF = new Set(['', 'me', 'i', 'you', 'myself', 'yourself']);
const ANYONE = new Set(['team', 'the team', 'everyone', 'everybody', 'all', 'us', 'we', 'anyone', 'anybody', 'no one', 'nobody', 'none', 'unassigned']);
/**
 * Whom an item is for, from the `owner` Claude named: '' for the speaker, TEAM for the team or no one, else one of
 * the map's people it names, else the name as said.
 * @param {unknown} owner @param {string} who @param {string[]} people
 */
export function ownerOf(owner, who, people) {
  const o = loose(owner);
  if (SELF.has(o) || o === loose(who)) return '';
  if (ANYONE.has(o)) return TEAM;
  const known = people.find((p) => { const l = loose(p); return l === o || l.split('@')[0] === o || l.split(/[\s@.]/)[0] === o; });
  if (known === who) return '';
  return known || String(owner).trim().slice(0, 80);
}

/**
 * The task Claude filled in, as the map keeps it: what readPlannedTask passes, made to need information and wait
 * on nothing, so it never prepares itself when other Actions finish. A blocker that names no one is left out.
 * @param {any} value
 */
export function taskFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const blockers = Array.isArray(value.blockers) ? value.blockers.filter((/** @type {any} */ b) => typeof b?.resolver === 'string' && b.resolver.trim()) : value.blockers;
  const plan = readPlannedTask({ ...value, blockers });
  return plan && { ...plan, readiness: 'needs_information', dependsOn: [] };
}

/** @param {unknown} v @param {number} max */
const text = (v, max) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '';

/** @typedef {{ quote: string, title: string, by: string, at: number }} Refusal */
/**
 * @typedef {{ refused: string }
 *   | { merge: Box, quote: string }
 *   | { make: { title: string, sub: string, under: string | null, task: NonNullable<ReturnType<typeof taskFrom>>, quote: string, for: string } }} ItemCheck
 */

/**
 * One item Claude proposed from `source`, checked against the map as it is (see the top of this file).
 * @param {unknown} raw what Claude sent
 * @param {WordsSource} source
 * @param {{ people: string[], refused: Refusal[], boxes: Box[], canPlace: (id: string) => boolean, made: { pass: number, source: number } }} map
 *   people: the map's people; boxes: the person's Actions and action items they can see; made: boxes made so far
 * @returns {ItemCheck}
 */
export function checkItem(raw, source, map) {
  const item = /** @type {any} */ (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  const quote = text(item.quote, 500), title = text(item.title, 80);
  if (!quote || !title) return { refused: 'It needs a quote and a title.' };
  if (!quotedIn(quote, source.lines, !!source.spoken)) return { refused: `The quote is not in ${source.who}'s own words here.` };
  const owner = ownerOf(item.owner, source.who, map.people);
  if (!owner && !firstPerson(quote)) return { refused: 'The quote does not say the speaker will do it ("I\'ll", "I will", "let me", "on me").' };
  const task = taskFrom(item.task);
  if (!task) return { refused: 'Its task needs a goal, a result, at least one step and how to know it is done.' };
  if (map.refused.some((r) => bare(r.quote) === bare(quote) || (r.by === source.who && sameThing(r.title, title)))) return { refused: 'It was said not to be an action, or not theirs, before.' };
  const same = map.boxes.find((n) => sameThing(n.label, title));
  if (same) return { merge: same, quote };
  if (map.made.pass >= PER_PASS) return { refused: `Over the limit of ${PER_PASS} a pass.` };
  if (map.made.source >= PER_SOURCE) return { refused: `Over the limit of ${PER_SOURCE} from one ${source.kind}.` };
  const under = typeof item.under === 'string' && map.canPlace(item.under) ? item.under : null;
  return { make: { title, sub: text(item.sub, 240), under, task, quote, for: owner } };
}

/** The second line of an item for someone else: their name first. @param {string} who @param {string} [sub] */
const forLine = (who, sub = '') => `${who === TEAM ? 'For the team' : `For ${who}`}${sub && !/^For /.test(sub) ? ` · ${sub}` : ''}`.slice(0, 240);

/**
 * The map's side of action items: making them from words, saying no to one, taking one on, and preparing drafts.
 * @param {{ getState: () => MapState, nodeOf: (id: any) => any, allNodes: () => Box[], canUse: (n: Box, by?: string) => boolean,
 *   actions: ReturnType<typeof import('./action-box.js').actionBoxes>, draw: (p: any, by: any, source: any) => void,
 *   tell: (text: string) => void }} deps
 */
export function actionItems({ getState, nodeOf, allNodes, canUse, actions, draw, tell }) {
  const people = () => (getState().people || []).map((p) => p.id).filter((id) => id && !(getState().removedPeople || []).includes(id));
  /** @param {string} who @param {string} result @param {string} why @param {Record<string, unknown>} [more] */
  const log = (who, result, why, more = {}) => { (getState().log ||= []).push({ at: Date.now(), who, action: 'action item', result, why, ...more }); };
  /** @param {string} quote @param {string} title @param {string} by */
  const refuse = (quote, title, by) => { getState().refusedItems = [...(getState().refusedItems || []), { quote, title, by, at: Date.now() }].slice(-500); };
  const clock = () => new Date().toTimeString().slice(0, 5);
  /** @param {string} name */
  const freeId = (name) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';
    let id = base;
    for (let i = 2; nodeOf(id) || getState().archived?.some((/** @type {any} */ x) => x.box.id === id); i++) id = `${base}-${i}`;
    return id;
  };
  // the box a person's items go under when Claude named none they can use, made once, at the top of the map
  /** @param {string} who */
  function itemsBox(who) {
    const had = allNodes().find((n) => n.itemsFor === who && canUse(n, who));
    if (had) return had.id;
    const id = freeId(`${who} action items`), start = getState().start;
    draw({ nodes: [{ id, label: `${who}'s action items`.slice(0, 80), sub: 'Action drafts made from their own words' }], edges: start && nodeOf(start) ? [{ from: start, to: id }] : [] }, who, { kind: 'words' });
    const n = nodeOf(id);
    if (!n) return null;
    n.itemsFor = who;
    return id;
  }

  /** @param {WordsSource} source @param {unknown} proposed @returns {ItemOutcome[]} */
  function fromWords(source, proposed) {
    const list = (Array.isArray(proposed) ? proposed : []).slice(0, 50);
    const title = (/** @type {any} */ raw) => text(raw?.title, 80);
    const who = typeof source?.who === 'string' ? source.who : '';
    const src = /** @type {WordsSource} */ ({ kind: source?.kind, id: text(source?.id, 200), who, lines: Array.isArray(source?.lines) ? source.lines.filter((l) => typeof l === 'string') : [], spoken: source?.spoken === true });
    const wrong = !KINDS.includes(src.kind) || !src.id ? 'The words came from nowhere the map knows.'
      : !people().includes(who) ? `${who || 'Nobody'} is not someone on this map.` : '';
    if (wrong) return list.map((raw) => { log(who, 'refused', wrong, { title: title(raw) }); return { title: title(raw), refused: wrong }; });
    const st = getState(), sources = (st.itemSources ||= {});
    /** @type {ItemOutcome[]} */ const out = [];
    let pass = 0;
    for (const raw of list) {
      const theirs = allNodes().filter((n) => !n.proposed && canUse(n, who) && (n.action?.by === who || n.for));
      const r = checkItem(raw, src, { people: people(), refused: st.refusedItems || [], boxes: theirs, made: { pass, source: sources[src.id] || 0 },
        canPlace: (id) => { const n = nodeOf(id); return !!n && !n.proposed && canUse(n, who); } });
      const named = title(raw);
      if ('refused' in r) { log(who, 'refused', r.refused, { title: named, from: src.kind }); out.push({ title: named, refused: r.refused }); continue; }
      if ('merge' in r) {
        // said again: kept with what is there, never a second box. An Action keeps it in its history, so a ready
        // brief is not made stale by a change to its box
        if (r.merge.action) note(r.merge.action, 'said again', who, { quote: r.quote });
        else r.merge.desc = `${r.merge.desc ? `${r.merge.desc}\n` : ''}Said again, ${clock()}: "${r.quote}"`;
        log(who, 'merged', `The same as ${r.merge.label}.`, { node: r.merge.id, title: named, from: src.kind });
        out.push({ title: named, merged: r.merge.id }); continue;
      }
      const m = r.make, under = m.under || itemsBox(who), id = freeId(m.title);
      draw({ nodes: [{ id, label: m.title, ...(m.for ? { sub: forLine(m.for, m.sub) } : m.sub ? { sub: m.sub } : {}) }], edges: under ? [{ from: under, to: id }] : [] }, who, { kind: 'words', from: src.kind });
      const n = nodeOf(id), from = { kind: src.kind, quote: m.quote, at: Date.now() };
      if (n && m.for) Object.assign(n, { for: m.for, task: m.task, from: { ...from, said: who } });
      else if (!n || !actions.begin(id, who, m.task, { notify: false, from })) {
        if (n) removeBox(id);
        log(who, 'refused', 'It could not be put on the map.', { title: named, from: src.kind });
        out.push({ title: named, refused: 'It could not be put on the map.' }); continue;
      } else n.action.autoPrepare = { at: Date.now(), why: 'words' };
      pass++; sources[src.id] = (sources[src.id] || 0) + 1;
      log(who, m.for ? 'info box' : 'made', m.for ? `For ${m.for === TEAM ? 'the team' : m.for}, in ${who}'s words.` : `In ${who}'s own words.`, { node: id, title: m.title, from: src.kind });
      out.push(m.for ? { title: m.title, info: id, for: m.for } : { title: m.title, made: id });
    }
    const made = out.filter((o) => 'made' in o || 'info' in o);
    if (made.length) tell(`Made ${made.length === 1 ? 'an action item' : `${made.length} action items`} from ${who}'s words: ${made.map((o) => o.title).join('; ')}`);
    pump();
    return out;
  }
  /** @param {string} id */
  function removeBox(id) {
    const st = getState();
    st.nodes = st.nodes.filter((n) => n.id !== id);
    st.edges = st.edges.filter((e) => e.from !== id && e.to !== id);
  }

  // Not an action: the draft goes back to an Info box, and its words are never made into one again
  /** @param {string} id @param {string} by */
  function notAction(id, by) {
    const n = nodeOf(id), a = actions.unmake(id, by);
    if (!a) return false;
    refuse(String(a.from?.quote), n.label, by);
    log(by, 'undone', 'Not an action.', { node: id, title: n.label });
    tell(`${by} said ${n.label} is not an action`);
    return true;
  }
  // Not mine: the same, and the box names whose it is, one of the map's people or the team, who can take it on
  /** @param {string} id @param {string} by @param {string} to */
  function notMine(id, by, to) {
    if (to !== TEAM && (to === by || !people().includes(to))) return false;
    const n = nodeOf(id), a = actions.unmake(id, by);
    if (!a) return false;
    Object.assign(n, { for: to, ...(a.plan ? { task: a.plan } : {}), from: { ...a.from, said: by } });
    n.sub = forLine(to, n.sub);
    refuse(String(a.from?.quote), n.label, by);
    log(by, 'undone', `Not theirs: for ${to === TEAM ? 'the team' : to}.`, { node: id, title: n.label });
    tell(`${by} said ${n.label} is for ${to === TEAM ? 'the team' : to}`);
    return true;
  }
  // Take it on: the person an item names, or anyone who can see one for the team or no one, makes it their draft,
  // with the task kept on the box; the first to press it is its author
  /** @param {string} id @param {string} by */
  function takeOn(id, by) {
    const n = nodeOf(id);
    if (!n || n.action || n.proposed || !n.for || !n.task || !canUse(n, by) || (n.for !== by && n.for !== TEAM)) return false;
    /** @type {ActionFrom} */
    const from = { kind: n.from?.kind || 'map', at: Date.now(), took: true, ...(n.from?.quote ? { quote: n.from.quote } : {}), ...(n.from?.said ? { said: n.from.said } : {}) };
    if (!actions.begin(id, by, n.task, { notify: false, from })) return false;
    delete n.for; delete n.task; delete n.from;
    n.action.autoPrepare = { at: Date.now(), why: 'taken' };
    log(by, 'taken on', `${by} took it on.`, { node: id, title: n.label });
    tell(`${by} took on ${n.label}`);
    pump();
    return true;
  }

  // The drafts waiting to be prepared, oldest first, as their authors, while each has fewer than AT_ONCE preparing,
  // so a long meeting does not start many at once. Called whenever an Action changes, so a finished preparation
  // makes room for the next.
  let pumping = false, again = false;
  function pump() {
    if (pumping) { again = true; return; }
    pumping = true;
    try {
      do {
        again = false;
        const nodes = allNodes(), busy = new Map();
        for (const n of nodes) if (n.action?.stage === 'gathering') busy.set(n.action.by, (busy.get(n.action.by) || 0) + 1);
        const waiting = nodes.filter((n) => n.action?.autoPrepare && n.action.stage === 'draft').sort((x, y) => x.action?.autoPrepare.at - y.action?.autoPrepare.at);
        for (const n of waiting) {
          const a = /** @type {BoxAction} */ (n.action), by = a.by, why = a.autoPrepare.why;
          if ((busy.get(by) || 0) >= AT_ONCE) continue;
          delete a.autoPrepare;
          if (actions.prepare(n.id, by, undefined, 'Map', { auto: why })) {
            busy.set(by, (busy.get(by) || 0) + 1);
            log(by, 'prepared', why === 'taken' ? 'Prepared automatically, once taken on.' : 'Prepared automatically, from their words.', { node: n.id, title: n.label });
          } else log(by, 'not prepared', 'Preparation could not start.', { node: n.id, title: n.label });
        }
      } while (again);
    } finally { pumping = false; }
  }

  return { fromWords, notAction, notMine, takeOn, pump };
}
