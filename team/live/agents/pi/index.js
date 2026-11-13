// Pi as the team map's agent: every process the map starts for its own work runs `pi` with the flags in this
// folder, the same jobs Claude Code does in ../claude-code. Pi has no permission prompts, so each job's limits are
// its tool list (--tools) and what ./extension.js refuses.
import { spawn } from 'node:child_process';
import os from 'node:os';

import { SUBMIT } from './extension.js';
import { mcpTools, piTool, SIGNED_OUT, signedOut, startPi } from './process.js';
export { piChats } from './conversation.js';

const READ = ['read', 'grep', 'find', 'ls'];
const MAX = 32_000;
// tools that only read, so a call to one changed nothing a Continue could repeat
const READS = new Set([...READ, SUBMIT, 'tool_search']);
/** @param {string} tool @returns {ToolReach} how far it reaches, as ../claude-code/run.js marks Claude Code's */
const reach = (tool) => (READS.has(tool) ? 'reads' : tool === 'edit' || tool === 'write' ? 'files' : tool === 'bash' ? 'shell' : 'others');
// Preparation sees the tools an Execute will have, so a build that needs them can be checked, but only looks up
const LOOKUPS = [...READ, 'tool_search', 'codemode', 'mcp__map_context__list_maps', 'mcp__map_context__load_map'];
const BUILT_IN = ['bash', 'edit', 'write'];
const PREPARE_ONLY = 'Action preparation can only look up information. Review the brief and press Execute to make changes.';
// The map pushes a build's branch and opens its pull request itself (as in ../claude-code/run.js)
const HANDS_OFF = ['\\bgit\\s+push\\b', '(^|[;&|(]\\s*)gh\\s+pr\\s+create\\b'];
const MAP_DOES_IT = 'The map pushes the branch and opens the pull request when you finish. Leave your changes in the worktree, uncommitted or committed, and finish the task.';
const NOT_INSTALLED = 'Pi is not installed here, so the map cannot answer.';

// MCP servers: only the job's own, or with --no-mcp none at all, never the person's mcp.json behind its back.
// A --tools list that names an mcp__ tool keeps only those MCP tools.
/** @param {string[]} tools */
const toolArgs = (tools) => ['--tools', [...new Set(tools)].join(','), ...(tools.some((t) => t.startsWith('mcp__')) ? [] : ['--no-mcp'])];
/** @param {PiRun} r @param {string} what */
const failure = (r, what) => (signedOut(r.error) ? SIGNED_OUT : `Pi could not ${what}: ${r.error}`);

/** @param {AskJob & { spawnProcess?: typeof spawn }} job */
export function ask({ cwd, dirs = [], prompt, onText, onDone, servers, propose, spawnProcess }) {
  // a change Pi offers is its last call to the propose tool, never words in its reply
  const proposeTool = propose ? mcpTools({ [propose.server]: { command: '', args: [], tools: [propose.tool] } })[0] : null;
  let proposing = false;
  const more = dirs.length ? `\n\nYou may also read these folders, never change them: ${dirs.join(', ')}` : '';
  const { stop, done } = startPi({ cwd, prompt: prompt + more, job: { servers }, timeoutMs: 180_000, spawnProcess,
    args: ['--no-session', '--no-approve', ...toolArgs([...READ, ...mcpTools(servers)])],
    onText: (words) => onText(words, proposing),
    onToolCall: (name, words) => { if (name === proposeTool) { proposing = true; onText(words, true); } } });
  let cancelled = false;
  done.then((r) => {
    if (cancelled) return;
    const proposed = r.calls.filter((c) => c.tool === proposeTool && c.input && typeof c.input === 'object').at(-1)?.input;
    onDone(r.notFound ? NOT_INSTALLED : r.timedOut ? (r.words.trim() || 'Pi took too long to answer. Ask again.') : r.error ? failure(r, 'answer')
      : (r.text || r.words).trim() || 'Pi stopped before it answered. Ask again.', undefined, proposed);
  });
  return () => { cancelled = true; stop(); };
}

/** @param {PrepareJob & { spawnProcess?: typeof spawn }} job */
export function prepare({ cwd, connected = false, servers, schema, prompt, onText, onDone, spawnProcess }) {
  const map = mcpTools(servers);
  // connected: the person's own MCP servers too (a --tools list with no mcp__ entry keeps them all)
  const tools = [...READ, ...BUILT_IN, SUBMIT, ...(connected ? [] : map)];
  const { stop, done } = startPi({ cwd, prompt, timeoutMs: 180_000, spawnProcess, onText,
    job: { servers, schema, allow: [...LOOKUPS, ...map], allowReason: PREPARE_ONLY },
    args: ['--no-session', ...(connected ? ['--tools', tools.join(',')] : ['--no-approve', ...toolArgs(tools)])] });
  done.then((r) => {
    // a built-in tool refused here is preparation working as meant (it may only look things up), not missing access
    const denied = [...new Set(r.calls.filter((c) => c.ok === false && c.output.includes(PREPARE_ONLY) && !BUILT_IN.includes(c.tool)).map((c) => c.tool))];
    const text = r.notFound ? 'Pi is not installed or could not start. Check it is installed and signed in.'
      : r.timedOut ? 'Pi took too long to prepare this action. Try again.'
      : r.stopped ? 'Preparation stopped. Try again.'
      : r.error ? (signedOut(r.error) ? SIGNED_OUT : 'Pi stopped before preparation finished. Check your sign-in and tool access, then try again.')
      : r.text || r.words || r.value !== undefined ? (r.text || r.words).slice(-MAX)
      : 'Pi stopped before returning a prepared action. Try again.';
    onDone(text, { tools: r.tools, denied }, r.error ? undefined : r.value);
  });
  return stop;
}

