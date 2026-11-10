import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const spawned = vi.hoisted(() => ({ calls: /** @type {any[]} */ ([]), next: /** @type {any} */ (null) }));
vi.mock('node:child_process', () => ({ spawn: (...args) => { spawned.calls.push(args); return spawned.next; } }));

const { converse } = await import('./converse.js');

// The headless chat a map runs itself: the first turn names its session, later ones resume it by id, and
// a turn that runs past twenty minutes is stopped.
function turn(first) {
  /** @type {any} */ const proc = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  spawned.next = proc; spawned.calls.length = 0;
  const closed = vi.fn(), sent = [];
  proc.stdin.on('data', (c) => sent.push(String(c)));
  const stop = converse({ cwd: '/maps/demo', session: 'chat-1', first, title: 'Living Map: Demo', system: 'Draw the map.', prompt: 'Plan the launch', onClose: closed });
  return { proc, closed, stop, sent, command: spawned.calls[0][0], args: spawned.calls[0][1], opts: spawned.calls[0][2] };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete process.env.CLAUDECODE; });

it('starts a named session, then resumes it, in auto mode with nobody to ask', () => {
  process.env.CLAUDECODE = '1';
  const a = turn(true);
  expect(a.command).toBe('claude');
  expect(a.args).toEqual(['-p', '--session-id', 'chat-1', '--name', 'Living Map: Demo', '--permission-mode', 'auto', '--permission-prompts', 'none',
    '--append-system-prompt', 'Draw the map.', '--output-format', 'json']);
  expect(a.opts.cwd).toBe('/maps/demo');
  expect(a.opts.env.CLAUDECODE).toBeUndefined();
  const b = turn(false);
  expect(b.args.slice(0, 3)).toEqual(['-p', '--resume', 'chat-1']);
  expect(b.args).not.toContain('--name');
});
it('sends the prompt, says when the turn ends, and stops a turn that runs too long', async () => {
  const t = turn(true);
  vi.useRealTimers(); await new Promise((r) => setImmediate(r)); vi.useFakeTimers();
  expect(t.sent.join('')).toBe('Plan the launch');
  t.proc.emit('close', 0);
  expect(t.closed).toHaveBeenCalledOnce();
  const slow = turn(false);
  vi.advanceTimersByTime(20 * 60_000);
  expect(slow.proc.kill).toHaveBeenCalledWith('SIGTERM');
  slow.stop();
  expect(slow.proc.kill).toHaveBeenCalledTimes(2);
});
