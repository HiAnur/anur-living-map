import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openTestMap, read, send } from './map.harness.js';

// Whose a Claude Code chat linked to the map is: yours, the one person on this Mac, never a name a script made up
// from the Mac's account, so the chat the map was opened from shows in your Claude pane whatever you are called.
const dirs = /** @type {string[]} */ ([]);
const closers = /** @type {(() => void)[]} */ ([]);
afterEach(() => { for (const c of closers.splice(0)) c(); for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** A Claude Code chat's transcript, where the app keeps them. @param {string} session */
function chatFile(session) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-chat-link-')), file = path.join(dir, '.claude', 'projects', 'shop', `${session}.jsonl`);
  dirs.push(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', origin: { kind: 'human' }, timestamp: new Date(0).toISOString(), message: { role: 'user', content: 'Hello' } })}\n`);
  return file;
}
/** @param {any[]} [linked] */
const state = (linked = []) => ({
  title: 'Shop', start: 'root', linkSharing: { mode: 'restricted' }, linked, people: [], calls: [], threads: {}, log: [],
  nodes: [{ id: 'root', label: 'Shop', x: 0, y: 0 }], edges: [],
});
/** @param {any} initial @param {() => string | null} me */
const open = (initial, me) => { const t = openTestMap(initial, 'chat-link', { me }); closers.push(t.close); return t.map; };
const ownerOf = (/** @type {any} */ m) => m.snapshot().linked.map((/** @type {any} */ l) => l.owner);

describe('a chat linked from this Mac', () => {
  it('is yours, whatever name the script sent, and your window shows it', async () => {
    const m = open(state(), () => 'Alex Smith');
    expect((await send(m, 'tool', { type: 'link', by: 'Alex', session: 'chat-0001', file: chatFile('chat-0001') })).status).toBe(200);
    expect(ownerOf(m)).toEqual(['Alex Smith']);
    expect((await read(m, 'Alex Smith', '/api/events')).text).toContain('event: mirror');
  });

  it('follows you when you change your name', async () => {
    let me = 'Alex';
    const m = open(state(), () => me);
    await send(m, 'tool', { type: 'link', by: 'Alex', session: 'chat-0002', file: chatFile('chat-0002') });
    me = 'Alex Smith';
    expect((await read(m, 'Alex Smith', '/api/events')).text).toContain('event: mirror');
    expect(ownerOf(m)).toEqual(['Alex Smith']);
  });
});

describe('a chat linked before a map knew you by one name', () => {
  const old = (/** @type {string} */ owner, /** @type {string} */ session) => ({ session, file: '/no/such.jsonl', owner, at: 1 });

  it('is yours, written down when the map opens', () => {
    expect(ownerOf(open(state([old('Alex', 's1'), old('Kim', 's2')]), () => 'Alex Smith'))).toEqual(['Alex Smith', 'Alex Smith']);
  });

  it('stays as it was on a map that is told no one is you', () => {
    expect(ownerOf(open(state([old('Alex', 's1')]), () => null))).toEqual(['Alex']);
  });
});
