import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { answer } from './answer.js';

// One answer held to a schema, from a stand-in for `claude` that prints what Claude Code would.

/** @param {string} printed what the process writes before it closes @param {{ never?: boolean }} [o] */
function run(printed, o = {}) {
  /** @type {any} */ const proc = new EventEmitter();
  Object.assign(proc, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  /** @type {any[]} */ const calls = [];
  let prompt = '';
  proc.stdin.on('data', (/** @type {Buffer} */ d) => { prompt += d; });
  const result = answer({ prompt: 'Draw it', schema: { type: 'object' }, model: 'sonnet', timeoutMs: o.never ? 20 : 5000,
    spawnProcess: /** @type {any} */ ((/** @type {any[]} */ ...args) => { calls.push(args); return proc; }) });
  if (!o.never) setTimeout(() => { proc.stdout.end(printed); proc.emit('close', 0); });
  return { result, calls, prompt: () => prompt };
}

describe('answer', () => {
  it('asks with no tools, servers, settings or kept session, and returns the answer and its cost', async () => {
    const r = run(JSON.stringify({ structured_output: { boxes: [] }, total_cost_usd: 0.21, duration_ms: 1200 }));
    expect(await r.result).toEqual({ value: { boxes: [] }, cost: { value: 0.21, unit: 'usd' }, ms: 1200 });
    const [cmd, args, opts] = r.calls[0];
    expect(cmd).toBe('claude');
    expect(args).toEqual(expect.arrayContaining(['-p', '--json-schema', '--no-session-persistence', '--strict-mcp-config', '--model', 'sonnet']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(Object.keys(opts.env).filter((k) => k.startsWith('CLAUDE') && !['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN'].includes(k))).toEqual([]);
    expect(r.prompt()).toBe('Draw it');
  });
  it('says Claude Code is signed out when it is', async () => {
    expect((await run(JSON.stringify({ is_error: true, result: 'Invalid API key · Please run /login' })).result).error).toBe('Claude Code is signed out.');
  });
  it('says why there is no answer', async () => {
    expect((await run('not json').result).error).toMatch(/gave no answer/);
  });
  it('gives up after its time limit', async () => {
    const r = run('', { never: true });
    expect((await r.result).error).toBe('The agent took too long to answer.');
  });
});
