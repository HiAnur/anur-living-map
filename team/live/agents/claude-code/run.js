import { spawn } from 'node:child_process';

import { addWords, claudeEnv, killer, onlyTools, readLines } from './process.js';

const MAX = 32_000;
// What every run may use besides the tools its brief names: read and search files, load a connector's tools
// before calling one, keep a task list, and return the structured result. None of them changes anything.
export const ALWAYS = ['Read', 'Grep', 'Glob', 'ToolSearch', 'TodoWrite', 'StructuredOutput'];
const OUTSIDE = 'This tool is not in the reviewed brief, so this run cannot use it. Finish with what the brief allows, or report that the task needs it.';
// The run's limit: the tools the person reviewed in the brief, and the fixed read-only set. A tool named here
// still goes through the person's own permission checks.
/** @param {readonly string[] | undefined} tools */
export const runSettings = (tools) => onlyTools([...new Set([...ALWAYS, ...(tools || [])])], OUTSIDE);
// Claude Code's tools that only read, so a call to one changed nothing a Continue could repeat
const READS = new Set([...ALWAYS, 'WebFetch', 'WebSearch', 'LS', 'NotebookRead']);
/** @param {unknown} content a tool result's content: text, or a list of blocks */
const resultText = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('\n') : '').slice(0, 4000);
// Keep the chat on disk; every follow-up resumes its exact ID, never the latest chat in a folder.
/**
 * @param {{ cwd: string, env: Record<string, string | undefined>, session: string, resume?: boolean, prompt: string,
 *   tools?: string[], schema: object, system: string, read: (value: unknown) => any,
 *   onText: (words: string) => void, onDone: (result: RunResult) => void, spawnProcess?: typeof spawn }} job
 */
export function runAction({ cwd, env, session, resume, prompt, tools, schema, system, read: readResult, onText, onDone, spawnProcess = spawn }) {
  env = claudeEnv(env);
  const proc = spawnProcess('claude', ['-p', ...(resume ? ['--resume', session] : ['--session-id', session]),
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--permission-mode', 'auto', '--permission-prompts', 'none', '--settings', JSON.stringify(runSettings(tools)),
    '--json-schema', JSON.stringify(schema), '--append-system-prompt', system],
  { cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let words = '', errors = '', /** @type {RunResult | null} */ result = null, done = false, stopped = false, /** @type {ReturnType<typeof setTimeout> | undefined} */ killTimer;
  // every tool call the run makes, read from the stream as Claude Code reports it, so the map can judge the run
  // by what it did rather than what it says
  const calls = /** @type {Map<string, ToolCall>} */ (new Map());
  /** @param {RunResult} value */
  const finish = (value) => { if (done) return; done = true; clearTimeout(killTimer); ended(); onDone({ ...value, calls:[...calls.values()] }); };
  const { kill, done: ended } = killer(proc);
  /** @param {string} line */
  const read = (line) => {
    let d; try { d = JSON.parse(line); } catch { return; }
    if (!d || typeof d !== 'object') return;
    words = addWords(words, d, onText);
    const blocks = Array.isArray(d.message?.content) ? d.message.content : [];
    if (d.type === 'assistant') for (const b of blocks) if (b?.type === 'tool_use' && typeof b.id === 'string' && !calls.has(b.id))
      calls.set(b.id, { tool:String(b.name), input:b.input ?? null, ok:null, output:'', ...(READS.has(String(b.name)) ? { reads:true } : {}), ...(b.name === 'Bash' && typeof b.input?.command === 'string' ? { summary:b.input.command.slice(0, 160) } : {}) });
    if (d.type === 'user') for (const b of blocks) { const call = b?.type === 'tool_result' && calls.get(b.tool_use_id); if (call) Object.assign(call, { ok:!b.is_error, output:resultText(b.content) }); }
    if (d.type === 'assistant' && !words) {
      words = (Array.isArray(d.message?.content) ? d.message.content : []).filter((/** @type {any} */ b) => b?.type === 'text' && typeof b.text === 'string').map((/** @type {any} */ b) => b.text).join('\n\n').slice(-MAX);
      if (words) onText(words);
    }
    if (d.type === 'result') {
      const denied = Array.isArray(d.permission_denials) && d.permission_denials.length > 0;
      const completion = !d.is_error && !denied ? readResult(d.structured_output) : null;
      result = { text: String(completion?.summary || d.result || (Array.isArray(d.errors) ? d.errors.join('\n') : '') || words || 'Claude returned no answer.').slice(-MAX), blocked: !!d.is_error || denied };
      if (completion && !result.blocked) { /** @type {any} */ (result).completion = completion; result.blocked = completion.status === 'blocked'; }
      if (denied) result.text += '\n\nSome tools need permission. The task may be incomplete. Resolve access, then Continue here.';
    }
  };
  const flush = readLines(proc, read);
  proc.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-2000); });
  proc.stdin.on('error', () => {});
  proc.on('error', () => finish({ blocked: true, text: 'Could not start Claude. Check that Claude Code is installed and signed in on this computer.' }));
  proc.on('close', (code) => {
    flush();
    finish(stopped ? { blocked: true, text: 'Stopped. Some steps may already have finished. Continue will check this conversation before doing more.' }
      : code === 0 && result ? result
      : { blocked: true, text: result?.text || `Claude stopped before returning a result.${errors.trim() ? '\n\n'+errors.trim() : ''}${words ? '\n\n'+words : ''}` });
  });
  proc.stdin.end(prompt);
  return () => { if (done || stopped) return; stopped = true; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 3000); killTimer.unref?.(); };
}
