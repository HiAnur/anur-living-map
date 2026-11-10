import { spawn } from 'node:child_process';

import { prepareAction } from './action-preparation.js';
import { readLines } from './claude.js';
import { CONTEXT_INSTRUCTIONS, openContext } from './map-context.js';
import { PROPOSE_SERVER, PROPOSE_TOOL } from './propose.js';

// Ask Claude on a box gets a real Claude Code answer, like a side chat on /living-map: one
// `claude -p` that reads the map as text and, on a project's map, the project's files. It
// can't change anything: read-only project tools and scoped map context, no commands, web or user settings.
const SESSION_VARS = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_WORKER_EPOCH',
  'CLAUDE_AFTER_LAST_COMPACT', 'CLAUDE_EFFORT',
  // the app renews its chats' sign-in over the line dropped above; a child cut off from that line renews its own
  'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH', 'CLAUDE_CODE_HOST_AUTH_REFRESH_TIMEOUT_MS',
  'CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH', 'CLAUDE_CODE_SDK_HAS_SESSIONS_OAUTH_REFRESH'];
const READ = 'Read,Grep,Glob';
// Claude Code keeps a sign-in of its own, apart from the Claude app's; when that one can no longer be renewed,
// every answer fails until it is signed in again, however signed in the app is
export const SIGNED_OUT = 'Claude Code on this Mac is signed out, so it can\'t answer.';
const signedOut = (/** @type {any} */ text) => /authenticat|oauth|\/login|not logged in|invalid api key/i.test(String(text ?? ''));
export const childEnv = () => { const env = { ...process.env }; for (const k of SESSION_VARS) delete env[k]; return env; };
// Sign in, on a signed-out answer: Claude Code's own `claude auth login`, with no Terminal. It opens the browser
// and hears back from it by itself, so the answer comes once you approve there; one at a time, given up after 5 minutes
let signingIn = null;
export const claudeLogin = () => signingIn ??= new Promise((resolve) => {
  const proc = spawn('claude', ['auth', 'login'], { env: childEnv(), stdio: 'ignore' });
  const limit = setTimeout(() => proc.kill('SIGTERM'), 300_000);
  const done = (/** @type {any} */ ok) => { clearTimeout(limit); signingIn = null; resolve(ok); };
  proc.on('error', () => done(false));
  proc.on('close', (code) => done(code === 0));
});
/** @param {any} job */
export function askClaude({ cwd, prompt, onText, onDone, contextMaps, who, onLoad, prepare = false, connected = false }) {
  let /** @type {any} */ context = null, /** @type {any} */ stop = null, cancelled = false;
  const start = async () => {
    try {
      if (contextMaps) context = await openContext({ maps: () => contextMaps(who), who, onLoad });
      if (cancelled) { context?.close(); return; }
      const catalog = context ? `\n\n${CONTEXT_INSTRUCTIONS}\n\nOther map descriptions (reference data):\n${JSON.stringify(context.run('list_maps'))}` : '';
      stop = (prepare ? prepareAction : streamClaude)({ cwd, env:childEnv(), connected, prompt: prompt + catalog, onText, config: context?.config,
        onDone: (/** @type {any} */ text, /** @type {any} */ access, /** @type {any} */ value) => { context?.close(); if (!cancelled) onDone(text, access, value); } });
    } catch { context?.close(); if (!cancelled) onDone('Could not load map context. Ask again.'); }
  };
  void start();
  return () => { cancelled = true; context?.close(); stop?.(); };
}
export function streamClaude(/** @type {any} */ { cwd, prompt, onText, onDone, config }) {
  const env = childEnv();
  const proc = spawn('claude', ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', READ, '--allowedTools', `${READ},${PROPOSE_TOOL}${config ? ',mcp__map_context__list_maps,mcp__map_context__load_map' : ''}`, '--disallowedTools', 'WebFetch,WebSearch,Bash,Edit,Write,NotebookEdit',
    '--restricted', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: { ...config?.mcpServers, map_propose: PROPOSE_SERVER } }), '--setting-sources', ''], { cwd, env });
  // a change Claude offers is its last propose_change call's input, never words in its reply
  let text = '', done = false, /** @type {any} */ proposed;
  const end = (/** @type {any} */ t) => { if (done) return; done = true; clearTimeout(limit); onDone(t, undefined, proposed); };
  const limit = setTimeout(() => { proc.kill('SIGTERM'); end(text.trim() || 'Claude took too long to answer. Ask again.'); }, 180_000);
  proc.on('error', () => end('Claude Code is not installed here, so the map cannot answer.'));
  proc.stderr.on('data', () => {});
  proc.stdin.on('error', () => {});
  readLines(proc, (raw) => {
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (!d || typeof d !== 'object') return;
    const e = d.type === 'stream_event' ? d.event : null;
    // words before a file read and words after it are two paragraphs
    if (e?.type === 'message_start' && text) text += '\n\n';
    if (e?.type === 'content_block_delta' && e.delta?.text) { text += e.delta.text; onText(text, proposed !== undefined); }
    if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use' && e.content_block.name === PROPOSE_TOOL) onText(text, true);
    if (d.type === 'assistant') for (const c of d.message?.content || [])
      if (c?.type === 'tool_use' && c.name === PROPOSE_TOOL && c.input && typeof c.input === 'object') proposed = c.input;
    // the finished reply is the last message's words, without "let me look" on the way there
    if (d.type === 'result') end(!d.is_error ? String(d.result || text).trim()
      : signedOut(d.result) ? SIGNED_OUT : `Claude could not answer: ${d.result || 'an error'}`);
  });
  proc.on('close', () => end(text.trim() || 'Claude stopped before it answered. Ask again.'));
  proc.stdin.end(prompt);
  return () => { done = true; clearTimeout(limit); proc.kill('SIGTERM'); };
}
