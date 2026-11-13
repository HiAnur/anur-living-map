import { spawn } from 'node:child_process';

import { childEnv } from './ask.js';
import { claudeEnv, mcpConfig, mcpTools, onlyTools } from './process.js';

// Claude Code's own tools that change files, run commands or reach the web: kept out of view, and the hook below
// refuses them too
const NEVER = 'Bash,Edit,Write,MultiEdit,NotebookEdit,WebFetch,WebSearch';
const OUTSIDE = 'This chat can only read and change its own map, with the tools of that map.';
// the map's tools, and loading them when Claude Code holds them back until searched for
/** @param {McpServers} servers */
const allowed = (servers) => ['ToolSearch', ...mcpTools(servers)];
/** @param {McpServers} servers */
export const converseSettings = (servers) => onlyTools(allowed(servers), OUTSIDE);

// A chat the map runs itself, headless, one turn per call, with nobody to ask. It may use only the map's own tools
// it is given (`servers`): none of your settings, CLAUDE.md, skills or connectors, and a hook that refuses every
// other tool, so what it reads (a prompt, a meeting, a teammate's box) cannot make it act anywhere else. The first
// turn names the session; later ones resume it by id.
/** @param {ConverseJob & { spawnProcess?: typeof spawn }} job */
export function converse({ cwd, session, first, title, system, prompt, servers, onClose, spawnProcess = spawn }) {
  const proc = spawnProcess('claude', ['-p', ...(first ? ['--session-id', session, '--name', title] : ['--resume', session]),
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--allowedTools', allowed(servers).join(','), '--disallowedTools', NEVER,
    '--setting-sources', '', '--strict-mcp-config', '--mcp-config', JSON.stringify(mcpConfig(servers)), '--settings', JSON.stringify(converseSettings(servers)),
    '--append-system-prompt', system, '--output-format', 'json'], { cwd, env: claudeEnv(childEnv()) });
  const limit = setTimeout(() => proc.kill('SIGTERM'), 20 * 60_000);
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {}); proc.stdin.on('error', () => {});
  proc.on('error', () => {});
  proc.on('close', () => { clearTimeout(limit); onClose(); });
  proc.stdin.end(prompt);
  return () => { proc.kill('SIGTERM'); };
}
