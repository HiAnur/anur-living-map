import { describe, expect, it } from 'vitest';

import { actionBoxes, actionPrompt, actionSchema, readAction, recoverAction } from './action-box.js';
import { LINK_EDITS, sharedState } from './sharing.js';
import { mapData } from './cloud-data.js';

// what preparation hands back: its words, what it could use, and its structured answer
const reply = (data) => data;
const brief = {kind:'build',goal:'Build a contact form',target:'/sample/website',result:'Visitors can submit an inquiry',steps:['Add the form','Verify a submission']};
function harness() {
  /** @type {any} */ let node={id:'form',label:'Contact form',sub:'Let visitors reach us'};
  const requests=[],launches=[],stops=[];let changed=0,allowed=true;
  const api=actionBoxes({nodeOf:()=>node,canUse:()=>allowed,context:()=> 'Whole map: Website > Contact form; Audience: small teams',
    ask:r=>{requests.push(r);return ()=>stops.push(true);}, changed:()=>changed++,executionCwd:'/sample/project',run:r=>{launches.push(r);return ()=>stops.push(true);}});
  return {api,requests,launches,stops,get node(){return node;},get changes(){return changed;},remove:()=>node=null,revoke:()=>allowed=false,
    start:()=>{if(!node.action)api.begin('form','Duy');return node.action.stage==='draft'?api.start('form','Duy','Build a contact form for the website'):api.prepare('form','Duy');},ready:()=>requests.at(-1).onDone('',undefined,reply({status:'ready',brief}))};
}
describe('action boxes',()=>{
  it('lets the person write the action before gathering any information',()=>{
    const h=harness();expect(h.api.begin('form','Duy')).toBe(true);expect(h.node.action.stage).toBe('draft');expect(h.requests).toHaveLength(0);
    expect(h.api.start('form','Duy',' ')).toBe(false);expect(h.api.start('form','Other','Send an email')).toBe(false);
    expect(h.api.start('form','Duy','Build the contact form in our existing website')).toBe(true);
    expect(h.requests[0].prompt).toContain('Build the contact form in our existing website');expect(h.node.action.intent).toBe('Build the contact form in our existing website');
  });
  it('gathers in the background, asks, and becomes ready without executing',()=>{
    const h=harness();expect(h.start()).toBe(true);expect(h.node.action.stage).toBe('gathering');expect(h.start()).toBe(false);
    expect(h.requests[0].prompt).toContain('Whole map: Website');expect(h.requests[0].prompt).toContain(actionPrompt);
    h.requests[0].onDone('',undefined,reply({status:'clarify',question:'Which project?',choices:['Website','Dashboard']}));
    expect(h.node.action.stage).toBe('clarify');expect(h.launches).toHaveLength(0);
    expect(h.api.prepare('form','Duy','Website')).toBe(true);expect(h.requests[1].prompt).toContain('"question":"Which project?","answer":"Website"');
    h.ready();expect(h.node.action.stage).toBe('ready');expect(h.launches).toHaveLength(0);
    expect(h.api.execute('form','Duy',h.node.action.id)).toBe(true);expect(h.node.action.stage).toBe('running');expect(h.launches).toHaveLength(1);
    expect(h.launches[0].prompt).toContain(JSON.stringify(brief));expect(h.api.execute('form','Duy',h.node.action.id)).toBe(false);expect(h.start()).toBe(false);
  });
  it('only accepts the owner, current revision and a ready brief',()=>{
    const h=harness();h.start();const id=h.node.action.id;
    expect(h.api.execute('form','Duy',id)).toBe(false);expect(h.api.cancel('form','Other')).toBe(false);
    h.ready();expect(h.api.execute('form','Other',id)).toBe(false);expect(h.api.execute('form','Duy','stale')).toBe(false);expect(h.launches).toHaveLength(0);
    h.revoke();expect(h.api.execute('form','Duy',id)).toBe(false);
  });
  it('requires preparation again after the topic changes',()=>{
    const h=harness();h.start();h.ready();h.node.sub='Different task';
    expect(h.api.execute('form','Duy',h.node.action.id)).toBe(false);expect(h.node.action.stage).toBe('error');expect(h.launches).toHaveLength(0);
  });
  it('keeps revisions and clarification answers without executing',()=>{
    const h=harness();h.start();h.ready();const old=h.node.action.id;
    expect(h.api.revise('form','Duy')).toBe(true);expect(h.api.execute('form','Duy',old)).toBe(false);
    h.api.prepare('form','Duy','Use the dashboard instead');expect(h.node.action.id).not.toBe(old);h.ready();expect(h.launches).toHaveLength(0);
  });
  it('keeps immutable downloadable drafts through revision, reload and execution',()=>{
    const h=harness();h.start();
    const email={kind:'email',goal:'Email a colleague',target:'sam@example.com',result:'Email sent',steps:['Send reviewed email'],email:{to:'sam@example.com',subject:'Original subject',body:'Original message\nSecond line'}};
    h.requests.at(-1).onDone('',undefined,reply({status:'ready',brief:email}));
    expect(h.api.revise('form','Other')).toBe(false);expect(h.node.action.documents).toBeUndefined();
    expect(h.api.revise('form','Duy')).toBe(true);
    const first=structuredClone(h.node.action.documents[0]);
    expect(first.name).toBe('Action version 1.md');expect(first.content).toContain('Subject: Original subject');expect(first.content).toContain(email.email.body);
    expect(h.api.revise('form','Duy')).toBe(false);expect(h.node.action.documents).toHaveLength(1);
    h.api.prepare('form','Duy','Use a warmer opening');
    expect(h.requests.at(-1).prompt).toContain(JSON.stringify(email));expect(h.node.action.documents[0]).toEqual(first);
    h.requests.at(-1).onDone('',undefined,reply({status:'ready',brief:{...email,email:{...email.email,body:'New message'}}}));
    expect(h.api.revise('form','Duy')).toBe(true);expect(h.node.action.documents).toHaveLength(2);
    expect(h.node.action.documents[0]).toEqual(first);expect(h.node.action.documents[1].content).toContain('New message');
    h.node.action=JSON.parse(JSON.stringify(h.node.action));recoverAction(h.node);
    h.api.prepare('form','Duy','Keep this one');h.ready();
    expect(h.api.execute('form','Duy',h.node.action.id)).toBe(true);expect(h.node.action.documents[0]).toEqual(first);
  });
  it('cancels preparation, keeps the Action, and ignores the late reply',()=>{
    const h=harness();h.start();expect(h.api.cancel('form','Duy')).toBe(true);expect(h.stops).toHaveLength(1);
    h.ready();expect(h.node.action.stage).toBe('cancelled');expect(h.node.action.brief).toBeUndefined();
    expect(h.node.action.intent).toBe('Build a contact form for the website');
    expect(h.node.action.cancelled).toMatchObject({by:'Duy',from:'gathering'});expect(h.node.boxType).toBe('action');
  });
  it('keeps a replacement request cancellable if a cancelled request replies late',()=>{
    const h=harness();h.start();const old=h.requests[0];h.api.cancel('form','Duy');
    expect(h.api.reopen('form','Duy')).toBe(true);h.start();
    old.onDone('',undefined,reply({status:'ready',brief}));expect(h.node.action.stage).toBe('gathering');
    h.api.cancel('form','Duy');expect(h.stops).toHaveLength(2);
  });
  it('turns an untouched draft back into an Info box, and keeps anything more',()=>{
    const h=harness();h.api.begin('form','Duy');expect(h.api.cancel('form','Duy')).toBe(true);
    expect(h.node.action).toBeUndefined();expect(h.node.boxType).toBe('topic');
    h.api.begin('form','Duy',{goal:'Build a contact form',result:'Visitors can submit',inputs:['The site'],steps:['Add it'],evidence:['A submission'],dependsOn:[]});
    expect(h.api.cancel('form','Duy')).toBe(true);expect(h.node.action.stage).toBe('cancelled');expect(h.node.action.plan.goal).toBe('Build a contact form');
  });
  it('reopens a cancelled Action as a draft with its instructions, and keeps its brief as a version',()=>{
    const h=harness();h.start();h.ready();expect(h.node.action.stage).toBe('ready');
    expect(h.api.reopen('form','Duy')).toBe(false);expect(h.api.cancel('form','Duy')).toBe(true);
    const cancelledId=h.node.action.id;expect(h.node.action.brief).toEqual(brief);
    expect(h.api.reopen('form','Other')).toBe(false);expect(h.api.reopen('form','Duy')).toBe(true);
    expect(h.node.action).toMatchObject({stage:'draft',intent:'Build a contact form for the website'});expect(h.node.action.id).not.toBe(cancelledId);
    expect(h.node.action.cancelled).toBeUndefined();expect(h.node.action.brief).toBeUndefined();
    expect(h.node.action.documents.at(-1).brief).toEqual(brief);expect(h.launches).toHaveLength(0);
  });
  it('keeps a history written by code: who did each step, when, and never the model\'s words',()=>{
    const h=harness();h.api.begin('form','Duy');h.api.start('form','Duy','Build a contact form for the website');
    h.requests[0].onDone('',undefined,reply({status:'clarify',question:'Which project should host it?',choices:[]}));
    h.api.prepare('form','Duy','The website');
    h.requests[1].onDone('',{tools:['Edit','Write'],denied:[]},reply({status:'ready',brief:{...brief,tools:['Edit','Write']}}));
    h.api.revise('form','Duy');h.api.prepare('form','Duy','Keep it short');
    h.requests[2].onDone('',{tools:['Edit','Write'],denied:[]},reply({status:'ready',brief:{...brief,tools:['Edit','Write']}}));
    h.api.execute('form','Duy',h.node.action.id);
    h.api.stop('form','Duy',h.node.action.id);h.launches[0].onDone({blocked:true,text:'Stopped by request'});
    h.api.continue('form','Duy',h.node.action.id,'Go on');
    h.launches[1].onDone({text:'Done',completion:{status:'completed',summary:'Form added',evidence:['Commit abc']}});
    const events=h.node.action.events;
    expect(events.map((e)=>[e.what,e.by])).toEqual([
      ['created','Duy'],['preparing','Duy'],['asked','Claude'],['answered','Duy'],['ready','Claude'],['revised','Duy'],
      ['answered','Duy'],['ready','Claude'],['executed','Duy'],['stopped','Duy'],['finished','Claude'],['continued','Duy'],['finished','Claude']]);
    expect(events.find((e)=>e.what==='ready').tools).toEqual(['Edit','Write']);expect(events.find((e)=>e.what==='executed').tools).toEqual(['Edit','Write']);
    // the run claimed completion with no tool call behind it: code cannot see it done
    expect(events.filter((e)=>e.what==='finished').map((e)=>e.status)).toEqual(['blocked','unverified']);
    for(const e of events){expect(e.at).toBeTypeOf('number');expect(e.rev).toBeTypeOf('string');}
    expect(events.every((e,i)=>i===0||e.at>=events[i-1].at)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/Which project|Stopped by request|Form added|Commit abc/);
  });
  it('records cancel, reopen, a wait and a restart as steps of its history',()=>{
    const h=harness();h.start();h.api.cancel('form','Duy');h.api.reopen('form','Duy');
    expect(h.node.action.events.map((e)=>e.what)).toEqual(['created','preparing','cancelled','reopened']);
    expect(h.node.action.events.find((e)=>e.what==='cancelled').from).toBe('gathering');
    const n={id:'x',label:'X',action:{stage:'running',by:'Duy',id:'r',turns:[]}};recoverAction(/** @type {any} */ (n));
    expect(n.action.events.map((e)=>[e.what,e.by])).toEqual([['interrupted','Map']]);
  });
  it('never cancels an Action that has run',()=>{
    const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);
    expect(h.api.cancel('form','Duy')).toBe(false);expect(h.node.action.stage).toBe('running');
  });
  it('ignores a completed request after deletion or access removal',()=>{
    for(const change of ['remove','revoke']){const h=harness();h.start();const before=h.changes;h[change]();h.ready();expect(h.changes).toBe(before+(change==='revoke'?1:0));if(change==='revoke')expect(h.node.action.stage).toBe('error');expect(h.launches).toHaveLength(0);}
  });
  it('reports changed inputs, invalid output, and interrupted preparation',()=>{
    const h=harness();h.start();h.node.label='New intent';h.ready();expect(h.node.action.stage).toBe('error');
    h.start();h.requests.at(-1).onDone('Not signed in');expect(h.node.action.stage).toBe('error');
    h.start();recoverAction(h.node);expect(h.node.action.stage).toBe('error');expect(h.node.action.error).toContain('restarted');
  });
  it('streams replies and continues the exact chat without replaying the task',()=>{
    const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);
    const first=h.launches[0],session=h.node.action.session;expect(first).toMatchObject({session,resume:false});
    first.onText('Checking the form');expect(h.node.action.progress).toBe('Checking the form');
    first.onDone({text:'The form is built. Which inbox should receive inquiries?',blocked:false});
    const revision=h.node.action.id;expect(h.node.action.stage).toBe('finished');expect(h.node.action.turns.at(-1).text).toContain('Which inbox');
    expect(h.api.continue('form','Other',revision,'sales@example.com')).toBe(false);
    expect(h.api.continue('form','Duy','old','sales@example.com')).toBe(false);
    expect(h.api.continue('form','Duy',revision,'sales@example.com')).toBe(true);
    expect(h.launches[1]).toMatchObject({cwd:'/sample/project',session,resume:true,prompt:'sales@example.com'});
    expect(h.api.continue('form','Duy',revision)).toBe(false);expect(h.api.cancel('form','Duy')).toBe(false);
    h.launches[1].onDone({blocked:true,text:'Permission needed'});expect(h.node.action.stage).toBe('blocked');
    expect(h.api.continue('form','Duy',h.node.action.id)).toBe(true);expect(h.launches[2].session).toBe(session);expect(h.launches[2].prompt).toContain('already finished');
  });
  it('preserves execution history across a restart and resumes instead of executing again',()=>{
    const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);const session=h.node.action.session;
    recoverAction(h.node);expect(h.node.action.stage).toBe('blocked');expect(h.node.action.turns.at(-1).text).toContain('interrupted');
    expect(h.api.execute('form','Duy',h.node.action.id)).toBe(false);expect(h.start()).toBe(false);
    h.api.continue('form','Duy',h.node.action.id);expect(h.launches[1]).toMatchObject({session,resume:true});
    h.launches[0].onDone({text:'Late result'});expect(h.node.action.stage).toBe('running');
  });
  it('stops running work on request, deletion, access loss and close',()=>{
    for(const change of ['stop','remove','revoke','close']){
      const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);
      if(change==='stop') { expect(h.api.stop('form','Other',h.node.action.id)).toBe(false);h.api.stop('form','Duy',h.node.action.id); }
      else if(change==='close')h.api.close();else {h[change]();h.api.reconcile();}
      expect(h.stops).toHaveLength(1);
      h.launches[0].onDone({blocked:true,text:'Stopped'});if(change!=='remove')expect(h.node.action.stage).toBe('blocked');
    }
  });
  it('recovers a running box restored from undo after its process was removed',()=>{
    const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);
    const n=structuredClone(h.node);h.api.close();h.node.action=n.action;
    h.api.reconcile([h.node]);expect(h.node.action.stage).toBe('blocked');expect(h.node.action.session).toBe(n.action.session);
  });
  it('recovers old handoffs as unconfirmed without running and requires an explicit current-owner Execute',()=>{
    const h=harness();h.start();h.ready();Object.assign(h.node.action,{stage:'sent',sentAt:100});
    const briefBefore=structuredClone(h.node.action.brief);recoverAction(h.node);
    expect(h.node.action.stage).toBe('unconfirmed');expect(h.node.action.brief).toEqual(briefBefore);expect(h.launches).toHaveLength(0);
    const rev=h.node.action.id;expect(h.api.cancel('form','Duy')).toBe(false);
    expect(h.api.execute('form','Other',rev)).toBe(false);expect(h.api.execute('form','Duy','old')).toBe(false);
    expect(h.api.execute('form','Duy',rev)).toBe(true);expect(h.launches[0].prompt).toContain('First check actual evidence');expect(h.launches[0].prompt).toContain('never risk a duplicate');
    expect(h.api.execute('form','Duy',h.node.action.id)).toBe(false);
    h.launches[0].onDone({text:'A matching send already exists.',completion:{status:'completed',summary:'A matching send already exists.',evidence:['Sent message: sample-123']}});
    // the run found an earlier send by searching, which code cannot see as a send: unverified until its author confirms
    expect(h.node.action.completion.status).toBe('unverified');expect(h.node.action.turns.at(-1).completion.claimed).toEqual(['Sent message: sample-123']);
    expect(h.api.confirm('form','Duy',h.node.action.id)).toBe(true);expect(h.node.action.completion.status).toBe('completed');
    expect(h.node.action.completion.evidence).toEqual(['Confirmed done by Duy']);expect(h.node.action.events.at(-1)).toMatchObject({what:'confirmed',by:'Duy'});
  });
  it('only shows completed with a valid confirmation, never a process exit or permission failure',()=>{
    for(const result of [
      {text:'Done'},
      {text:'Done',completion:{status:'completed',summary:'Done',evidence:[]}},
      {text:'Permission denied',blocked:true,completion:{status:'completed',summary:'Done',evidence:['Not usable']}},
    ]){
      const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);h.launches[0].onDone(result);
      expect(h.node.action.completion.status).toBe(result.blocked?'blocked':'unconfirmed');
      expect(h.node.action.turns.at(-1).completion.status).not.toBe('completed');
    }
    const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);
    h.launches[0].onDone({completion:{status:'needs_input',summary:'Which inbox?',evidence:[]}});
    expect(h.node.action.completion.status).toBe('needs_input');expect(h.node.action.turns.at(-1).text).toBe('Which inbox?');
    h.api.continue('form','Duy',h.node.action.id,'team@example.com');expect(h.node.action.completion).toBeUndefined();expect(h.launches[1].resume).toBe(true);
  });
  it('validates output, email details and bounds without accepting model operations',()=>{
    for(const value of [null,{}, {status:'ready',brief:{}},{status:'ready',brief:{...brief,steps:[]}}, {status:'ready',brief:{...brief,result:[]}}]) expect(readAction(reply(value))).toBeNull();
    const email={...brief,kind:'email',email:{to:'invented',subject:'Hello',body:'Thanks'}};
    expect(/** @type {any} */ (readAction(reply({status:'ready',brief:email}))).stage).toBe('clarify');
    email.email.to='customer@example.com';expect(readAction(reply({status:'ready',brief:email}))).toMatchObject({stage:'ready',brief:{target:'customer@example.com'}});
    expect(/** @type {any} */ (readAction(reply({status:'ready',brief:{...brief,command:'rm everything'}}))).brief.command).toBeUndefined();
    expect(/** @type {any} */ (readAction(reply({status:'clarify',question:'Goal?',choices:[{},'Build','Send','Review','More']}))).choices).toEqual(['Build','Send']);
  });
  it('keeps task details private from links and cloud sharing',()=>{
    const node={id:'one',label:'One',x:0,y:0,action:{stage:'ready',brief,by:'Duy'}};
    const s={nodes:[{...node,inside:{nodes:[{...node,id:'inside'}],edges:[]}}],edges:[]};
    const guest=sharedState(s,false,true);expect(guest.nodes[0].action).toBeUndefined();expect(/** @type {any} */ (guest.nodes[0].inside).nodes[0].action).toBeUndefined();expect(s.nodes[0].action).toBeDefined();
    expect(mapData(s).nodes[0].action).toBeUndefined();
    for(const type of ['actionbox','actionstart','actionretry','actionanswer','actionexecute','actioncontinue','actionstop','actioncancel','actionrevise'])expect(LINK_EDITS.has(type)).toBe(false);
  });
});

