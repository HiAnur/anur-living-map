import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawned = vi.hoisted(() => ({ calls: /** @type {any[]} */ ([]), next: /** @type {any} */ (null) }));
vi.mock('node:child_process', () => ({ spawn: (...args) => { spawned.calls.push(args); return spawned.next; } }));

const { SIGNED_OUT, streamClaude } = await import('./ask.js');
const { PROPOSE_TOOL } = await import('./propose.js');

// Ask Claude on a box, on a stand-in for the `claude` process: what it may do, what its answer is in each way a
// run can end, and that an answer is given once.
function harness(config) {
  /** @type {any} */ const proc = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  spawned.next = proc; spawned.calls.length = 0;
  const words = [], answers = [], proposing = [], proposals = [];
  const stop = streamClaude({ cwd: '/sample/project', prompt: 'What is this box for?', onText: (t, p) => { words.push(t); proposing.push(p); },
    onDone: (t, _access, p) => { answers.push(t); proposals.push(p); }, config });
  const event = (d) => proc.stdout.write(JSON.stringify(d) + '\n');
  const say = (text) => event({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
  return { proc, words, answers, proposing, proposals, stop, event, say, args: spawned.calls[0][1], opts: spawned.calls[0][2] };
}
const flag = (args, name) => args[args.indexOf(name) + 1];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete process.env.CLAUDECODE; });

