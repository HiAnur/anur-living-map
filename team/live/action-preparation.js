import { spawn } from 'node:child_process';

// Keep the executor's catalog visible, but prevent preparation from doing the task.
// This hook also denies tools that a person's existing settings already allow.
const LOOKUPS = ['Read','Grep','Glob','ToolSearch','WebSearch','WebFetch',
  'mcp__claude_ai_Gmail__search_threads','mcp__claude_ai_Gmail__get_thread','mcp__claude_ai_Gmail__get_message',
  'mcp__map_context__list_maps','mcp__map_context__load_map'];
const active = new Set();
process.once('exit',()=>{for(const kill of active)kill('SIGKILL');});
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
export function preparationSettings() {
  const script = `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{let name;try{name=JSON.parse(input).tool_name}catch{};if(!${JSON.stringify(LOOKUPS)}.includes(name))process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Action preparation can only look up information. Review the brief and press Execute to make changes.'}}));});`;
  return {hooks:{PreToolUse:[{matcher:'*',hooks:[{type:'command',command:`${quote(process.execPath)} -e ${quote(script)}`,timeout:10}]}]}};
}

export function prepareAction({cwd,env,connected=false,config,prompt,onText,onDone,spawnProcess=spawn,timeoutMs=180_000}) {
  env = {...env};
  for (const key of Object.keys(env)) if (key.startsWith('CLAUDE') && !['CLAUDE_CONFIG_DIR','CLAUDE_CODE_OAUTH_TOKEN'].includes(key)) delete env[key];
  const args = ['-p','--output-format','stream-json','--verbose','--include-partial-messages','--no-session-persistence',
    '--permission-mode','dontAsk','--permission-prompts','none','--allowedTools',LOOKUPS.join(','),'--settings',JSON.stringify(preparationSettings()),
    ...(connected ? [] : ['--restricted','--tools','Read,Grep,Glob','--strict-mcp-config','--setting-sources','']),
    ...(config || !connected ? ['--mcp-config',JSON.stringify(config || {mcpServers:{}})] : [])];
  const proc = spawnProcess('claude',args,{cwd,env,detached:process.platform !== 'win32',stdio:['pipe','pipe','pipe']});
  const available = new Set(), denied = new Set(), searches = new Set();
  let buffer='', words='', result=null, done=false, stopped=false, killTimer;
  const kill = (signal) => { try { if (process.platform !== 'win32' && proc.pid) process.kill(-proc.pid,signal); else proc.kill(signal); } catch {} };
  active.add(kill);
  const finish = (text) => { if (done) return; done=true; clearTimeout(limit); clearTimeout(killTimer); active.delete(kill); onDone(text,{tools:[...available],denied:[...denied]}); };
  const stop = () => { if (done || stopped) return; stopped=true; kill('SIGTERM'); killTimer=setTimeout(()=>kill('SIGKILL'),3000); killTimer.unref?.(); };
  const limit = setTimeout(()=>{ stop(); result='Claude took too long to prepare this action. Try again.'; },timeoutMs); limit.unref?.();
  const read = (line) => {
    let d; try { d=JSON.parse(line); } catch { return; }
    if (!d || typeof d !== 'object') return;
    if (d.type === 'system' && d.subtype === 'init' && Array.isArray(d.tools)) for (const name of d.tools) if (typeof name === 'string') available.add(name);
    // Deferred connector tools count only when ToolSearch actually returns a tool reference.
    if (d.type === 'assistant' && Array.isArray(d.message?.content)) for (const b of d.message.content) if (b?.type === 'tool_use' && b.name === 'ToolSearch') searches.add(b.id);
    if (d.type === 'user' && Array.isArray(d.message?.content)) for (const b of d.message.content) if (b?.type === 'tool_result' && searches.has(b.tool_use_id) && !b.is_error && Array.isArray(b.content)) {
      for (const ref of b.content) if (ref?.type === 'tool_reference' && typeof ref.tool_name === 'string') available.add(ref.tool_name);
    }
    const e = d.type === 'stream_event' ? d.event : null;
    if (e?.type === 'message_start' && words) words+='\n\n';
    if (e?.type === 'content_block_delta' && typeof e.delta?.text === 'string') { words=(words+e.delta.text).slice(-32000); onText(words); }
    if (d.type === 'result') {
      for (const item of Array.isArray(d.permission_denials) ? d.permission_denials : []) denied.add(item?.tool_name || 'lookup');
      result = d.is_error ? 'Claude stopped before preparation finished. Check your sign-in and tool access, then try again.' : String(d.result || words).slice(-32000);
    }
  };
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  proc.stdout.on('data',chunk=>{buffer+=chunk; for(let nl;(nl=buffer.indexOf('\n'))>=0;){read(buffer.slice(0,nl));buffer=buffer.slice(nl+1);} if(buffer.length>2_000_000)buffer='';});
  proc.stderr.on('data',()=>{}); proc.stdin.on('error',()=>{});
  proc.on('error',()=>finish('Claude Code is not installed or could not start. Check it is installed and signed in.'));
  proc.on('close',code=>{if(buffer)read(buffer);finish(stopped ? result?.includes('took too long') ? result : 'Preparation stopped. Try again.' : code===0 && result ? result : 'Claude stopped before returning a prepared action. Try again.');});
  proc.stdin.end(prompt);
  return stop;
}