describe('the tools a run may use',()=>{
  it('are the ones the reviewed brief names, on Execute and again on Continue',()=>{
    const h=harness();h.start();h.requests.at(-1).onDone('',undefined,reply({status:'ready',brief:{...brief,tools:['Write','mcp__claude_ai_Gmail__send_message']}}));
    expect(h.node.action.stage).toBe('ready');
    h.api.execute('form','Duy',h.node.action.id);
    expect(h.launches[0].tools).toEqual(['Write','mcp__claude_ai_Gmail__send_message']);
    h.launches[0].onDone({text:'Done. Anything else?',blocked:false});
    expect(h.api.continue('form','Duy',h.node.action.id,'Send it')).toBe(true);
    expect(h.launches[1].tools).toEqual(['Write','mcp__claude_ai_Gmail__send_message']);
  });
  it('are none beyond the fixed read-only set when the brief names none',()=>{
    const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);
    expect(h.launches[0].tools).toEqual([]);
  });
});


describe('preparation\'s answer, read as an object',()=>{
  it('asks through the schema, with no JSON block written out in the prompt',()=>{
    expect(actionPrompt).not.toContain('```');
    expect(actionPrompt).toContain('Answer through the schema');
    expect(actionSchema.properties.status.enum).toEqual(['clarify','ready']);
    expect(actionSchema.properties.brief.required).toEqual(['kind','goal','target','result','steps','tools']);
  });
  it('takes no answer from words: a fenced block, a string or an array is not one',()=>{
    for(const value of ['```action\n'+JSON.stringify({status:'ready',brief})+'\n```',JSON.stringify({status:'ready',brief}),[{status:'ready',brief}],undefined,7]) expect(readAction(value)).toBeNull();
    expect(readAction({status:'ready',brief})).toMatchObject({stage:'ready',brief:{goal:brief.goal}});
  });
  it('shows an error, not a brief, when preparation answered in words alone',()=>{
    const h=harness();h.start();h.requests.at(-1).onDone('```action\n'+JSON.stringify({status:'ready',brief})+'\n```');
    expect(h.node.action.stage).toBe('error');expect(h.node.action.error).toContain('Could not prepare this action');
  });
});

