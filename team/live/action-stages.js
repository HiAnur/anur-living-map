// Where an Action can be, and what may be asked of it from there. Every check of "may this happen now?" reads
// this one table, so a move that is not listed here cannot be allowed somewhere by accident.
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
  // its prerequisites are watched: it waits while one is unfinished, and is a draft again once all are done
  watch: ['draft', 'ready', 'waiting'],
};

/** @param {'start' | 'prepare' | 'answer' | 'revise' | 'execute' | 'continue' | 'stop' | 'cancel' | 'reopen' | 'watch'} ask @param {unknown} stage */
export const can = (ask, stage) => FROM[ask].includes(/** @type {string} */ (stage));

// handed to a run whose outcome never came back: it cannot be cancelled, and Execute first checks what happened
/** @param {unknown} stage */
export const handedOff = (stage) => stage === 'unconfirmed';
