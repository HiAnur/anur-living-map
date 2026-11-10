import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

// The build context prepare.mjs makes is all the cloud image gets: the cloud server must load from it alone, so a
// module the live server comes to import, or a file it stops having, shows here and not at deploy.
it('makes a build context the cloud server loads from, with no tests or private files', () => {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lm-cloud-build-')), 'context');
  execFileSync(process.execPath, [path.join(import.meta.dirname, 'prepare.mjs'), target]);
  const loaded = execFileSync(process.execPath, ['--input-type=module', '-e', "const m = await import('./cloud/server.js'); console.log(typeof m.createCloudServer)"], { cwd: target, encoding: 'utf8' });
  expect(loaded.trim()).toBe('function');
  const files = /** @type {string[]} */ (fs.readdirSync(target, { recursive: true })).map(String);
  expect(files.filter((f) => /\.test\.js$|\.harness\.js$|state\.json$|projects\.json$|cloud\.json$|users\.db|(^|\/)maps(\/|$)/.test(f))).toEqual([]);
  expect(files).toContain(path.join('live', 'index.html'));
  fs.rmSync(path.dirname(target), { recursive: true, force: true });
});
