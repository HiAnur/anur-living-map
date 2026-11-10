import { describe, expect, it } from 'vitest';

import { can, handedOff, STAGES } from './action-stages.js';

// The whole table, written out: what may be asked of an Action in each stage. A change to action-stages.js that
// allows or forbids a move shows here as one cell.
const ASKS = /** @type {const} */ (['start', 'prepare', 'answer', 'revise', 'execute', 'continue', 'stop', 'cancel', 'reopen', 'watch']);
const ALLOWED = {
  //              start prepare answer revise execute continue stop   cancel reopen watch
  draft:        [true,  true,  false, false, false,  false,  false, true,  false, true],
  gathering:    [false, false, false, false, false,  false,  false, true,  false, false],
  clarify:      [false, true,  true,  false, false,  false,  false, true,  false, false],
  ready:        [false, true,  false, true,  true,   false,  false, true,  false, true],
  waiting:      [false, true,  false, false, false,  false,  false, true,  false, true],
  error:        [false, true,  false, false, false,  false,  false, true,  false, false],
  running:      [false, false, false, false, false,  false,  true,  false, false, false],
  finished:     [false, false, false, false, false,  true,   false, false, false, false],
  blocked:      [false, false, false, false, false,  true,   false, false, false, false],
  cancelled:    [false, false, false, false, false,  false,  false, false, true,  false],
  unconfirmed:  [false, false, false, false, true,   false,  false, false, false, false],
};

describe('what may be asked of an Action, by stage', () => {
  it('covers every stage', () => { expect(Object.keys(ALLOWED)).toEqual([...STAGES]); });
  for (const stage of STAGES) it(`${stage}`, () => {
    expect(ASKS.map((ask) => can(ask, stage))).toEqual(ALLOWED[stage]);
  });
  it('allows nothing from a stage it does not know, or from none', () => {
    for (const stage of [undefined, null, '', 'done', 7]) for (const ask of ASKS) expect(can(ask, stage)).toBe(false);
  });
  it('knows which Actions were handed off with no outcome back', () => {
    expect(STAGES.filter(handedOff)).toEqual(['unconfirmed']);
    expect(handedOff(undefined)).toBe(false);
  });
});
