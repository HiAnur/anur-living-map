import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { answer, ask, converse, prepare, run } from './index.js';
import { SIGNED_OUT } from './process.js';

// Each job the map gives Pi, from a stand-in for `pi` that prints the JSON events Pi would: the flags it is
// started with, the job file its extension reads, and what comes back to the map.

const assistant = (/** @type {any[]} */ content, /** @type {any} */ more = {}) => ({ type: 'message_end', message: { role: 'assistant', content, stopReason: 'stop', usage: { cost: { total: 0.01 } }, ...more } });
const text = (/** @type {string} */ t) => [{ type: 'message_start', message: { role: 'assistant', content: [] } },
  { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: t } }, assistant([{ type: 'text', text: t }])];
const call = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ args, /** @type {any} */ o = {}) => [
  { type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id, toolName: name } },
  { type: 'tool_execution_start', toolCallId: id, toolName: name, args },
  { type: 'tool_execution_end', toolCallId: id, toolName: name, result: { content: [{ type: 'text', text: o.output || 'ok' }], details: o.details }, isError: !!o.error }];

/** @param {any[]} events what `pi` prints, one JSON line each */
function stand(events) {
  /** @type {{ args: string[], opts: any, job: any, prompt: string }} */
  const seen = { args: [], opts: null, job: null, prompt: '' };
  const spawnProcess = /** @type {any} */ ((/** @type {string} */ cmd, /** @type {string[]} */ args, /** @type {any} */ opts) => {
    expect(cmd).toBe('pi');
    Object.assign(seen, { args, opts, job: JSON.parse(fs.readFileSync(opts.env.LIVING_MAP_PI_JOB, 'utf8')) });
    /** @type {any} */ const proc = new EventEmitter();
    Object.assign(proc, { pid: undefined, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    proc.stdin.on('data', (/** @type {Buffer} */ d) => { seen.prompt += d; });
    setTimeout(() => { proc.stdout.end(events.map((e) => JSON.stringify(e)).join('\n') + '\n'); setTimeout(() => proc.emit('close', 0)); });
    return proc;
  });
  return { seen, spawnProcess };
}
const flag = (/** @type {string[]} */ args, /** @type {string} */ name) => args[args.indexOf(name) + 1];

describe('answer', () => {
  it('asks with only the submit tool, no MCP and no session, and returns what was submitted and its cost', async () => {
    const s = stand([...call('c1', 'submit_answer', { boxes: [] }, { details: { boxes: [] } }), ...text('Done.')]);
    const r = await answer({ prompt: 'Draw it', schema: { type: 'object' }, model: 'sonnet', spawnProcess: s.spawnProcess });
    expect(r).toMatchObject({ value: { boxes: [] }, cost: { value: 0.01, unit: 'usd' } });
    expect(s.seen.args).toEqual(expect.arrayContaining(['-p', '--mode', 'json', '--no-session', '--no-mcp', '--no-context-files', '--model', 'sonnet']));
    expect(flag(s.seen.args, '--tools')).toBe('submit_answer');
    expect(s.seen.job).toEqual({ schema: { type: 'object' } });
    expect(s.seen.prompt).toBe('Draw it');
  });
  it('a submit Pi refused for its shape is no answer', async () => {
    const s = stand([...call('c1', 'submit_answer', { boxes: 1 }, { error: true, output: 'Validation failed' }), ...text('Sorry.')]);
    const r = await answer({ prompt: 'p', schema: { type: 'object' }, spawnProcess: s.spawnProcess });
    expect(r.value).toBeUndefined();
    expect(r.error).toContain('no answer');
  });
  it('says Pi is signed out when its sign-in expired', async () => {
    const s = stand([assistant([], { stopReason: 'error', errorMessage: 'OAuth refresh failed for anthropic: Refresh token expired' })]);
    expect((await answer({ prompt: 'p', schema: {}, spawnProcess: s.spawnProcess })).error).toBe('Pi is signed out.');
  });
});

describe('ask', () => {
  it('reads with read-only tools and the map\'s servers, and takes the change from the last propose call', async () => {
    const s = stand([...text('Adding it.'), ...call('c1', 'mcp__map_propose__propose_change', { nodes: [{ id: 'a' }] }), ...text('One box added.')]);
    const servers = { map_propose: { command: 'node', args: ['propose-mcp.js'], tools: ['propose_change'] } };
    const seenText = /** @type {[string, boolean | undefined][]} */ ([]);
    const done = await new Promise((resolve) => ask({ cwd: '/p', dirs: ['/code'], prompt: 'Add a box', servers, propose: { server: 'map_propose', tool: 'propose_change' },
      onText: (t, p) => seenText.push([t, p]), onDone: (...a) => resolve(a), spawnProcess: s.spawnProcess }));
    expect(done).toEqual(['One box added.', undefined, { nodes: [{ id: 'a' }] }]);
    expect(flag(s.seen.args, '--tools')).toBe('read,grep,find,ls,mcp__map_propose__propose_change');
    expect(s.seen.args).not.toContain('--no-mcp');
    expect(s.seen.args).toEqual(expect.arrayContaining(['--no-session', '--no-approve']));
    expect(s.seen.job.servers).toEqual(servers);
    expect(s.seen.prompt).toContain('/code');
    expect(seenText.some(([, p]) => p === true)).toBe(true);
    expect(s.seen.opts.cwd).toBe('/p');
  });
  it('answers with the map\'s own signed-out words, so the page offers to sign in', async () => {
    const s = stand([assistant([], { stopReason: 'error', errorMessage: '401 unauthorized' })]);
    const [t] = /** @type {any[]} */ (await new Promise((resolve) => ask({ cwd: '/p', prompt: 'q', onText() {}, onDone: (...a) => resolve(a), spawnProcess: s.spawnProcess })));
    expect(t).toBe(SIGNED_OUT);
  });
});

describe('prepare', () => {
  it('shows the tools an Execute will have but only looks up, and reports what it could not use', async () => {
    const s = stand([...call('c1', 'bash', { command: 'rm x' }, { error: true, output: 'Action preparation can only look up information. Review the brief and press Execute to make changes.' }),
      ...call('c2', 'mcp__gmail__send', {}, { error: true, output: 'Action preparation can only look up information. Review the brief and press Execute to make changes.' }),
      { type: 'message_start', message: { role: 'system', toolsAdded: [{ name: 'read' }, { name: 'bash' }] } },
      ...call('c3', 'submit_answer', { status: 'ready' }, { details: { status: 'ready' } })]);
    const done = /** @type {any[]} */ (await new Promise((resolve) => prepare({ cwd: '/p', schema: { type: 'object' }, prompt: 'Brief', onText() {}, onDone: (...a) => resolve(a), spawnProcess: s.spawnProcess })));
    expect(done[1]).toEqual({ tools: ['read', 'bash'], denied: ['mcp__gmail__send'] });
    expect(done[2]).toEqual({ status: 'ready' });
    expect(flag(s.seen.args, '--tools').split(',')).toEqual(expect.arrayContaining(['read', 'bash', 'edit', 'write', 'submit_answer']));
    expect(s.seen.args).toContain('--no-mcp');
    expect(s.seen.job.allow).toEqual(expect.arrayContaining(['read', 'grep', 'mcp__map_context__load_map']));
    expect(s.seen.job.allow).not.toContain('bash');
  });
  it('with your connectors, keeps your own MCP servers', async () => {
    const s = stand(text('ok'));
    await new Promise((resolve) => prepare({ cwd: '/p', connected: true, schema: {}, prompt: 'p', onText() {}, onDone: resolve, spawnProcess: s.spawnProcess }));
    expect(s.seen.args).not.toContain('--no-mcp');
    expect(flag(s.seen.args, '--tools')).not.toContain('mcp__');
  });
});

describe('run', () => {
  it('resumes the run by its exact id, limited to the brief\'s tools, and never pushes', async () => {
    const s = stand([...call('c1', 'bash', { command: 'npm test' }), ...call('c2', 'read', { path: 'a.js' }),
      ...call('c3', 'submit_answer', { status: 'done', summary: 'Built it.' }, { details: { status: 'done', summary: 'Built it.' } })]);
    /** @type {RunResult} */
    const r = await new Promise((resolve) => run({ cwd: '/w', session: 'run-0001', prompt: 'Build', tools: ['Bash', 'Edit', 'WebSearch'], schema: {}, system: 'Rules',
      read: (v) => /** @type {any} */ (v), onText() {}, onDone: resolve, spawnProcess: s.spawnProcess }));
    expect(flag(s.seen.args, '--session-id')).toBe('run-0001');
    expect(flag(s.seen.args, '--append-system-prompt')).toBe('Rules');
    expect(flag(s.seen.args, '--tools')).toBe('read,grep,find,ls,submit_answer,bash,edit');
    expect(s.seen.job.block.some((/** @type {string} */ re) => new RegExp(re).test('git push origin x'))).toBe(true);
    expect(r).toMatchObject({ blocked: false, text: 'Built it.', completion: { status: 'done' } });
    expect(r.calls?.[0]).toMatchObject({ tool: 'bash', ok: true, summary: 'npm test' });
    expect(r.calls?.[1]).toMatchObject({ tool: 'read', reads: true });
  });
  it('a run Pi could not finish is blocked, with why', async () => {
    const s = stand([assistant([], { stopReason: 'error', errorMessage: 'overloaded' })]);
    /** @type {RunResult} */
    const r = await new Promise((resolve) => run({ cwd: '/w', session: 'run-0002', prompt: 'p', schema: {}, system: '', read: (v) => /** @type {any} */ (v), onText() {}, onDone: resolve, spawnProcess: s.spawnProcess }));
    expect(r.blocked).toBe(true);
    expect(r.text).toContain('overloaded');
  });
});

describe('converse', () => {
  it('a chat the map runs itself gets only the map\'s own tools, none of your servers or context files', async () => {
    const s = stand(text('Proposed two boxes.'));
    const servers = { living_map: { command: 'node', args: ['mcp.js'], env: { LIVING_MAP_ONLY_MAP: 'demo' }, tools: ['living_map_read', 'living_map_change'] } };
    await new Promise((resolve) => converse({ cwd: '/maps/demo', session: 'chat-1', first: true, title: 'Living Map: Demo', system: 'Draw it.', prompt: 'Add billing', servers, onClose: () => resolve(null), spawnProcess: s.spawnProcess }));
    expect(flag(s.seen.args, '--session-id')).toBe('chat-1');
    expect(flag(s.seen.args, '--name')).toBe('Living Map: Demo');
    expect(flag(s.seen.args, '--tools')).toBe('mcp__living_map__living_map_read,mcp__living_map__living_map_change');
    expect(s.seen.args).toEqual(expect.arrayContaining(['--no-context-files', '--no-approve']));
    expect(s.seen.job.servers).toEqual(servers);
    expect(s.seen.job.allow).toEqual(['mcp__living_map__living_map_read', 'mcp__living_map__living_map_change']);
    expect(s.seen.prompt).toBe('Add billing');
  });
});
