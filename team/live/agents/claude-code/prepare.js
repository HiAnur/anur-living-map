import { spawn } from 'node:child_process';

import { addWords, claudeEnv, killer, mcpConfig, onlyTools, readLines } from './process.js';

// Keep the executor's catalog visible, but prevent preparation from doing the task.
// This hook also denies tools that a person's existing settings already allow. StructuredOutput is how Claude
// Code returns the answer held to actionSchema: denied, the answer never arrives.
const LOOKUPS = ['Read','Grep','Glob','ToolSearch','StructuredOutput','WebSearch','WebFetch',
  'mcp__claude_ai_Gmail__search_threads','mcp__claude_ai_Gmail__get_thread','mcp__claude_ai_Gmail__get_message',
  'mcp__map_context__list_maps','mcp__map_context__load_map'];
// Claude Code's own tools that change files or run commands: every Execute has them, connected or not
const BUILT_IN = ['Edit','Write','Bash','NotebookEdit'];
export const preparationSettings = () => onlyTools(LOOKUPS, 'Action preparation can only look up information. Review the brief and press Execute to make changes.');

/**
 * @param {{ cwd: string, env: Record<string, string | undefined>, connected?: boolean, servers?: McpServers, schema: object, prompt: string,
 *   onText: (words: string) => void, onDone: (text: string, access: { tools: string[], denied: string[] }, value?: unknown) => void,
 *   spawnProcess?: typeof spawn, timeoutMs?: number }} job
 */
export function prepareAction({cwd,env,connected=false,servers,schema,prompt,onText,onDone,spawnProcess=spawn,timeoutMs=180_000}) {
  env = claudeEnv(env);
  const args = ['-p','--output-format','stream-json','--verbose','--include-partial-messages','--no-session-persistence',
    '--permission-mode','dontAsk','--permission-prompts','none','--allowedTools',LOOKUPS.join(','),'--settings',JSON.stringify(preparationSettings()),
    '--json-schema',JSON.stringify(schema),
    // without the person's own settings and connectors, Claude Code's own tools still show, so a build that needs
    // Edit, Write and Bash can be checked as it will run; the hook keeps preparation to lookups
    ...(connected ? [] : ['--restricted','--tools',[...LOOKUPS.slice(0, 3), ...BUILT_IN].join(','),'--strict-mcp-config','--setting-sources','']),
    ...(servers || !connected ? ['--mcp-config',JSON.stringify(mcpConfig(servers))] : [])];
  const proc = spawnProcess('claude',args,{cwd,env,detached:process.platform !== 'win32',stdio:['pipe','pipe','pipe']});
  const available = new Set(), denied = new Set(), searches = new Set();
  let words='', /** @type {string | null} */ result=null, /** @type {unknown} */ value, done=false, stopped=false, /** @type {ReturnType<typeof setTimeout> | undefined} */ killTimer;
  const { kill, done: ended } = killer(proc);
  /** @param {string} text */
  const finish = (text) => { if (done) return; done=true; clearTimeout(limit); clearTimeout(killTimer); ended(); onDone(text,{tools:[...available],denied:[...denied]},value); };
  const stop = () => { if (done || stopped) return; stopped=true; kill('SIGTERM'); killTimer=setTimeout(()=>kill('SIGKILL'),3000); killTimer.unref?.(); };
  const limit = setTimeout(()=>{ stop(); result='Claude took too long to prepare this action. Try again.'; },timeoutMs); limit.unref?.();
  /** @param {string} line */
  const read = (line) => {
    let d; try { d=JSON.parse(line); } catch { return; }
    if (!d || typeof d !== 'object') return;
    if (d.type === 'system' && d.subtype === 'init' && Array.isArray(d.tools)) for (const name of d.tools) if (typeof name === 'string') available.add(name);
    // Deferred connector tools count only when ToolSearch actually returns a tool reference.
    if (d.type === 'assistant' && Array.isArray(d.message?.content)) for (const b of d.message.content) if (b?.type === 'tool_use' && b.name === 'ToolSearch') searches.add(b.id);
    if (d.type === 'user' && Array.isArray(d.message?.content)) for (const b of d.message.content) if (b?.type === 'tool_result' && searches.has(b.tool_use_id) && !b.is_error && Array.isArray(b.content)) {
      for (const ref of b.content) if (ref?.type === 'tool_reference' && typeof ref.tool_name === 'string') available.add(ref.tool_name);
    }
    words = addWords(words, d, onText);
    if (d.type === 'result') {
      // Claude Code's own tools are shown only so a build can be checked; refusing one here is preparation
      // working as meant (it may only look things up), not missing access
      for (const item of Array.isArray(d.permission_denials) ? d.permission_denials : []) if (!BUILT_IN.includes(item?.tool_name)) denied.add(item?.tool_name || 'lookup');
      result = d.is_error ? 'Claude stopped before preparation finished. Check your sign-in and tool access, then try again.' : String(d.result || words).slice(-32000);
      if (!d.is_error) value = d.structured_output;
    }
  };
  const flush = readLines(proc, read);
  proc.stderr.on('data',()=>{}); proc.stdin.on('error',()=>{});
  proc.on('error',()=>finish('Claude Code is not installed or could not start. Check it is installed and signed in.'));
  proc.on('close',code=>{flush();finish(stopped ? result?.includes('took too long') ? result : 'Preparation stopped. Try again.' : code===0 && (result || value !== undefined) ? result || '' : 'Claude stopped before returning a prepared action. Try again.');});
  proc.stdin.end(prompt);
  return stop;
}
