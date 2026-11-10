import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// An error the map ignores says why: an empty catch, or a .catch that does nothing, carries a comment inside it
// saying why it is safe, or it does something with the error (a .catch that returns a value the code then
// handles, like `fetch(...).catch(() => null)`, does something).
const dir = import.meta.dirname;
const sources = () => [
  ...fs.readdirSync(dir).filter((f) => f.endsWith('.js')),
  ...fs.readdirSync(path.join(dir, 'agents'), { recursive: true }).map(String).filter((f) => f.endsWith('.js')).map((f) => path.join('agents', f)),
].filter((f) => !/\.test\.js$|\.harness\.js$/.test(f));
const EMPTY = [/\bcatch\s*(\([^)]*\))?\s*\{\s*\}/, /\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)/];

it('every ignored error says why', () => {
  const found = [];
  for (const f of sources()) fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
    if (EMPTY.some((r) => r.test(line))) found.push(`${f}:${i + 1}`);
  });
  expect(found).toEqual([]);
});

it('the check sees an empty catch, and passes one that says why', () => {
  for (const line of ['try { x(); } catch {}', 'try { x(); } catch (e) {}', 'p.catch(() => {})', 'p.catch((e) => {})'])
    expect(EMPTY.some((r) => r.test(line)), line).toBe(true);
  for (const line of ['try { x(); } catch { /* gone already */ }', 'p.catch(() => { /* the caller has it */ })', 'try { x(); } catch (e) { log(e); }', 'fetch(u).catch(() => null)'])
    expect(EMPTY.some((r) => r.test(line)), line).toBe(false);
});
