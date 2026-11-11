import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { completionSchema, executionPrompt, readCompletion } from '../../action-completion.js';
import { ALWAYS, runAction, runSettings } from './run.js';

/** @param {boolean} [resume] @param {string[]} [tools] */
function harness(resume = false, tools = undefined) {
  /** @type {any} */ const proc = new EventEmitter(); proc.stdin=new PassThrough();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.kill=()=>{};
  const calls=[],words=[],results=[];
  const stop=runAction({cwd:'/sample/project',env:{},session:'exact-chat-id',resume,prompt:'Do the task',tools,schema:completionSchema,system:executionPrompt,read:readCompletion,onText:t=>words.push(t),onDone:r=>results.push(r),spawnProcess:(...args)=>{calls.push(args);return proc;}});
  const event=(data,newline=true)=>proc.stdout.write(JSON.stringify(data)+(newline?'\n':''));
  return {proc,calls,words,results,event,stop};
}
describe('background execution',()=>{
  it('keeps every tool call the run made, with what it returned, so the map can judge the run by what it did',()=>{
    const h=harness();
    h.event({type:'assistant',message:{content:[{type:'text',text:'Opening the PR'},{type:'tool_use',id:'t1',name:'Bash',input:{command:'gh pr create --fill'}},{type:'tool_use',id:'t2',name:'Read',input:{file_path:'a.js'}},{type:'tool_use',id:'t3',name:'mcp__gmail__send',input:{to:'sam@example.com'}}]}});
    h.event({type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:'https://github.com/acme/app/pull/7\n',is_error:false},{type:'tool_result',tool_use_id:'t2',content:[{type:'text',text:'file'}]},{type:'tool_result',tool_use_id:'t3',content:'Permission denied',is_error:true}]}});
    h.event({type:'result',result:'Done',is_error:false});h.proc.emit('close',0);
    expect(h.results[0].calls).toEqual([
      {tool:'Bash',input:{command:'gh pr create --fill'},ok:true,output:'https://github.com/acme/app/pull/7\n',summary:'gh pr create --fill'},
      {tool:'Read',input:{file_path:'a.js'},ok:true,output:'file',reads:true},
      {tool:'mcp__gmail__send',input:{to:'sam@example.com'},ok:false,output:'Permission denied'},
    ]);
  });
  it('persists an exact session and resumes it with normal permissions, without opening desktop',()=>{
    for(const resume of [false,true]){const h=harness(resume),[command,args,opts]=h.calls[0];expect(command).toBe('claude');expect(args).toContain('-p');expect(args).toContain(resume?'--resume':'--session-id');expect(args).toContain('exact-chat-id');expect(args).not.toContain('--continue');expect(args).not.toContain('--no-session-persistence');expect(args).not.toContain('--dangerously-skip-permissions');expect(args).toContain('auto');expect(opts.cwd).toBe('/sample/project');h.proc.emit('close',0);}
  });
  it('streams words and waits for process exit before allowing continuation',()=>{
    const h=harness();h.event({type:'stream_event',event:{type:'content_block_delta',delta:{text:'Checking the form'}}});expect(h.words).toEqual(['Checking the form']);
    h.event({type:'result',result:'The form is ready.',is_error:false},false);expect(h.results).toHaveLength(0);h.proc.emit('close',0);expect(h.results).toEqual([{text:'The form is ready.',blocked:false,calls:[]}]);
  });
  it('shows permission denials and process failures as blocked, without starting a fresh chat',()=>{
    const h=harness(true);h.event({type:'result',result:'Could not send.',permission_denials:[{tool_name:'Send'}]});h.proc.emit('close',0);expect(h.results[0].blocked).toBe(true);expect(h.results[0].text).toContain('permission');expect(h.calls).toHaveLength(1);
    const bad=harness(true);bad.proc.stderr.write('Chat not found');bad.proc.emit('close',1);expect(bad.results[0]).toMatchObject({blocked:true});expect(bad.results[0].text).toContain('Chat not found');expect(bad.calls).toHaveLength(1);
  });
  it('does not count a refused push as missing access, since the map pushes after the run',()=>{
    const h=harness(true);h.event({type:'result',result:'Committed.',structured_output:{status:'completed',summary:'Committed the fix.',evidence:['commit abc']},permission_denials:[{tool_name:'Bash',tool_input:{command:'git push -u origin action/x'}}]});h.proc.emit('close',0);
    expect(h.results[0].blocked).toBe(false);expect(h.results[0].text).not.toContain('permission');
  });
  it('requests structured outcomes and keeps evidence separately from the expected result',()=>{
    const h=harness();expect(JSON.parse(h.calls[0][1][h.calls[0][1].indexOf('--json-schema')+1])).toEqual(completionSchema);
    const completion={status:'completed',summary:'Sent the test email.',evidence:['Sent message: sample-123, to alex@example.com']};
    h.event({type:'result',structured_output:completion,is_error:false});h.proc.emit('close',0);
    expect(h.results[0]).toEqual({text:completion.summary,completion,blocked:false,calls:[]});
    for(const value of [null,{}, {...completion,evidence:[]}, {...completion,evidence:['']}, {...completion,evidence:[{}]}, {...completion,summary:''}, {...completion,status:'success'}])expect(readCompletion(value)).toBeNull();
  });
  it('keeps tool failures and access errors from confirming completion',()=>{
    for(const extra of [{is_error:true},{permission_denials:[{tool_name:'Send'}]},{permission_denials:[{tool_name:'Bash',tool_input:{command:'git push origin x'}},{tool_name:'Bash',tool_input:{command:'rm -rf build'}}]}]){
      const h=harness();h.event({type:'result',...extra,structured_output:{status:'completed',summary:'Sent',evidence:['message-id']}});h.proc.emit('close',0);
      expect(h.results[0].blocked).toBe(true);expect(h.results[0].completion).toBeUndefined();expect(h.results[0].text).not.toBe('Sent');
    }
  });
  it('handles malformed output, split UTF-8, cancellation and launch errors once',()=>{
    const h=harness();h.proc.stdout.write('not json\nnull\n');h.event({type:'assistant',message:{content:[null,{type:'text'}]}});h.event({type:'assistant',message:{content:'invalid'}});h.event({type:'result',errors:'invalid'});const bytes=Buffer.from(JSON.stringify({type:'result',result:'Café'}));const index=bytes.indexOf(0xc3);h.proc.stdout.write(bytes.subarray(0,index+1));h.proc.stdout.write(bytes.subarray(index+1));h.proc.emit('close',0);expect(h.results[0].text).toBe('Café');
    const stopped=harness();stopped.stop();stopped.proc.emit('close',null);expect(stopped.results[0].text).toContain('Stopped');expect(stopped.results[0].blocked).toBe(true);
    const failed=harness();failed.proc.emit('error',new Error('missing'));failed.proc.emit('close',1);expect(failed.results).toHaveLength(1);expect(failed.results[0].blocked).toBe(true);
  });
});

