// What every Pi process the map starts has in common: the environment it gets, the extension it loads with the
// job's servers, schema and limits (./extension.js), and how its JSON event stream (`pi -p --mode json`) is read
// into words, tool calls and the submitted answer. What each job asks for stays with the job (./index.js).
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { killer, readLines } from '../process.js';
import { SUBMIT } from './extension.js';

const EXTENSION = fileURLToPath(new URL('./extension.js', import.meta.url));
const MAX = 32_000;

export const SIGNED_OUT = 'Pi on this Mac is signed out, so it can\'t answer. Run pi in a terminal and type /login.';
/** @param {unknown} text */
export const signedOut = (text) => /oauth|refresh token|authenticat|unauthori[sz]ed|\b401\b|api key|no credentials|not logged in|\/login/i.test(String(text ?? ''));

// The server may run inside a Pi or Claude Code chat. A process it starts must not take that chat for its own.
const SESSION_VARS = ['PI_SESSION_ID', 'PI_SESSION_FILE', 'PI_PROVIDER', 'PI_MODEL', 'PI_REASONING_LEVEL', 'LIVING_MAP_PI_JOB',
  'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_ENTRYPOINT'];
/** @param {Record<string, string | undefined>} [env] */
export function piEnv(env = process.env) {
  env = { ...env };
  for (const k of SESSION_VARS) delete env[k];
  return env;
}

// Pi names an MCP tool mcp__<server>__<tool>, every character but letters, digits and _ made _
const safe = (/** @type {string} */ s) => s.replace(/[^A-Za-z0-9_]/g, '_');
/** @param {McpServers} [servers] */
export const mcpTools = (servers = {}) => Object.entries(servers).flatMap(([name, s]) => s.tools.map((t) => `mcp__${safe(name)}__${safe(t)}`));

// A brief names tools as the agent that prepared it saw them; one prepared with Claude Code uses its names
const PI_NAMES = /** @type {Record<string, string>} */ ({ Read: 'read', Grep: 'grep', Glob: 'find', LS: 'ls', Bash: 'bash', Edit: 'edit', MultiEdit: 'edit', Write: 'write', NotebookEdit: 'edit' });
/** @param {string} name @returns {string | null} */
export const piTool = (name) => PI_NAMES[name] || (/^[a-z][a-z_]*$/.test(name) || name.startsWith('mcp__') ? name : null);

/** @param {unknown} content a tool result's content: text, or a list of blocks */
const resultText = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n') : '').slice(0, 4000);
/** @param {any} message */
const textOf = (message) => (Array.isArray(message?.content) ? message.content : []).filter((/** @type {any} */ b) => b?.type === 'text' && typeof b.text === 'string').map((/** @type {any} */ b) => b.text).join('\n').trim();

/**
 * One `pi -p --mode json` run: the prompt on stdin, the job handed to the extension through a file only this user
 * can read (removed when the run ends). `onText` gets the words so far as they stream; `onToolCall` the name of each
 * tool the model starts to call, before its input is complete.
 * @param {{ cwd: string, prompt: string, args: string[], job?: PiJob, env?: Record<string, string | undefined>, timeoutMs?: number,
 *   onText?: (words: string) => void, onToolCall?: (name: string, words: string) => void, spawnProcess?: typeof spawn }} o
 * @returns {{ stop: () => void, done: Promise<PiRun> }}
 */
export function startPi({ cwd, prompt, args, job = {}, env = process.env, timeoutMs = 0, onText = () => {}, onToolCall = () => {}, spawnProcess = spawn }) {
  const jobFile = path.join(os.tmpdir(), `living-map-pi-${crypto.randomUUID()}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
  const proc = spawnProcess('pi', ['-p', '--mode', 'json', '-ne', '-e', 'builtin:mcp', '-e', EXTENSION, '--no-skills', '--no-prompt-templates', '--no-themes', ...args],
    { cwd, env: { ...piEnv(env), LIVING_MAP_PI_JOB: jobFile }, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const { kill, done: ended } = killer(proc);
  /** @type {PiRun} */
  const run = { words: '', text: '', calls: [], tools: [], error: null, cost: 0, stopped: false, timedOut: false, notFound: false };
  const tools = new Set(), calls = /** @type {Map<string, PiRun['calls'][number]>} */ (new Map());
  let stderr = '', /** @type {ReturnType<typeof setTimeout> | undefined} */ killTimer;
  const stop = () => { if (run.stopped) return; run.stopped = true; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 3000); killTimer.unref?.(); };
  const limit = timeoutMs ? setTimeout(() => { run.timedOut = true; stop(); }, timeoutMs) : undefined;
  limit?.unref?.();
  /** @param {string} line */
  const read = (line) => {
    let d; try { d = JSON.parse(line); } catch { return; }
    if (!d || typeof d !== 'object') return;
    const m = d.message;
    if (d.type === 'message_start' && m?.role === 'system') {
      for (const t of m.toolsAdded || []) if (typeof t?.name === 'string') tools.add(t.name);
      for (const t of m.toolsRemoved || []) tools.delete(t?.name);
    }
    // words before a tool call and words after it are two paragraphs
    if (d.type === 'message_start' && m?.role === 'assistant' && run.words) run.words += '\n\n';
    const e = d.type === 'message_update' ? d.assistantMessageEvent : null;
    if (e?.type === 'text_delta' && typeof e.delta === 'string') { run.words = (run.words + e.delta).slice(-MAX); onText(run.words); }
    if (e?.type === 'toolcall_start' && typeof e.toolName === 'string') onToolCall(e.toolName, run.words);
    if (d.type === 'message_end' && m?.role === 'assistant') {
      const t = textOf(m); if (t) run.text = t.slice(-MAX);
      if (Number.isFinite(m.usage?.cost?.total)) run.cost += m.usage.cost.total;
      run.error = m.stopReason === 'error' ? String(m.errorMessage || 'an error') : null;
    }
    if (d.type === 'auto_retry_end' && d.success === false) run.error = String(d.finalError || run.error || 'an error');
    if (d.type === 'tool_execution_start' && typeof d.toolCallId === 'string' && !calls.has(d.toolCallId))
      calls.set(d.toolCallId, { tool: String(d.toolName), input: d.args ?? null, ok: null, output: '' });
    if (d.type === 'tool_execution_end') {
      const call = calls.get(d.toolCallId);
      if (call) Object.assign(call, { ok: !d.isError, output: resultText(d.result?.content) });
      // the answer is the last call to submit_answer that passed its schema; Pi checks it before the call runs
      if (d.toolName === SUBMIT && !d.isError) run.value = d.result?.details;
    }
  };
  const flush = readLines(proc, read);
  proc.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  proc.stdin.on('error', () => {});
  const done = new Promise((resolve) => {
    let over = false;
    /** @param {number | null} code */
    const finish = (code) => {
      if (over) return; over = true;
      clearTimeout(limit); clearTimeout(killTimer); ended(); fs.rm(jobFile, { force: true }, () => {});
      run.calls = [...calls.values()]; run.tools = [...tools];
      // a run that ended with no answer and no words says why in what it printed to stderr
      if (code && !run.error && !run.text && !run.stopped) run.error = stderr.trim().split('\n').at(-1) || `pi exited with ${code}`;
      resolve(run);
    };
    proc.on('error', () => { run.notFound = true; finish(null); });
    proc.on('close', (code) => { flush(); finish(code); });
  });
  proc.stdin.end(prompt);
  return { stop, done: /** @type {Promise<PiRun>} */ (done) };
}
