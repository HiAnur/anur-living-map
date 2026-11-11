import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { workFolder } from './wide-folder.js';

it('gives Claude a project folder, never the home folder or one above it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-home-'));
  const project = path.join(home, 'work', 'app'), map = path.join(home, '.anur-living-map', 'maps', 'x');
  fs.mkdirSync(project, { recursive: true });
  try {
    expect(workFolder(project, map, home)).toBe(project);
    expect(workFolder(home, map, home)).toBe(map);
    expect(workFolder(path.dirname(home), map, home)).toBe(map);
    expect(workFolder(path.parse(home).root, map, home)).toBe(map);
    expect(workFolder(path.join(home, 'gone'), map, home)).toBe(map);
    expect(workFolder(undefined, map, home)).toBe(map);
    // a link to the home folder is the home folder
    fs.symlinkSync(home, path.join(project, 'me'));
    expect(workFolder(path.join(project, 'me'), map, home)).toBe(map);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
