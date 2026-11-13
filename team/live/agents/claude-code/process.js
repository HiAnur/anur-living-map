// What every Claude Code process the map starts in the background has in common: the environment it gets, the
// tools it may use, and how the words of its reply build up as they stream. Stopping a process and reading its
// output line by line are the same for every agent (../process.js). What each job asks for stays with the job.
import { fileURLToPath } from 'node:url';

const MAX_WORDS = 32_000;

// The server may itself run inside a Claude Code session. A process it starts must not take that session for
// its own, so every CLAUDE variable goes but the two that say where Claude Code keeps its sign-in.
/** @param {Record<string, string | undefined>} env */
export function claudeEnv(env) {
  env = { ...env };
  for (const key of Object.keys(env)) if (key.startsWith('CLAUDE') && !['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN'].includes(key)) delete env[key];
  return env;
}

// The map's own MCP servers, as Claude Code is given them (--mcp-config) and as it names their tools
// (mcp__<server>__<tool>): only the tools each server lists are allowed.
/** @param {McpServers} [servers] */
export const mcpConfig = (servers = {}) => ({ mcpServers: Object.fromEntries(Object.entries(servers).map(([name, { tools, ...run }]) => [name, run])) });
/** @param {McpServers} [servers] */
export const mcpTools = (servers = {}) => Object.entries(servers).flatMap(([name, s]) => s.tools.map((t) => `mcp__${name}__${t}`));

/** @param {string} s */
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";

// Claude Code settings whose PreToolUse hook (./tool-hook.js) denies every tool not named in `allowed`, with
// `reason` as what Claude is told, any shell command matching one of `commands` (regular expressions), with
// `commandReason`, and, in an Action run, any call `guard` refuses for what it sends or runs (action-sends.js).
// A hook decides before the person's own settings do, so a tool they allowed for themselves is denied here too;
// a tool named here still goes through their usual permission checks.
/**
 * @param {readonly string[]} allowed @param {string} reason @param {readonly string[]} [commands] @param {string} [commandReason]
 * @param {{ guard?: SendGuard, once?: string }} [send] what an Action run may send, and the file that counts its one send
 */
export function onlyTools(allowed, reason, commands = [], commandReason = reason, send = {}) {
  const limits = { allowed:[...allowed], reason, commands:[...commands], commandReason, ...(send.guard ? { guard:send.guard } : {}), ...(send.once ? { once:send.once } : {}) };
  return {hooks:{PreToolUse:[{matcher:'*',hooks:[{type:'command',command:`${quote(process.execPath)} ${quote(HOOK)} ${quote(JSON.stringify(limits))}`,timeout:10}]}]}};
}
const HOOK = fileURLToPath(new URL('./tool-hook.js', import.meta.url));

export { killer, readLines } from '../process.js';

// The words of a reply so far, after one more event of the stream: a new message starts a new paragraph, and
// each piece of text is added and passed to `onText`. Only the last 32,000 characters are kept.
/** @param {string} words @param {any} d one parsed line of stream-json @param {(words: string) => void} onText */
export function addWords(words, d, onText) {
  const e = d.type === 'stream_event' ? d.event : null;
  if (e?.type === 'message_start' && words) words += '\n\n';
  if (e?.type === 'content_block_delta' && typeof e.delta?.text === 'string') { words = (words + e.delta.text).slice(-MAX_WORDS); onText(words); }
  return words;
}
