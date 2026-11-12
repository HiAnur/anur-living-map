import { describe, expect, it } from 'vitest';

import { earlierBoxes, keepIds } from './system-ids.js';

// A drawing made again, set against the one it replaces: which box is which.

const box = (/** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ repo = '') => ({ id, name, ...(repo ? { repo } : {}) });

describe('a box drawn again', () => {
  it('is the box of the same repo, whatever the agent calls it this time', () => {
    const before = [box('anur-living-map', 'anur-living-map', 'anur-living-map'), box('github', 'GitHub')];
    const drawn = { boxes: [box('repo', 'anur-living-map', 'anur-living-map'), box('github', 'GitHub')], lines: [{ from: 'repo', to: 'github', label: 'checks latest release' }] };
    expect(keepIds(before, drawn)).toEqual({
      boxes: [box('anur-living-map', 'anur-living-map', 'anur-living-map'), box('github', 'GitHub')],
      lines: [{ from: 'anur-living-map', to: 'github', label: 'checks latest release' }],
    });
  });

  it('is the box whose id differs only in punctuation, then the box of the same name', () => {
    const before = [box('team-live', 'Team server'), box('gcp-metadata', 'GCP metadata server'), box('login', 'Login')];
    const drawn = { boxes: [box('teamlive', 'Team map server'), box('gcpmeta', 'GCP Metadata Server'), box('signin', 'Sign in')], lines: [{ from: 'teamlive', to: 'gcpmeta' }, { from: 'signin', to: 'teamlive' }] };
    const kept = keepIds(before, drawn);
    expect(kept.boxes.map((b) => b.id)).toEqual(['team-live', 'gcp-metadata', 'signin']);
    expect(kept.boxes.map((b) => b.name)).toEqual(['Team map server', 'GCP Metadata Server', 'Sign in']);
    expect(kept.lines).toEqual([{ from: 'team-live', to: 'gcp-metadata' }, { from: 'signin', to: 'team-live' }]);
  });

  it('takes an earlier box once, and never one the new drawing already holds', () => {
    // two boxes of one name: the first takes the earlier id, the second keeps its own
    expect(keepIds([box('cache', 'Cache')], { boxes: [box('redis', 'Cache'), box('memcache', 'Cache')], lines: [] }).boxes.map((b) => b.id)).toEqual(['cache', 'memcache']);
    // `api` is drawn again as `api`: a second box named like it does not take its id
    expect(keepIds([box('api', 'API')], { boxes: [box('api', 'Public API'), box('gateway', 'API')], lines: [] }).boxes.map((b) => b.id)).toEqual(['api', 'gateway']);
    // a platform box with no repo never takes a repo's box by an empty match
    expect(keepIds([box('a', '', 'r1')], { boxes: [box('b', '')], lines: [] }).boxes.map((b) => b.id)).toEqual(['b']);
  });

  it('is left as drawn when nothing was drawn before, or nothing matches', () => {
    const drawn = { boxes: [box('a', 'A')], lines: [] };
    expect(keepIds(null, drawn)).toBe(drawn);
    expect(keepIds([], drawn)).toBe(drawn);
    expect(keepIds([box('z', 'Z')], drawn)).toBe(drawn);
  });
});

describe('what the agent is told of the earlier drawing', () => {
  it('names each earlier box by id and name, and says nothing when there was none', () => {
    expect(earlierBoxes([box('github', 'GitHub'), box('team-live', 'Team server')])).toContain('github (GitHub); team-live (Team server)');
    expect(earlierBoxes(null)).toBe('');
    expect(earlierBoxes([])).toBe('');
  });
});