describe('Ask Claude on a box', () => {
  it('runs read-only, confined to the project, with no web, commands or settings of yours', () => {
    process.env.CLAUDECODE = '1';
    const h = harness();
    expect(spawned.calls[0][0]).toBe('claude');
    expect(flag(h.args, '--tools')).toBe('Read,Grep,Glob');
    expect(flag(h.args, '--allowedTools')).toBe(`Read,Grep,Glob,${PROPOSE_TOOL}`);
    expect(flag(h.args, '--disallowedTools')).toBe('WebFetch,WebSearch,Bash,Edit,Write,NotebookEdit');
    for (const name of ['-p', '--restricted', '--no-session-persistence', '--strict-mcp-config']) expect(h.args).toContain(name);
    expect(flag(h.args, '--setting-sources')).toBe('');
    expect(Object.keys(JSON.parse(flag(h.args, '--mcp-config')).mcpServers)).toEqual(['map_propose']);
    expect(h.opts.cwd).toBe('/sample/project');
    expect(h.opts.env.CLAUDECODE).toBeUndefined();
    expect(h.opts.env.PATH).toBe(process.env.PATH);
  });
  it('may read the other maps you checked, and nothing more, when given their context', () => {
    const config = { mcpServers: { map_context: { command: 'node' } } }, h = harness(config);
    expect(flag(h.args, '--allowedTools')).toBe(`Read,Grep,Glob,${PROPOSE_TOOL},mcp__map_context__list_maps,mcp__map_context__load_map`);
    expect(flag(h.args, '--tools')).toBe('Read,Grep,Glob');
    const servers = JSON.parse(flag(h.args, '--mcp-config')).mcpServers;
    expect(Object.keys(servers)).toEqual(['map_context', 'map_propose']);
    expect(servers.map_context).toEqual(config.mcpServers.map_context);
  });
  it('shows the words as they come, a new paragraph for each message, and answers with the result', () => {
    const h = harness();
    h.event({ type: 'stream_event', event: { type: 'message_start' } });
    h.say('Let me look.'); h.event({ type: 'stream_event', event: { type: 'message_start' } }); h.say('It holds'); h.say(' the plan.');
    expect(h.words).toEqual(['Let me look.', 'Let me look.\n\nIt holds', 'Let me look.\n\nIt holds the plan.']);
    h.proc.stdout.write('not json\nnull\n7\n');
    h.event({ type: 'result', result: '  It holds the plan.  ', is_error: false });
    expect(h.answers).toEqual(['It holds the plan.']);
    h.proc.emit('close', 0); vi.advanceTimersByTime(200_000);
    expect(h.answers).toHaveLength(1);
    expect(h.proc.kill).not.toHaveBeenCalled();
  });
  it('offers the last propose_change call\'s input as the change, and says so while it is written', () => {
    const h = harness();
    h.say('Adding a box.');
    h.event({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: PROPOSE_TOOL } } });
    const call = (input) => h.event({ type: 'assistant', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: PROPOSE_TOOL, input }] } });
    call({ nodes: [{ id: 'one' }] }); call({ nodes: [{ id: 'two' }] });
    h.event({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a' } }, { type: 'tool_use', name: PROPOSE_TOOL, input: 'not an object' }] } });
    h.say(' Done.');
    h.event({ type: 'result', result: 'Adding a box.', is_error: false });
    expect(h.proposing).toEqual([false, true, true]);
    expect(h.proposals).toEqual([{ nodes: [{ id: 'two' }] }]);
  });
  it('offers no change when Claude calls no propose_change', () => {
    const h = harness(); h.say('```map\n{"nodes":[{"id":"x"}]}\n```'); h.event({ type: 'result', is_error: false });
    expect(h.proposals).toEqual([undefined]);
  });
  it('answers with the words so far when the result has none', () => {
    const h = harness(); h.say('Only words.'); h.event({ type: 'result', is_error: false });
    expect(h.answers).toEqual(['Only words.']);
  });
  it('says so when Claude Code is signed out, and gives the error otherwise', () => {
    const out = harness(); out.event({ type: 'result', is_error: true, result: 'Invalid API key · Please run /login' });
    expect(out.answers).toEqual([SIGNED_OUT]);
    const bad = harness(); bad.event({ type: 'result', is_error: true, result: 'Overloaded' });
    expect(bad.answers).toEqual(['Claude could not answer: Overloaded']);
    const blank = harness(); blank.event({ type: 'result', is_error: true });
    expect(blank.answers).toEqual(['Claude could not answer: an error']);
  });
  it('answers with what it had, or says it stopped, when the process ends with no result', () => {
    const some = harness(); some.say(' Half an answer '); some.proc.emit('close', 1);
    expect(some.answers).toEqual(['Half an answer']);
    const none = harness(); none.proc.emit('close', 1);
    expect(none.answers).toEqual(['Claude stopped before it answered. Ask again.']);
  });
  it('says Claude Code is missing when it cannot start, once', () => {
    const h = harness(); h.proc.emit('error', new Error('ENOENT')); h.proc.emit('close', 1);
    expect(h.answers).toEqual(['Claude Code is not installed here, so the map cannot answer.']);
  });
  it('gives up after three minutes: the process is stopped and the answer is what came, or that it took too long', () => {
    const quiet = harness(); vi.advanceTimersByTime(179_999); expect(quiet.answers).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(quiet.proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(quiet.answers).toEqual(['Claude took too long to answer. Ask again.']);
    const partial = harness(); partial.say('So far'); vi.advanceTimersByTime(180_000);
    expect(partial.answers).toEqual(['So far']);
  });
  it('stops when asked, and then gives no answer', () => {
    const h = harness(); h.say('Thinking'); h.stop();
    expect(h.proc.kill).toHaveBeenCalledWith('SIGTERM');
    h.event({ type: 'result', result: 'Late', is_error: false }); h.proc.emit('close', null); vi.advanceTimersByTime(200_000);
    expect(h.answers).toEqual([]);
  });
  it('sends the question on the process\'s input', async () => {
    const h = harness(), chunks = [];
    h.proc.stdin.on('data', (c) => chunks.push(String(c)));
    vi.useRealTimers(); await new Promise((r) => setImmediate(r));
    expect(chunks.join('')).toBe('What is this box for?');
  });
  it('keeps a character whole when it arrives split across two chunks', () => {
    const h = harness(), bytes = Buffer.from(JSON.stringify({ type: 'result', result: 'Café', is_error: false }) + '\n'), cut = bytes.indexOf(0xc3) + 1;
    h.proc.stdout.write(bytes.subarray(0, cut)); h.proc.stdout.write(bytes.subarray(cut));
    expect(h.answers).toEqual(['Café']);
  });
});
