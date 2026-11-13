import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import mapJob from './extension.js';
import { run } from './index.js';

// What Pi's extension refuses in an Action run, for what a call sends or runs: the same checks the Claude Code
// hook makes (action-sends.js), here in Pi's own process.

const GMAIL = 'mcp__claude_ai_Gmail__send_message', message = { to: 'sam@example.com', subject: 'Hi', body: 'Hello' };
const exact = { to: ['sam@example.com'], subject: 'Hi', body: 'Hello' };
afterEach(() => { vi.unstubAllEnvs(); });

/** The extension loaded with this job: what it answers each tool call. @param {PiJob} job */
function loaded(job) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-job-')), 'job.json');
  fs.writeFileSync(file, JSON.stringify(job));
  vi.stubEnv('LIVING_MAP_PI_JOB', file);
  /** @type {((e: any) => any) | null} */ let listener = null;
  mapJob({ registerMcpServer() {}, registerTool() {}, on: (/** @type {string} */ name, /** @type {any} */ f) => { if (name === 'tool_call') listener = f; } });
  return (/** @type {string} */ toolName, /** @type {unknown} */ input) => listener?.({ toolName, input });
}

describe('an Action run under Pi', () => {
  it('lets one send of the reviewed message through, and refuses any other or a second', () => {
    const call = loaded({ allow: ['read', GMAIL], guard: { message, left: 1 } });
    expect(call(GMAIL, { ...exact, cc: ['alex@example.com'] })).toMatchObject({ block: true, reason: expect.stringContaining('copies alex@example.com') });
    expect(call(GMAIL, exact)).toBeUndefined();
    expect(call(GMAIL, exact)).toMatchObject({ block: true, reason: expect.stringContaining('already sent') });
    expect(call('read', { path: 'a.js' })).toBeUndefined();
  });
  it('refuses GitHub writes from the shell in a run nobody started', () => {
    const call = loaded({ allow: ['bash'], guard: { left: 1, unattended: true } });
    expect(call('bash', { command: 'gh pr comment 7 --body ok' })).toMatchObject({ block: true });
    expect(call('bash', { command: 'gh pr view 7' })).toBeUndefined();
  });
  it('is handed the guard by the run', async () => {
    /** @type {any} */ let job = null;
    const spawnProcess = /** @type {any} */ ((/** @type {string} */ _cmd, /** @type {string[]} */ _args, /** @type {any} */ opts) => {
      job = JSON.parse(fs.readFileSync(opts.env.LIVING_MAP_PI_JOB, 'utf8'));
      /** @type {any} */ const proc = new EventEmitter();
      Object.assign(proc, { pid: undefined, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
      setTimeout(() => { proc.stdout.end(); setTimeout(() => proc.emit('close', 0)); });
      return proc;
    });
    await new Promise((resolve) => run({ cwd: '/w', session: 's', prompt: 'p', tools: [GMAIL], guard: { message, left: 1 }, schema: {}, system: '', read: (v) => v, onText() {}, onDone: resolve, spawnProcess }));
    expect(job.guard).toEqual({ message, left: 1 });
  });
});
