import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addWords, claudeEnv, killer, readLines } from './process.js';

/** @returns {any} a stand-in for a child process: streams to write to and a kill to watch */
function fake(pid) {
  const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), pid });
  return proc;
}
afterEach(() => { vi.restoreAllMocks(); });

describe('what a background Claude process is given and how it is stopped', () => {
  it('drops the session of the Claude Code the server runs in, and keeps where its sign-in lives', () => {
    const before = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'outer', CLAUDE_CONFIG_DIR: '/sample/config', CLAUDE_CODE_OAUTH_TOKEN: 'sample', PATH: '/bin', OTHER: undefined };
    expect(claudeEnv(before)).toEqual({ CLAUDE_CONFIG_DIR: '/sample/config', CLAUDE_CODE_OAUTH_TOKEN: 'sample', PATH: '/bin', OTHER: undefined });
    expect(before.CLAUDECODE).toBe('1');
  });
  it('stops the whole group of a process that has a pid, and the process itself when it has none', () => {
    const group = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const started = fake(4321), a = killer(started);
    a.kill('SIGTERM');
    if (process.platform === 'win32') expect(started.kill).toHaveBeenCalledWith('SIGTERM');
    else { expect(group).toHaveBeenCalledWith(-4321, 'SIGTERM'); expect(started.kill).not.toHaveBeenCalled(); }
    const unstarted = fake(undefined), b = killer(unstarted);
    b.kill('SIGKILL');
    expect(unstarted.kill).toHaveBeenCalledWith('SIGKILL');
    a.done(); b.done(); a.done();
  });
  it('does not throw when the process has already gone', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => { throw new Error('ESRCH'); });
    const gone = fake(undefined); gone.kill.mockImplementation(() => { throw new Error('gone'); });
    expect(() => killer(fake(99)).kill('SIGTERM')).not.toThrow();
    expect(() => killer(gone).kill('SIGTERM')).not.toThrow();
  });
});

describe('reading a process line by line', () => {
  it('puts back together a line and a character split across chunks, and gives the last line on flush', () => {
    const proc = fake(1), lines = [], flush = readLines(proc, (l) => lines.push(l));
    const bytes = Buffer.from('first\nCafé au lait\nlast'), cut = bytes.indexOf(0xc3) + 1;
    proc.stdout.write(bytes.subarray(0, 3)); proc.stdout.write(bytes.subarray(3, cut)); proc.stdout.write(bytes.subarray(cut));
    expect(lines).toEqual(['first', 'Café au lait']);
    flush();
    expect(lines).toEqual(['first', 'Café au lait', 'last']);
  });
  it('gives nothing on flush when the output ended on a line break', () => {
    const proc = fake(1), lines = [], flush = readLines(proc, (l) => lines.push(l));
    proc.stdout.write('only\n'); flush();
    expect(lines).toEqual(['only']);
  });
  it('drops output that runs past 2 MB with no line break', () => {
    const proc = fake(1), lines = [], flush = readLines(proc, (l) => lines.push(l));
    proc.stdout.write('x'.repeat(2_000_001)); proc.stdout.write('kept\n'); flush();
    expect(lines).toEqual(['kept']);
  });
});

describe('the words of a reply as they stream', () => {
  const delta = (text) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
  const start = { type: 'stream_event', event: { type: 'message_start' } };
  it('adds each piece, starts a paragraph at a new message, and reports after every piece', () => {
    const seen = []; let words = '';
    for (const d of [start, delta('Reading'), delta(' the form'), start, delta('Done')]) words = addWords(words, d, (w) => seen.push(w));
    expect(words).toBe('Reading the form\n\nDone');
    expect(seen).toEqual(['Reading', 'Reading the form', 'Reading the form\n\nDone']);
  });
  it('leaves the words alone for anything else, and keeps only the last 32,000 characters', () => {
    const seen = [];
    for (const d of [{ type: 'result', result: 'x' }, { type: 'assistant' }, delta(undefined), delta(7), { type: 'stream_event' }]) expect(addWords('so far', d, (w) => seen.push(w))).toBe('so far');
    expect(seen).toEqual([]);
    expect(addWords('a'.repeat(31_999), delta('bcd'), () => {})).toBe('a'.repeat(31_997) + 'bcd');
  });
});
