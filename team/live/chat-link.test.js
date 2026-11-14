import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openTestMap, read, send } from './map.harness.js';
import { personNamed } from './person.js';

// Whose a Claude Code chat linked to the map is: the person signed in on this Mac, never a name a script made up
// from the Mac's account, so "Alex Smith" from Google sees the chat "Alex" opened the map from.
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
/** @param {any} initial @param {{ people?: () => string[], signedIn?: () => string | null }} who */
const open = (initial, who) => { const t = openTestMap(initial, 'chat-link', who); closers.push(t.close); return t.map; };
const ownerOf = (/** @type {any} */ m) => m.snapshot().linked.map((/** @type {any} */ l) => l.owner);

describe('which person a name stands for', () => {
  const people = ['Alex Smith', 'Sam', 'Priya Nair', 'Priya Rao'];
  it('is the one called exactly that, whatever its case', () => {
    expect(personNamed('sam', people)).toBe('Sam');
    expect(personNamed(' Alex  Smith ', people)).toBe('Alex Smith');
  });
  it('is the only one whose name starts with it as whole words', () => {
    expect(personNamed('Alex', people)).toBe('Alex Smith');
    expect(personNamed('Alex', ['Alex-Smith'])).toBe('Alex-Smith');
  });
  it('is no one when two could be meant, when only part of a word matches, or when nothing is given', () => {
    expect(personNamed('Priya', people)).toBeNull();
    expect(personNamed('Al', people)).toBeNull();
    expect(personNamed('Kim', people)).toBeNull();
    expect(personNamed('', people)).toBeNull();
  });
});

describe('a chat linked from this Mac', () => {
  it('is the person signed in on this Mac last, whatever name the script sent', async () => {
    const m = open(state(), { people: () => ['Alex Smith', 'Sam'], signedIn: () => 'Alex Smith' });
    expect((await send(m, 'tool', { type: 'link', by: 'Alex', session: 'chat-0001', file: chatFile('chat-0001') })).status).toBe(200);
    expect(ownerOf(m)).toEqual(['Alex Smith']);
    // only their window is sent the chat
    expect((await read(m, 'Alex Smith', '/api/events')).text).toContain('event: mirror');
    expect((await read(m, 'Sam', '/api/events')).text).not.toContain('event: mirror');
  });

  it('keeps a signed-in window\'s own name', async () => {
    const m = open(state(), { people: () => ['Alex Smith', 'Sam'], signedIn: () => 'Alex Smith' });
    await send(m, 'Sam', { type: 'link', session: 'chat-0002', file: chatFile('chat-0002') });
    expect(ownerOf(m)).toEqual(['Sam']);
  });

  it('stands under the name sent while nobody has signed in, and becomes the person it names when they do', async () => {
    const people = /** @type {string[]} */ ([]);
    const m = open(state(), { people: () => people, signedIn: () => null });
    await send(m, 'tool', { type: 'link', by: 'Alex', session: 'chat-0003', file: chatFile('chat-0003') });
    expect(ownerOf(m)).toEqual(['Alex']);
    // Alex Smith signs in through Google and opens the map: the chat is theirs, and their window shows it
    people.push('Alex Smith');
    expect((await read(m, 'Alex Smith', '/api/events')).text).toContain('event: mirror');
    expect(ownerOf(m)).toEqual(['Alex Smith']);
  });
});

describe('a chat linked before the map knew people by their sign-in', () => {
  const old = (/** @type {string} */ owner, /** @type {string} */ session) => ({ session, file: '/no/such.jsonl', owner, at: 1 });

  it('is the one person its name stands for, written down when the map opens', () => {
    const m = open(state([old('Alex', 's1'), old('sam', 's2'), old('Kim', 's3')]), { people: () => ['Alex Smith', 'Sam'] });
    expect(ownerOf(m)).toEqual(['Alex Smith', 'Sam', 'Kim']);
  });

  it('stays as it was when two people could be meant, or nobody has signed in', () => {
    expect(ownerOf(open(state([old('Alex', 's1')]), { people: () => ['Alex Smith', 'Alex Jones'] }))).toEqual(['Alex']);
    expect(ownerOf(open(state([old('Alex', 's1')]), {}))).toEqual(['Alex']);
  });
});
