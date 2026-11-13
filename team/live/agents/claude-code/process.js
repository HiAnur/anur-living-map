// What every Claude Code process the map starts in the background has in common: the environment it gets, the
// tools it may use, and how the words of its reply build up as they stream. Stopping a process and reading its
// output line by line are the same for every agent (../process.js). What each job asks for stays with the job.

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

// Claude Code settings whose PreToolUse hook denies every tool not named in `allowed`, with `reason` as what
// Claude is told, and any shell command matching one of `commands` (regular expressions), with `commandReason`.
// A hook decides before the person's own settings do, so a tool they allowed for themselves is denied here too;
// a tool named here still goes through their usual permission checks.
/** @param {readonly string[]} allowed @param {string} reason @param {readonly string[]} [commands] @param {string} [commandReason] */
export function onlyTools(allowed, reason, commands = [], commandReason = reason) {
  const deny = (/** @type {string} */ why) => `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:${JSON.stringify(why)}}}))`;
  const script = `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{let d={};try{d=JSON.parse(input)}catch{/* unreadable: no name, so denied */};const name=d.tool_name,command=name==='Bash'&&typeof d.tool_input?.command==='string'?d.tool_input.command:'';if(!${JSON.stringify(allowed)}.includes(name))${deny(reason)};else if(${JSON.stringify(commands)}.some(r=>new RegExp(r).test(command)))${deny(commandReason)};});`;
  return {hooks:{PreToolUse:[{matcher:'*',hooks:[{type:'command',command:`${quote(process.execPath)} -e ${quote(script)}`,timeout:10}]}]}};
}

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
