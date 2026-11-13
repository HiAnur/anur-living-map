import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, it, vi } from 'vitest';

import { follow, piChats, sessionOf } from './conversation.js';

// Your chats as Pi keeps them, in a stand-in home: found by id or by what they say, checked before the map
// follows one, read into the map's pane, and opened in a terminal with the skill named the way Pi calls it.
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-pi-chats-'));
  const folder = '/work/my map', chatsDir = path.join(dir, '.pi', 'agent', 'sessions', '--work-my map--');
  fs.mkdirSync(chatsDir, { recursive: true });
  return { dir, folder, chatsDir };
}
const line = (/** @type {any} */ o) => JSON.stringify(o) + '\n';

it('finds a chat by its id and a new one in a folder by what it says, and knows its id from its file', () => {
  const h = home(), chats = piChats({ home: h.dir });
  const file = path.join(h.chatsDir, '2026-11-12T08-19-00-764Z_01a11a98-241c-751e.jsonl');
  expect(chats.findChat('01a11a98-241c-751e')).toBeNull();
  fs.writeFileSync(file, line({ type: 'message', message: { role: 'user', content: '/skill:anur-living-map map:demo' } }));
  expect(chats.findChat('01a11a98-241c-751e')).toBe(file);
  expect(chats.findNewChat({ folder: h.folder, since: 0, holding: 'map:demo' })).toBe(file);
  expect(chats.findNewChat({ folder: h.folder, since: 0, holding: 'map:other' })).toBeNull();
  expect(sessionOf(file)).toBe('01a11a98-241c-751e');
  expect(chats.isChat(file, '01a11a98-241c-751e')).toBe(true);
  expect(chats.isChat(file, '2026-11-12T08-19-00-764Z_01a11a98-241c-751e')).toBe(false);
  expect(chats.owns?.(file)).toBe(true);
  const elsewhere = path.join(h.dir, 'x_01a11a98-241c-751e.jsonl'); fs.writeFileSync(elsewhere, '');
  expect(chats.isChat(elsewhere, '01a11a98-241c-751e')).toBe(false);
});

it('reads your words, pictures and Pi\'s replies into the pane, leaving out tool output and the map\'s own messages', async () => {
  const h = home(), file = path.join(h.chatsDir, 't_chat-0001.jsonl');
  fs.writeFileSync(file, [
    line({ type: 'session', id: 'chat-0001' }),
    line({ type: 'message', timestamp: '2026-11-12T10:00:00Z', message: { role: 'system', content: '' } }),
    line({ type: 'message', timestamp: '2026-11-12T10:00:01Z', message: { role: 'user', content: [{ type: 'text', text: 'Plan the payments move' }, { type: 'image', data: 'aGk=', mimeType: 'image/png' }] } }),
    line({ type: 'message', timestamp: '2026-11-12T10:00:02Z', message: { role: 'assistant', model: 'claude-opus-5', thinkingLevel: 'high', stopReason: 'toolUse', content: [{ type: 'text', text: 'Looking.' }, { type: 'toolCall', name: 'read', arguments: { path: '/r/pay.ts' } }] } }),
    line({ type: 'message', timestamp: '2026-11-12T10:00:03Z', message: { role: 'toolResult', content: [{ type: 'text', text: 'file body' }] } }),
    line({ type: 'message', timestamp: '2026-11-12T10:00:04Z', message: { role: 'custom', customType: 'living-map', content: 'FROM YOUR LIVING MAP' } }),
  ].join(''));
  const changed = vi.fn();
  const f = follow(file, changed);
  await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  expect(f.msgs().map((m) => [m.who, m.text])).toEqual([['you', 'Plan the payments move'], ['claude', 'Looking.']]);
  expect(f.img(f.msgs()[0].imgs[0])).toEqual({ type: 'image/png', data: 'aGk=' });
  expect(f.model()).toEqual({ id: 'claude-opus-5', effort: 'high' });
  expect(f.status()).toMatchObject({ working: true, doing: 'Reading pay.ts' });
  fs.appendFileSync(file, line({ type: 'message', timestamp: '2026-11-12T10:00:05Z', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Drawn.' }] } }));
  await vi.waitFor(() => expect(f.msgs().at(-1).text).toBe('Drawn.'), { timeout: 3000 });
  expect(f.status().working).toBe(false);
  f.stop();
  // asked, it reads what was written since at once
  fs.appendFileSync(file, line({ type: 'message', timestamp: '2026-11-12T10:00:06Z', message: { role: 'user', content: 'I\'ll send Dan the pricing' } }));
  expect(f.readNow().at(-1)).toMatchObject({ who: 'you', text: 'I\'ll send Dan the pricing' });
});

it('opens a new chat in a terminal in the folder, the skill called the way Pi calls it, and keeps skills where every agent reads them', () => {
  const on = vi.fn(), open = vi.fn(() => ({ on }));
  const chats = piChats({ home: '/h', open: /** @type {any} */ (open) });
  chats.openNew({ prompt: "/anur-living-map map:demo it's for Q1", folder: '/work/my map' });
  const args = /** @type {any} */ (open.mock.calls[0])[1].join(' ');
  expect(args).toContain("cd '/work/my map' && pi '/skill:anur-living-map map:demo it'\\\\''s for Q1'");
  expect(chats.skillDir('anur-living-map')).toBe('/h/.agents/skills/anur-living-map');
});

it('registers the map with Pi once, and says nothing to someone without Pi', () => {
  const h = home();
  const run = vi.fn((/** @type {string} */ _cmd, /** @type {string[]} */ args) => {
    if (args[0] === 'mcp') fs.writeFileSync(path.join(h.dir, '.pi', 'agent', 'mcp.json'), JSON.stringify({ mcpServers: { 'anur-living-map': {} } }));
    return '';
  });
  const chats = piChats({ home: h.dir, run: /** @type {any} */ (run) });
  expect(chats.connectTools()).toContain('Pi can now read and change the map');
  expect(fs.readFileSync(path.join(h.dir, '.pi', 'agent', 'extensions', 'anur-living-map.js'), 'utf8')).toContain('agents/pi/listener.js');
  expect(chats.connectTools()).toBe('');
  const none = piChats({ home: h.dir, run: /** @type {any} */ (() => { throw new Error('ENOENT'); }) });
  expect(none.connectTools()).toBe('');
});