/** @param {RunJob & { spawnProcess?: typeof spawn }} job */
export function run({ cwd, session, prompt, tools, guard, schema, system, read: readResult, onText, onDone, spawnProcess }) {
  // Pi's --session-id opens the chat with that id, or starts it: a Continue resumes the exact run, never the latest chat
  const allowed = [...READ, SUBMIT, ...(tools || []).map(piTool).filter((t) => t !== null)];
  const { stop, done } = startPi({ cwd, prompt, spawnProcess, onText, job: { schema, block: HANDS_OFF, blockReason: MAP_DOES_IT, ...(guard ? { guard } : {}) },
    args: ['--session-id', session, '--append-system-prompt', system, ...toolArgs(allowed)] });
  done.then((r) => {
    const calls = r.calls.map((c) => ({ ...c, ...(READS.has(c.tool) ? { reads: true } : {}),
      ...(c.tool === 'bash' && typeof (/** @type {any} */ (c.input))?.command === 'string' ? { summary: /** @type {any} */ (c.input).command.slice(0, 160) } : {}) }));
    if (r.stopped) return onDone({ blocked: true, text: 'Stopped. Some steps may already have finished. Continue will check this conversation before doing more.', calls });
    if (r.notFound) return onDone({ blocked: true, text: 'Could not start Pi. Check that Pi is installed and signed in on this computer.', calls });
    if (r.error) return onDone({ blocked: true, text: `${failure(r, 'finish')}${r.words ? `\n\n${r.words}` : ''}`.slice(-MAX), calls });
    const completion = r.value !== undefined ? readResult(r.value) : null;
    /** @type {RunResult} */
    const result = { text: String(completion?.summary || r.text || r.words || 'Pi returned no answer.').slice(-MAX), blocked: false, calls };
    if (completion) { result.completion = completion; result.blocked = completion.status === 'blocked'; }
    onDone(result);
  });
  return stop;
}

/** @param {ConverseJob & { spawnProcess?: typeof spawn }} job */
export function converse({ cwd, session, first, title, system, prompt, onClose, spawnProcess }) {
  // the person's own MCP servers stay on: the map's chat draws with living_map_change from their mcp.json
  const { stop, done } = startPi({ cwd, prompt, spawnProcess, timeoutMs: 20 * 60_000,
    args: ['--session-id', session, ...(first ? ['--name', title] : []), '--append-system-prompt', system] });
  done.then(() => onClose());
  return stop;
}

/**
 * One answer held to a JSON schema, with no tools but the one that returns it, no MCP servers and no session kept.
 * @param {AnswerJob & { spawnProcess?: typeof spawn }} job
 * @returns {Promise<AnswerResult>}
 */
export async function answer({ prompt, schema, model, timeoutMs = 300_000, signal, spawnProcess }) {
  const started = Date.now();
  const { stop, done } = startPi({ cwd: os.tmpdir(), prompt, job: { schema }, timeoutMs, spawnProcess,
    args: ['--no-session', '--no-context-files', '--no-approve', ...toolArgs([SUBMIT]), ...(model ? ['--model', model] : [])] });
  const abort = () => stop();
  if (signal?.aborted) stop(); else signal?.addEventListener('abort', abort, { once: true });
  const r = await done;
  signal?.removeEventListener('abort', abort);
  const ms = Date.now() - started, cost = r.cost ? { value: r.cost, unit: 'usd' } : undefined;
  if (r.stopped && !r.timedOut) return { error: 'Stopped.', stopped: true, ms };
  if (r.timedOut) return { error: 'The agent took too long to answer.', ms };
  if (r.notFound) return { error: 'Pi could not be started. Is it installed?', ms };
  if (r.error || r.value === undefined) return { error: signedOut(r.error) ? 'Pi is signed out.' : `The agent gave no answer: ${String(r.error || r.text || 'no submit_answer call').slice(0, 200)}`, cost, ms };
  return { value: r.value, cost, ms };
}

// Pi signs in only from its own screen (/login), so the map opens a terminal with Pi in it for you
function signIn() {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((/** @type {(ok: boolean) => void} */ resolve) => {
    spawn('osascript', ['-e', 'tell application "Terminal" to do script "pi"', '-e', 'tell application "Terminal" to activate'], { stdio: 'ignore' })
      .on('error', () => resolve(false)).on('close', () => resolve(false));
  });
}

/** @returns {AgentWorker} */
export const pi = () => ({ name: 'Pi', signedOut: SIGNED_OUT, signIn, ask, prepare, run, reach, converse, answer });
