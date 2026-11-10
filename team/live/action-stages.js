// Where an Action can be, and what may be asked of it from there. Every check of "may this happen now?" reads
// this one table, on the server and on the page, so a move that is not listed here cannot be allowed somewhere by
// accident. It is a page module too (see page-modules.js): it imports nothing.
//
//   draft ──start──► gathering ──► clarify ──answer──► gathering
//                        │            ▲
//                        ▼            └──revise── ready ──execute──► running ──► finished
//                      error                        │                   │           │
//                                                   └► waiting          └► blocked ◄┘ (continue ► running)
//
// A prerequisite that is not finished holds a draft, a ready or a waiting Action at `waiting`. Before it runs, an
// Action can be cancelled: it keeps everything it had at `cancelled`, and reopening it makes it a draft again with
// its instructions. An Action a run never reported back on is `unconfirmed`.

export const STAGES = /** @type {const} */ (['draft', 'gathering', 'clarify', 'ready', 'waiting', 'error', 'running', 'finished', 'blocked', 'cancelled', 'unconfirmed']);

/** @type {Record<string, readonly string[]>} what may be asked → the stages it may be asked from */
const FROM = {
  start: ['draft'],
  // gather what the Action needs, again after an answer, an error, a wait or a change of mind
  prepare: ['draft', 'clarify', 'ready', 'error', 'waiting'],
  answer: ['clarify'],
  revise: ['ready'],
  // unconfirmed: a run whose outcome never came back is checked and picked up, not started twice
  execute: ['ready', 'unconfirmed'],
  continue: ['finished', 'blocked'],
  stop: ['running'],
  // anything before a run; once it has run, what it did stays on the map
  cancel: ['draft', 'gathering', 'clarify', 'ready', 'waiting', 'error'],
  reopen: ['cancelled'],
  // the author confirms a run whose completion code could not verify
  confirm: ['finished'],
  // its prerequisites are watched: it waits while one is unfinished, and is a draft again once all are done
  watch: ['draft', 'ready', 'waiting'],
  // its box is deleted only before it runs; once it has run, its box is archived, and what it did is kept
  remove: ['draft', 'clarify', 'ready', 'waiting', 'error', 'cancelled'],
  archive: ['finished', 'blocked', 'unconfirmed'],
};

/** @param {'start' | 'prepare' | 'answer' | 'revise' | 'execute' | 'continue' | 'stop' | 'cancel' | 'reopen' | 'confirm' | 'watch' | 'remove' | 'archive'} ask @param {unknown} stage */
export const can = (ask, stage) => FROM[ask].includes(/** @type {string} */ (stage));

// handed to a run whose outcome never came back: it cannot be cancelled, and Execute first checks what happened
/** @param {unknown} stage */
export const handedOff = (stage) => stage === 'unconfirmed';

// Before it runs, an Action can be cancelled, unless it was handed to a run that never reported back.
/** @param {any} a */
export const actionCancellable = (a) => !!a && !a.session && can('cancel', a.stage);

// How its box may leave the map, for this person: 'remove' before it runs, 'archive' once it has, or why not.
// Only its author or an Admin may take it off, and never while Claude prepares or runs it.
/** @param {any} a @param {string | undefined} me @param {boolean} admin */
export function actionLeaving(a, me, admin) {
  if (!a) return 'remove';
  if (a.by !== me && !admin) return `Only ${a.by}, who started its Action, or an Admin can take this box off the map.`;
  if (a.stage === 'running') return 'Its Action is running. Stop it first.';
  if (a.stage === 'gathering') return 'Claude is preparing its Action. Cancel it first.';
  if (can('remove', a.stage)) return 'remove';
  if (can('archive', a.stage)) return 'archive';
  return 'Its Action cannot be taken off the map from where it stands.';
}
