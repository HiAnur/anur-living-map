import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drawServer } from '../../draw.js';
import { converse, converseSettings } from './converse.js';

// The headless chat a map runs itself: the first turn names its session, later ones resume it by id, a turn that
// runs past twenty minutes is stopped, and it may use only the map's own tools, pinned to its map.
const servers = { living_map: drawServer({ url: 'http://localhost:4323', map: 'demo', session: 'chat-1' }) };
const MAP_TOOLS = ['mcp__living_map__living_map_read', 'mcp__living_map__living_map_change'];

/** @param {boolean} first */
function turn(first) {
  /** @type {any} */ const proc = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  /** @type {any[]} */ const calls = [];
  const closed = vi.fn(), /** @type {string[]} */ sent = [];
  proc.stdin.on('data', (/** @type {Buffer} */ c) => sent.push(String(c)));
  const stop = converse({ cwd: '/maps/demo', session: 'chat-1', first, title: 'Living Map: Demo', system: 'Draw the map.', prompt: 'Plan the launch', servers, onClose: closed,
    spawnProcess: /** @type {any} */ ((/** @type {any[]} */ ...args) => { calls.push(args); return proc; }) });
  const [command, args, opts] = calls[0];
  return { proc, closed, stop, sent, command, args: /** @type {string[]} */ (args), opts };
}
const flag = (/** @type {string[]} */ args, /** @type {string} */ name) => args[args.indexOf(name) + 1];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete process.env.CLAUDECODE; });

it('starts a named session, then resumes it, with nobody to ask', () => {
  process.env.CLAUDECODE = '1';
  const a = turn(true);
  expect(a.command).toBe('claude');
  expect(a.args.slice(0, 5)).toEqual(['-p', '--session-id', 'chat-1', '--name', 'Living Map: Demo']);
  expect(flag(a.args, '--permission-mode')).toBe('dontAsk');
  expect(flag(a.args, '--permission-prompts')).toBe('none');
  expect(flag(a.args, '--append-system-prompt')).toBe('Draw the map.');
  expect(a.opts.cwd).toBe('/maps/demo');
  expect(a.opts.env.CLAUDECODE).toBeUndefined();
  const b = turn(false);
  expect(b.args.slice(0, 3)).toEqual(['-p', '--resume', 'chat-1']);
  expect(b.args).not.toContain('--name');
});
it('reads none of your settings and reaches only the map\'s own server, pinned to its map, behind the hook', () => {
  const { args } = turn(true);
  expect(flag(args, '--setting-sources')).toBe('');
  expect(args).toContain('--strict-mcp-config');
  const config = JSON.parse(flag(args, '--mcp-config'));
  expect(Object.keys(config.mcpServers)).toEqual(['living_map']);
  expect(config.mcpServers.living_map.args[0]).toMatch(/[/\\]mcp\.js$/);
  expect(config.mcpServers.living_map.env).toEqual({ LIVING_MAP_URL: 'http://localhost:4323', LIVING_MAP_ONLY_MAP: 'demo', LIVING_MAP_SESSION: 'chat-1' });
  expect(flag(args, '--allowedTools').split(',')).toEqual(['ToolSearch', ...MAP_TOOLS]);
  expect(flag(args, '--disallowedTools').split(',')).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch']));
  expect(JSON.parse(flag(args, '--settings'))).toEqual(converseSettings(servers));
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

// each check runs the real hook in its own node process, which takes seconds on a busy machine
describe('the tools the chat may use', { timeout: 30_000 }, () => {
  /** @param {string} tool_name */
  const decide = (tool_name) => {
    const out = execFileSync('/bin/sh', ['-c', converseSettings(servers).hooks.PreToolUse[0].hooks[0].command], { input: JSON.stringify({ tool_name, tool_input: { command: 'ls' } }), encoding: 'utf8' });
    return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'asks as usual';
  };
  it('refuses the shell, files, the web, your connectors and the map tools that reach other maps', () => {
    for (const tool of ['Bash', 'Write', 'Edit', 'Read', 'WebFetch', 'mcp__claude_ai_Gmail__send_message', 'mcp__anur-living-map__living_map_change', 'mcp__living_map__living_map_load'])
      expect(decide(tool), tool).toBe('deny');
  });
  it('leaves the map\'s own tools, and finding them, to run', () => {
    for (const tool of ['ToolSearch', ...MAP_TOOLS]) expect(decide(tool), tool).toBe('asks as usual');
  });
});
