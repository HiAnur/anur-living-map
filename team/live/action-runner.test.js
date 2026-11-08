import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { runAction } from './action-runner.js';

function harness(resume = false) {
  const proc = new EventEmitter(); proc.stdin=new PassThrough();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.kill=()=>{};
  const calls=[],words=[],results=[];
  const stop=runAction({cwd:'/sample/project',env:{},session:'exact-chat-id',resume,prompt:'Do the task',onText:t=>words.push(t),onDone:r=>results.push(r),spawnProcess:(...args)=>{calls.push(args);return proc;}});
  const event=(data,newline=true)=>proc.stdout.write(JSON.stringify(data)+(newline?'\n':''));
  return {proc,calls,words,results,event,stop};
}
describe('background execution',()=>{
  it('persists an exact session and resumes it with normal permissions, without opening desktop',()=>{
    for(const resume of [false,true]){const h=harness(resume),[command,args,opts]=h.calls[0];expect(command).toBe('claude');expect(args).toContain('-p');expect(args).toContain(resume?'--resume':'--session-id');expect(args).toContain('exact-chat-id');expect(args).not.toContain('--continue');expect(args).not.toContain('--no-session-persistence');expect(args).not.toContain('--dangerously-skip-permissions');expect(args).toContain('auto');expect(opts.cwd).toBe('/sample/project');h.proc.emit('close',0);}
  });
  it('streams words and waits for process exit before allowing continuation',()=>{
    const h=harness();h.event({type:'stream_event',event:{type:'content_block_delta',delta:{text:'Checking the form'}}});expect(h.words).toEqual(['Checking the form']);
    h.event({type:'result',result:'The form is ready.',is_error:false},false);expect(h.results).toHaveLength(0);h.proc.emit('close',0);expect(h.results).toEqual([{text:'The form is ready.',blocked:false}]);
  });
  it('shows permission denials and process failures as blocked, without starting a fresh chat',()=>{
    const h=harness(true);h.event({type:'result',result:'Could not send.',permission_denials:[{tool_name:'Send'}]});h.proc.emit('close',0);expect(h.results[0].blocked).toBe(true);expect(h.results[0].text).toContain('permission');expect(h.calls).toHaveLength(1);
    const bad=harness(true);bad.proc.stderr.write('Chat not found');bad.proc.emit('close',1);expect(bad.results[0]).toMatchObject({blocked:true});expect(bad.results[0].text).toContain('Chat not found');expect(bad.calls).toHaveLength(1);
  });
  it('handles malformed output, split UTF-8, cancellation and launch errors once',()=>{
    const h=harness();h.proc.stdout.write('not json\nnull\n');h.event({type:'assistant',message:{content:[null,{type:'text'}]}});h.event({type:'assistant',message:{content:'invalid'}});h.event({type:'result',errors:'invalid'});const bytes=Buffer.from(JSON.stringify({type:'result',result:'Café'}));const index=bytes.indexOf(0xc3);h.proc.stdout.write(bytes.subarray(0,index+1));h.proc.stdout.write(bytes.subarray(index+1));h.proc.emit('close',0);expect(h.results[0].text).toBe('Café');
    const stopped=harness();stopped.stop();stopped.proc.emit('close',null);expect(stopped.results[0].text).toContain('Stopped');expect(stopped.results[0].blocked).toBe(true);
    const failed=harness();failed.proc.emit('error',new Error('missing'));failed.proc.emit('close',1);expect(failed.results).toHaveLength(1);expect(failed.results[0].blocked).toBe(true);
  });
});
