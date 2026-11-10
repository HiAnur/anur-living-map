import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { follow } from './transcript.js';

// A Claude Code transcript as the map's pane reads it: your words and Claude's, what Claude is doing now,
// and nothing the app or a helper wrote in your place.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-transcript-'));
const followed = [];
afterEach(() => { for (const f of followed.splice(0)) f.stop(); });
const at = (s) => new Date(Date.UTC(2026, 10, 10, 9, 0, s)).toISOString();
const write = (name, lines) => { const file = path.join(dir, name); fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); return file; };
const tick = () => new Promise((r) => setTimeout(r, 20));
const human = (text, s) => ({ type: 'user', origin: { kind: 'human' }, timestamp: at(s), message: { content: text } });
const said = (content, s, stop = 'end_turn') => ({ type: 'assistant', timestamp: at(s), message: { model: 'claude-opus-5-5', stop_reason: stop, content } });

it('keeps your words and Claude\'s replies, and leaves out what you did not type', async () => {
  const file = write('chat.jsonl', [
    human('<command-name>/anur-living-map</command-name><command-args>map:demo</command-args>', 1),
    human('Plan the launch<system-reminder>hidden</system-reminder>', 2),
    { type: 'user', timestamp: at(3), message: { content: 'a tool result' }, toolUseResult: {} },
    { type: 'user', timestamp: at(3), message: { content: 'a notice' } },
    { ...said([{ type: 'text', text: 'From a helper' }], 4), isSidechain: true },
    said([{ type: 'text', text: 'Here is the plan.' }], 5),
    human('<task-notification>done</task-notification>', 6),
  ]);
  const f = follow(file, () => {}); followed.push(f);
  await tick();
  expect(f.msgs().map((m) => [m.who, m.text])).toEqual([['you', '/anur-living-map map:demo'], ['you', 'Plan the launch'], ['claude', 'Here is the plan.']]);
  expect(f.model()).toEqual({ id: 'claude-opus-5-5', effort: null });
});
it('says what Claude is doing in plain words until a reply ends the turn', async () => {
  const file = write('working.jsonl', [human('Fix it', 1), said([{ type: 'tool_use', name: 'Read', input: { file_path: '/p/src/app.ts' } }], 2, 'tool_use')]);
  const f = follow(file, () => {}); followed.push(f);
  await tick();
  expect(f.status()).toMatchObject({ working: true, doing: 'Reading app.ts' });
  fs.appendFileSync(file, JSON.stringify(said([{ type: 'tool_use', name: 'mcp__living-map__living_map_change', input: {} }], 3, 'tool_use')) + '\n');
  await new Promise((r) => setTimeout(r, 1100));
  expect(f.status().doing).toBe('Drawing on the map');
  fs.appendFileSync(file, JSON.stringify(said([{ type: 'text', text: 'Done.' }], 4)) + '\n');
  await new Promise((r) => setTimeout(r, 1100));
  expect(f.status()).toMatchObject({ working: false, doing: '' });
});
it('counts every user entry as yours in a chat the map started, keeps pictures, and reads whole lines only', async () => {
  const png = Buffer.from('picture').toString('base64');
  const file = write('built.jsonl', [{ type: 'user', timestamp: at(1), message: { content: [{ type: 'text', text: 'Draw this' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] } }]);
  fs.appendFileSync(file, '{"type":"assistant"');
  const changes = [];
  const f = follow(file, (m) => changes.push(m.length), { anyUser: true }); followed.push(f);
  await tick();
  const [m] = f.msgs();
  expect(m).toMatchObject({ who: 'you', text: 'Draw this' });
  expect(f.img(m.imgs[0])).toEqual({ type: 'image/png', data: png });
  expect(changes).toEqual([1]);
  const plain = follow(write('plain.jsonl', [{ type: 'user', timestamp: at(1), message: { content: 'not marked' } }]), () => {}); followed.push(plain);
  await tick();
  expect(plain.msgs()).toEqual([]);
});
