import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { dataDir } from './data-dir.js';

// The team map's data folder: its own name, apart from the chat map's, and an older install's folder kept as it
// is. The skill's script picks the same folder the same way.
const home = (/** @type {string[]} */ ...folders) => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-data-'));
  for (const f of folders) fs.mkdirSync(path.join(h, f));
  return h;
};
const script = fs.readFileSync(new URL('../skill/anur-living-map/scripts/open-map.sh', import.meta.url), 'utf8');
// the script's own lines that pick the folder, run as they are
const pick = script.split('\n').filter((l) => /^D=/.test(l)).join('\n');
const fromScript = (/** @type {string} */ h) => execFileSync('/bin/sh', ['-c', `${pick}\nprintf %s "$D"`], { env: { ...process.env, HOME: h }, encoding: 'utf8' });

describe('the team map\'s data folder', () => {
  for (const [what, folders, picked] of /** @type {[string, string[], string][]} */ ([
    ['a new install', [], '.anur-living-map'],
    ['an install from before', ['.living-map-2'], '.living-map-2'],
    ['one that has both', ['.living-map-2', '.anur-living-map'], '.anur-living-map'],
    ['beside the chat map', ['.living-map'], '.anur-living-map'],
  ])) it(`is ${picked} for ${what}, in the server and the skill alike`, () => {
    const h = home(...folders);
    expect(dataDir(h, {})).toBe(path.join(h, picked));
    expect(fromScript(h)).toBe(path.join(h, picked));
  });
  it('is the folder ANUR_LIVING_MAP_DATA names, for an app that starts the server itself', () => {
    const h = home('.anur-living-map'), mine = path.join(h, 'app-data');
    expect(dataDir(h, { ANUR_LIVING_MAP_DATA: mine })).toBe(mine);
  });
  it('is picked by the script in one place', () => expect(pick.split('\n')).toHaveLength(1));
});
