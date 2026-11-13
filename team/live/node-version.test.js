import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { nodeTooOld } from './node-version.js';
import { copySkill } from './skill-copy.js';

// What `npx anur-living-map` checks and installs before it starts the map.
it('turns away a Node without node:sqlite unflagged or import.meta.main, and takes every one with both', () => {
  for (const v of ['20.19.0', '22.5.0', '22.12.0', '22.13.0', '22.17.1', '23.4.0', '23.11.0', '24.1.0']) expect(nodeTooOld(v), v).toBe(true);
  for (const v of ['22.18.0', '22.21.1', '24.2.0', '25.0.0', '26.13.1']) expect(nodeTooOld(v), v).toBe(false);
  expect(nodeTooOld(process.versions.node)).toBe(false);
});

it('installs the skill file for file, and says when nothing changed', () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-skill-'));
  try {
    const src = path.join(import.meta.dirname, '..', 'skill', 'anur-living-map');
    expect(copySkill(src, dst)).toBe(true);
    expect(fs.readFileSync(path.join(dst, 'SKILL.md'), 'utf8')).toBe(fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8'));
    expect(fs.statSync(path.join(dst, 'scripts', 'open-map.sh')).mode & 0o111).not.toBe(0);
    expect(copySkill(src, dst)).toBe(false);
  } finally { fs.rmSync(dst, { recursive: true, force: true }); }
});