describe('how a run ended, decided by code from what it did', () => {
  const email = {kind:'email',goal:'Email Sam',target:'sam@example.com',result:'Sent',steps:['Send it'],tools:['mcp__gmail__send'],email:{to:'sam@example.com',subject:'Hi',body:'Hello'}};
  const build = {kind:'build',goal:'Add the form',target:'acme/app',result:'A PR',steps:['Build it'],tools:['Edit','Bash']};
  /** @param {any} chosen @param {(url: string) => Promise<boolean>} [checkPull] */
  function ready(chosen, checkPull) {
    /** @type {any} */ const node={id:'f',label:'F'};const asks=[],runs=[];let changes=0;
    const api=actionBoxes({nodeOf:()=>node,allNodes:()=>[node],canUse:()=>true,context:()=>'',ask:(r)=>{asks.push(r);return ()=>{};},changed:()=>changes++,executionCwd:'/p',run:(r)=>{runs.push(r);return ()=>{};},checkPull});
    api.begin('f','Duy');api.start('f','Duy','Do it');asks[0].onDone('',{tools:chosen.tools,denied:[]},{status:'ready',brief:chosen});
    api.execute('f','Duy',node.action.id);
    return {api,node,runs};
  }
  it('completes an email only when code saw the send to its recipient',()=>{
    const r=ready(email);
    r.runs[0].onDone({text:'Sent',completion:{status:'completed',summary:'Sent it',evidence:['Message 42']},calls:[{tool:'mcp__gmail__send',input:{to:'sam@example.com'},ok:true,output:'id 42'}]});
    expect(r.node.action.completion).toEqual({status:'completed',summary:'Sent it',evidence:['Sent to sam@example.com (mcp__gmail__send)'],claimed:['Message 42']});
    expect(r.node.action.events.at(-1)).toMatchObject({what:'finished',status:'completed',verified:true,ran:['mcp__gmail__send']});
  });
  it('keeps a claim with no call behind it as unverified, and Continue hears what code saw happen',()=>{
    const r=ready(email);
    r.runs[0].onDone({text:'Sent',blocked:false,completion:{status:'completed',summary:'Sent it',evidence:['Message 42']},calls:[{tool:'Bash',input:{command:'echo hi'},ok:true,output:'hi',summary:'echo hi'}]});
    expect(r.node.action.completion.status).toBe('unverified');expect(r.node.action.stage).toBe('finished');
    expect(r.api.continue('f','Duy',r.node.action.id,'Check it went')).toBe(true);
    expect(r.runs[1].prompt).toContain('What the map saw this task already do');expect(r.runs[1].prompt).toContain('- Bash: echo hi');
  });
  it('waits for GitHub before a build counts, without the run looking interrupted meanwhile',async()=>{
    /** @type {(ok: boolean) => void} */ let answer=()=>{};
    const r=ready(build,()=>new Promise((resolve)=>{answer=resolve;}));
    r.runs[0].onDone({text:'Opened',completion:{status:'completed',summary:'Opened a PR',evidence:['PR 7']},calls:[{tool:'Bash',input:{},ok:true,output:'https://github.com/acme/app/pull/7'}]});
    expect(r.node.action.stage).toBe('running');r.api.reconcile();expect(r.node.action.stage).toBe('running');
    answer(true);await new Promise((resolve)=>setTimeout(resolve));
    expect(r.node.action.completion).toMatchObject({status:'completed',evidence:['Pull request https://github.com/acme/app/pull/7']});
  });
  it('keeps a build whose pull request GitHub does not know as unverified',async()=>{
    const r=ready(build,()=>Promise.resolve(false));
    r.runs[0].onDone({text:'Opened',completion:{status:'completed',summary:'Opened a PR',evidence:['PR 7']},calls:[{tool:'Bash',input:{},ok:true,output:'https://github.com/acme/app/pull/7'}]});
    await new Promise((resolve)=>setTimeout(resolve));
    expect(r.node.action.completion.status).toBe('unverified');
  });
});
