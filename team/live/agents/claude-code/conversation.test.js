import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

import { claudeCodeChats } from './conversation.js';

// Your chats as Claude Code keeps them, in a stand-in home: found by id or by what they say, checked before
// the map follows one, opened in the app by link, and the map registered once as an MCP server.
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-chats-'));
  const folder = '/work/my map', projects = path.join(dir, '.claude', 'projects'), chatsDir = path.join(projects, '-work-my-map');
  fs.mkdirSync(chatsDir, { recursive: true });
  return { dir, folder, chatsDir };
}

it('finds a chat by its id, and a new one in a folder by what it says', () => {
  const h = home(), chats = claudeCodeChats({ home: h.dir });
  expect(chats.findChat('chat-0001')).toBeNull();
  const file = path.join(h.chatsDir, 'chat-0001.jsonl');
  fs.writeFileSync(file, '{"text":"/anur-living-map map:demo"}\n');
  expect(chats.findChat('chat-0001')).toBe(file);
  expect(chats.findNewChat({ folder: h.folder, since: 0, holding: 'map:demo' })).toBe(file);
  expect(chats.findNewChat({ folder: h.folder, since: 0, holding: 'map:other' })).toBeNull();
  expect(chats.findNewChat({ folder: h.folder, since: Date.now() + 60_000, holding: 'map:demo' })).toBeNull();
  expect(chats.findNewChat({ folder: '/nowhere', since: 0, holding: 'map:demo' })).toBeNull();
});
it('follows only a chat transcript of that id', () => {
  const h = home(), chats = claudeCodeChats({ home: h.dir }), file = path.join(h.chatsDir, 'chat-0001.jsonl');
  fs.writeFileSync(file, '');
  expect(chats.isChat(file, 'chat-0001')).toBe(true);
  expect(chats.isChat(file, 'chat-0002')).toBe(false);
  expect(chats.isChat(file, 'x')).toBe(false);
  const elsewhere = path.join(h.dir, 'chat-0001.jsonl'); fs.writeFileSync(elsewhere, '');
  expect(chats.isChat(elsewhere, 'chat-0001')).toBe(false);
  expect(chats.isChat(path.join(h.chatsDir, 'chat-0009.jsonl'), 'chat-0009')).toBe(false);
});
it('opens a new chat in the app by link, and keeps skills under its home', () => {
  const on = vi.fn(), open = vi.fn(() => ({ on }));
  const chats = claudeCodeChats({ home: '/h', open: /** @type {any} */ (open) });
  chats.openNew({ prompt: '/anur-living-map map:demo Plan it', folder: '/work/my map' });
  expect(open).toHaveBeenCalledWith('open', ['claude://code/new?q=%2Fanur-living-map%20map%3Ademo%20Plan%20it&folder=%2Fwork%2Fmy%20map']);
  expect(on).toHaveBeenCalledWith('error', expect.any(Function));
  expect(chats.skillDir('anur-living-map')).toBe('/h/.claude/skills/anur-living-map');
});
it('registers the map\'s MCP server once, and says how when Claude Code is missing', () => {
  const runner = (answers) => { const calls = []; return { calls, run: /** @type {any} */ ((cmd, args) => { calls.push([cmd, ...args]); if (!answers.shift()) throw new Error('no'); }) }; };
  const there = runner([true]);
  expect(claudeCodeChats({ run: there.run }).connectTools()).toBe('');
  expect(there.calls).toEqual([['claude', 'mcp', 'get', 'living-map']]);
  const added = runner([false, true]);
  expect(claudeCodeChats({ run: added.run }).connectTools()).toContain('can now read and change the map');
  expect(added.calls[1]).toEqual(['claude', 'mcp', 'add', '--scope', 'user', 'living-map', '--', 'npx', '-y', 'anur-living-map', 'mcp']);
  const missing = runner([false, false]);
  expect(claudeCodeChats({ run: missing.run }).connectTools()).toContain('not found on PATH');
});
