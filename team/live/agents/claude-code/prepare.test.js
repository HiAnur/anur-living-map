import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { actionSchema } from '../../action-box.js';
import { preparationSettings, prepareAction } from './prepare.js';

function harness(connected=true){
  /** @type {any} */ const proc=new EventEmitter();Object.assign(proc,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});
  const calls=[],results=[];
  const stop=prepareAction(/** @type {any} */ ({cwd:'/sample/project',env:{CLAUDECODE:'1',CLAUDE_CONFIG_DIR:'/sample/config'},connected,schema:actionSchema,prompt:'Prepare a report',onText(){},onDone:(text,access,value)=>results.push({text,access,...(value===undefined?{}:{value})}),spawnProcess:(...args)=>{calls.push(args);return proc;}}));
  const event=(d,newline=true)=>proc.stdout.write(JSON.stringify(d)+(newline?'\n':''));
  return {proc,calls,results,event,stop};
}
// the hook checks run the real hook in its own node process, which takes seconds on a busy machine
describe('Action preparation access',{timeout:30_000},()=>{
  it('loads configured tools in the execution project without saving a session or enabling writes',()=>{
    const h=harness(),[command,args,opts]=h.calls[0];expect(command).toBe('claude');expect(opts.cwd).toBe('/sample/project');expect(opts.env.CLAUDECODE).toBeUndefined();expect(opts.env.CLAUDE_CONFIG_DIR).toBe('/sample/config');
    expect(args).toContain('--no-session-persistence');expect(args).toContain('dontAsk');expect(args).not.toContain('--restricted');expect(args).not.toContain('--strict-mcp-config');expect(args).not.toContain('--dangerously-skip-permissions');expect(args[args.indexOf('--permission-prompts')+1]).toBe('none');
    expect(JSON.parse(args[args.indexOf('--settings')+1])).toEqual(preparationSettings());h.proc.emit('close',0);
    const guest=harness(false);expect(guest.calls[0][1]).toContain('--restricted');expect(guest.calls[0][1]).toContain('--strict-mcp-config');
    // Claude Code's own tools show without the person's connectors, so a build can be checked; lookups stay all it may use
    expect(guest.calls[0][1][guest.calls[0][1].indexOf('--tools')+1]).toBe('Read,Grep,Glob,Edit,Write,Bash,NotebookEdit');
    expect(guest.calls[0][1][guest.calls[0][1].indexOf('--allowedTools')+1]).not.toMatch(/Edit|Write|Bash/);guest.proc.emit('close',0);
  });
  it('enforces the lookup boundary even for tools allowed by existing settings',()=>{
    const command=preparationSettings().hooks.PreToolUse[0].hooks[0].command;
    for(const tool_name of ['Write','Edit','Bash','Agent','mcp__claude_ai_Gmail__send_email',undefined]){
      const output=execFileSync('/bin/sh',['-c',command],{input:JSON.stringify({tool_name}),encoding:'utf8'});
      expect(JSON.parse(output).hookSpecificOutput.permissionDecision).toBe('deny');
    }
    for(const tool_name of ['Read','ToolSearch','mcp__claude_ai_Gmail__get_message'])expect(execFileSync('/bin/sh',['-c',command],{input:JSON.stringify({tool_name}),encoding:'utf8'})).toBe('');
  });
  it('reports only actual catalog and searched tool references, not invented names in replies',()=>{
    const h=harness();h.event({type:'system',subtype:'init',tools:['Read','Write','ToolSearch']});
    h.event({type:'assistant',message:{content:[{type:'tool_use',id:'search',name:'ToolSearch'}]}});
    h.event({type:'user',message:{content:[{type:'tool_result',tool_use_id:'search',content:[{type:'tool_reference',tool_name:'mcp__mail__send'},{type:'text',text:'mcp__fake__send'}]}]}});
    h.event({type:'result',result:'Ready with mcp__imaginary__send',permission_denials:[{tool_name:'Bash'}]},false);
    expect(h.results).toHaveLength(0);h.proc.emit('close',0);
    expect(h.results[0].access).toEqual({tools:['Read','Write','ToolSearch','mcp__mail__send'],denied:['Bash']});
  });
  it('never returns a ready-looking partial answer after failure, cancellation or timeout',()=>{
    const h=harness();h.event({type:'stream_event',event:{type:'content_block_delta',delta:{text:'```action {"status":"ready"} ```'}}});h.proc.emit('close',1);expect(h.results[0].text).toContain('stopped');
    const stopped=harness();stopped.stop();expect(stopped.proc.kill).toHaveBeenCalledWith('SIGTERM');stopped.proc.emit('close',null);expect(stopped.results[0].text).toContain('stopped');
    vi.useFakeTimers();const timeout=harness();vi.advanceTimersByTime(180_000);expect(timeout.proc.kill).toHaveBeenCalledWith('SIGTERM');vi.advanceTimersByTime(3000);expect(timeout.proc.kill).toHaveBeenCalledWith('SIGKILL');timeout.proc.emit('close',null);expect(timeout.results[0].text).toContain('took too long');vi.useRealTimers();
    const bad=harness();bad.proc.emit('error',new Error('not installed'));bad.proc.emit('close',1);expect(bad.results).toHaveLength(1);expect(bad.results[0].text).toContain('not installed');
  });
});

describe('the answer preparation hands back',()=>{
  it('is asked for in actionSchema, and the hook lets Claude Code return it',()=>{
    for(const connected of [true,false]){
      const h=harness(connected),args=h.calls[0][1];
      expect(JSON.parse(args[args.indexOf('--json-schema')+1])).toEqual(actionSchema);
      expect(args[args.indexOf('--allowedTools')+1].split(',')).toContain('StructuredOutput');
      h.proc.emit('close',0);
    }
    const command=preparationSettings().hooks.PreToolUse[0].hooks[0].command;
    expect(execFileSync('/bin/sh',['-c',command],{input:JSON.stringify({tool_name:'StructuredOutput'}),encoding:'utf8'})).toBe('');
  });
  it('passes the structured answer on with the words and the tools, and none when the run failed',()=>{
    const value={status:'clarify',question:'Which inbox?',choices:['Sales','Support']};
    const h=harness();h.event({type:'result',result:'',structured_output:value});h.proc.emit('close',0);
    expect(h.results).toEqual([{text:'',access:{tools:[],denied:[]},value}]);
    const failed=harness();failed.event({type:'result',is_error:true,structured_output:value});failed.proc.emit('close',0);
    expect(failed.results[0].value).toBeUndefined();expect(failed.results[0].text).toContain('stopped before preparation finished');
    const none=harness();none.event({type:'result',result:'Some words'});none.proc.emit('close',0);
    expect(none.results).toEqual([{text:'Some words',access:{tools:[],denied:[]}}]);
  });
});
