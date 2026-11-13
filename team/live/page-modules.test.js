import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inlineModules, PAGE_MODULES } from './page-modules.js';

const read = (/** @type {string} */ f) => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const script = (/** @type {string} */ page) => /** @type {RegExpMatchArray} */ (page.match(/<script type="module">([\s\S]*?)<\/script>/))[1];
// the names a script declares at its top level
const declared = (/** @type {string} */ code) => new Set([...code.matchAll(/^(?:export )?(?:async )?(?:function\*? |const |let |class )\s*\{?\s*([\w$]+(?:\s*,\s*[\w$]+)*)/gm)].flatMap((m) => m[1].split(/\s*,\s*/)));

// The rules page-modules.js names, which let Share as a file write a module in place of its import.
describe('the page modules', () => {
  it('are every file the page imports, and the page imports each', () => {
    const imported = [...script(html).matchAll(/^import .* from '\.\/([\w-]+\.js)';$/gm)].map((m) => m[1]);
    expect(imported.sort()).toEqual([...PAGE_MODULES].sort());
  });
  it('import nothing, and declare no name the page or another module declares', () => {
    const seen = declared(script(html));
    for (const f of PAGE_MODULES) {
      const code = read(f);
      expect(code, f).not.toMatch(/^\s*import\b/m);
      const names = [...declared(code)];
      expect(names.length, f).toBeGreaterThan(0);
      for (const name of names) {
        expect(seen.has(name), `${f}: ${name}`).toBe(false);
        seen.add(name);
      }
    }
  });
});

describe('Share as a file', () => {
  it('writes each module in place of its import, so the saved page needs nothing beside it', () => {
    const saved = script(inlineModules(html, read));
    expect(saved).not.toMatch(/^import\b/m);
    for (const f of PAGE_MODULES) expect(saved).toContain(read(f).replace(/^export /gm, '').trim());
    // still one module's worth of code, which parses
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lm-saved-')), 'saved.mjs');
    fs.writeFileSync(file, saved);
    expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
  it('leaves an import of anything else as it is', () => {
    const page = "<script type=\"module\">\nimport { x } from './elsewhere.js';\n</script>";
    expect(inlineModules(page, read)).toBe(page);
  });
});

describe('an Action\'s history as the page shows it', async () => {
  const { actionHistory } = await import('./page-action.js');
  it('reads newest first, names the map, and says how a run ended and what it used', () => {
    const rows = actionHistory([
      { what: 'created', by: 'Duy', at: 1 },
      { what: 'executed', by: 'Duy', at: 2, tools: ['Edit', 'Write'] },
      { what: 'finished', by: 'Claude', at: 3, status: 'needs_input', ms: 95_000 },
      { what: 'interrupted', by: 'Map', at: 4 },
    ]);
    expect(rows.map((r) => [r.label, r.who, r.detail])).toEqual([
      ['Interrupted by a restart', 'the map', ''],
      ['Run ended', 'Claude', 'needs an answer · 2 min'],
      ['Executed', 'Duy', 'tools: Edit, Write'],
      ['Made an Action', 'Duy', ''],
    ]);
    expect(actionHistory(undefined)).toEqual([]);
  });
  it('names the tools a run used that the map does not know', () => {
    const [row] = actionHistory([{ what: 'finished', by: 'Claude', at: 1, status: 'unverified', ran: ['mcp__acme__do_thing'], unknown: ['mcp__acme__do_thing'] }]);
    expect(row.detail).toBe('done, unverified · ran: mcp__acme__do_thing · tools the map does not know: mcp__acme__do_thing');
  });
});
