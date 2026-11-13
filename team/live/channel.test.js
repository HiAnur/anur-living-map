import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { channelOf, tagsFor } from './channel.js';

// A copy follows releases unless it was asked to follow every passing build: customers never get a build nobody
// chose to release.
describe('the channel a copy follows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-channel-'));
  it('is stable unless asked for dev, by the environment or a file in the data folder', () => {
    expect(channelOf({}, dir)).toBe('stable');
    expect(channelOf({ ANUR_LIVING_MAP_CHANNEL: 'dev' }, dir)).toBe('dev');
    expect(channelOf({ ANUR_LIVING_MAP_CHANNEL: 'beta' }, dir)).toBe('stable');
    fs.writeFileSync(path.join(dir, 'channel'), 'DEV\n');
    expect(channelOf({}, dir)).toBe('dev');
    // the environment wins over the file
    expect(channelOf({ ANUR_LIVING_MAP_CHANNEL: 'stable' }, dir)).toBe('stable');
  });
  it('moves stable copies to releases only, and dev copies to every passing build and every release', () => {
    expect(tagsFor('stable')).toEqual(['v[0-9]*']);
    expect(tagsFor('dev')).toEqual(['dev-[0-9]*', 'v[0-9]*']);
  });
});
