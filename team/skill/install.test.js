// The team map's skill is copied whole into a test folder, never your own ~/.claude.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';

import { installTeamSkill } from './install.js';

test("the team map's skill is copied whole, its script still runnable, and again only when it differs", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lm-skill-')), 'anur-living-map');
  assert.equal(installTeamSkill({ dir }), 'installed');
  assert.match(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), /^---\nname: anur-living-map\n/);
  const script = path.join(dir, 'scripts', 'open-map.sh');
  assert.ok(fs.statSync(script).mode & 0o100, 'the script can be run');
  assert.equal(installTeamSkill({ dir }), 'unchanged');
  fs.writeFileSync(script, 'an older copy');
  assert.equal(installTeamSkill({ dir }), 'updated');
  assert.match(fs.readFileSync(script, 'utf8'), /^#!\/bin\/bash/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'scripts')), ['open-map.sh'], 'nothing left beside it');
});
