import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// `npx anur-living-map` runs the published package, so every file a packed file imports or starts (an MCP
// server by its URL) must be packed too, and no test.
it('packs every file the server and its scripts reach, and no tests', () => {
  const dir = import.meta.dirname;
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const packed = new Set(JSON.parse(out)[0].files.map((/** @type {{ path: string }} */ f) => f.path));
  for (const entry of ['server.js', 'bin.js', 'index.html', 'package.json']) expect(packed).toContain(entry);
  expect([...packed].filter((f) => /\.test\.|harness/.test(f))).toEqual([]);
  const missing = [];
  for (const file of [...packed].filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    const refs = [...text.matchAll(/(?:\bfrom\s+|\bimport\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g), ...text.matchAll(/new URL\(\s*['"](\.{1,2}\/[^'"]+\.js)['"]/g)];
    for (const [, ref] of refs) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), /** @type {string} */ (ref)));
      if (!packed.has(target)) missing.push(`${file} → ${target}`);
    }
  }
  expect(missing).toEqual([]);
});
