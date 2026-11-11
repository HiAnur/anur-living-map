import { describe, expect, it } from 'vitest';

import { wrapWords } from './page-words.js';

// A line's label wraps instead of covering its own line.

describe('wrapping a line\'s words', () => {
  it('keeps a short label on one line', () => {
    expect(wrapWords('reads and writes', 20)).toEqual(['reads and writes']);
  });
  it('breaks between words', () => {
    expect(wrapWords('calls user, strategizer, portfolio/trade', 20)).toEqual(['calls user,', 'strategizer,', 'portfolio/trade']);
  });
  it('breaks a long name where its parts begin, keeping the parts that fit together', () => {
    expect(wrapWords('invokes DiscordInteractionsLambda', 20)).toEqual(['invokes Discord', 'InteractionsLambda']);
    expect(wrapWords('invokes DiscordInteractionsLambda', 12)).toEqual(['invokes', 'Discord', 'Interactions', 'Lambda']);
  });
  it('cuts only a part still too long for a line', () => {
    expect(wrapWords('aaaaaaaaaaaaaaaaaaaaaaaaa', 10)).toEqual(['aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaa']);
  });
});