// each check runs the real hook in its own node process, which takes seconds on a busy machine
describe('the tools a run may use',{timeout:30_000},()=>{
  /** @param {any} settings @param {unknown} tool_name */
  const decide=(settings,tool_name)=>{const out=execFileSync('/bin/sh',['-c',settings.hooks.PreToolUse[0].hooks[0].command],{input:JSON.stringify({tool_name}),encoding:'utf8'});return out?JSON.parse(out).hookSpecificOutput.permissionDecision:'asks as usual';};
  it('limits the run with a hook built from the reviewed tools, and pre-approves nothing',()=>{
    const h=harness(false,['Write','mcp__claude_ai_Gmail__send_message']),args=h.calls[0][1];
    expect(JSON.parse(args[args.indexOf('--settings')+1])).toEqual(runSettings(['Write','mcp__claude_ai_Gmail__send_message']));
    expect(args).not.toContain('--allowedTools');expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args[args.indexOf('--permission-mode')+1]).toBe('auto');
    const resumed=harness(true,['Write']),rargs=resumed.calls[0][1];
    expect(JSON.parse(rargs[rargs.indexOf('--settings')+1])).toEqual(runSettings(['Write']));
  });
  it('denies every tool the brief does not name, even ones the person allows for themselves',()=>{
    const settings=runSettings(['Write','mcp__claude_ai_Gmail__send_message']);
    for(const tool of ['Write','mcp__claude_ai_Gmail__send_message',...ALWAYS])expect(decide(settings,tool)).toBe('asks as usual');
    for(const tool of ['Bash','Edit','WebFetch','Agent','mcp__claude_ai_Gmail__delete_thread','mcp__claude_ai_Slack__send_message',undefined,''])expect(decide(settings,tool)).toBe('deny');
  });
  it('allows only the fixed read-only set when the brief names no tools',()=>{
    for(const settings of [runSettings([]),runSettings(undefined)]){
      for(const tool of ALWAYS)expect(decide(settings,tool)).toBe('asks as usual');
      expect(decide(settings,'Write')).toBe('deny');
    }
    expect(ALWAYS).toEqual(['Read','Grep','Glob','ToolSearch','TodoWrite','StructuredOutput']);
  });
  it('tells Claude why a tool was denied',()=>{
    // GitHub's CLI is the run's to use, but for pushing and opening the pull request, which the map does
    const bash=(command)=>{const out=execFileSync('/bin/sh',['-c',runSettings(['Bash']).hooks.PreToolUse[0].hooks[0].command],{input:JSON.stringify({tool_name:'Bash',tool_input:{command}}),encoding:'utf8'});return out?JSON.parse(out).hookSpecificOutput.permissionDecision:'asks as usual';};
    for(const command of ['gh pr view 7 --comments','gh api repos/acme/app/pulls/7/comments','gh pr comment 7 --body ok','cd app && gh run list'])expect(bash(command)).toBe('asks as usual');
    for(const command of ['gh pr create --fill','git push -u origin x','cd app && gh pr create --base main'])expect(bash(command)).toBe('deny');
    const out=execFileSync('/bin/sh',['-c',runSettings([]).hooks.PreToolUse[0].hooks[0].command],{input:JSON.stringify({tool_name:'Bash'}),encoding:'utf8'});
    expect(JSON.parse(out).hookSpecificOutput.permissionDecisionReason).toContain('not in the reviewed brief');
  });
});
