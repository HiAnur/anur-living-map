import crypto from 'node:crypto';
import fs from 'node:fs';

import { expect, it } from 'vitest';

it('ships a rich editor built from the current typed source with its dependency licenses', () => {
  const source = crypto.createHash('sha256').update(fs.readFileSync(new URL('../note-editor/engine.ts', import.meta.url))).update(fs.readFileSync(new URL('../note-editor/model.ts', import.meta.url))).digest('hex');
  const built = fs.readFileSync(new URL('./page-note-rich.js', import.meta.url), 'utf8');
  expect(built).toContain(`// Source: ${source}`);
  expect(built).toContain('Permission is hereby granted, free of charge');
  expect(built).toContain('export const noteRich =');
});
