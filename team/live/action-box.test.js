import { describe, expect, it } from 'vitest';

import { actionBoxes, actionPrompt, readActionReply, recoverAction } from './action-box.js';
import { LINK_EDITS, sharedState } from './sharing.js';
import { mapData } from './cloud-data.js';

const reply = (data) => '```action\n'+JSON.stringify(data)+'\n```';
const brief = {kind:'build',goal:'Build a contact form',target:'/sample/website',result:'Visitors can submit an inquiry',steps:['Add the form','Verify a submission']};
function harness() {
  let node={id:'form',label:'Contact form',sub:'Let visitors reach us'};
  const requests=[],launches=[],stops=[];let changed=0,allowed=true;
  const api=actionBoxes({nodeOf:()=>node,canUse:()=>allowed,context:()=> 'Whole map: Website > Contact form; Audience: small teams',
    ask:r=>{requests.push(r);return ()=>stops.push(true);}, changed:()=>changed++,launch:(n,b,done)=>launches.push({n,b,done})});
  return {api,requests,launches,stops,get node(){return node;},get changes(){return changed;},remove:()=>node=null,revoke:()=>allowed=false,
    start:()=>{if(!node.action)api.begin('form','Duy');return node.action.stage==='draft'?api.start('form','Duy','Build a contact form for the website'):api.prepare('form','Duy');},ready:()=>requests.at(-1).onDone(reply({status:'ready',brief}))};
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
    h.requests[0].onDone(reply({status:'clarify',question:'Which project?',choices:['Website','Dashboard']}));
    expect(h.node.action.stage).toBe('clarify');expect(h.launches).toHaveLength(0);
    expect(h.api.prepare('form','Duy','Website')).toBe(true);expect(h.requests[1].prompt).toContain('"question":"Which project?","answer":"Website"');
    h.ready();expect(h.node.action.stage).toBe('ready');expect(h.launches).toHaveLength(0);
    expect(h.api.execute('form','Duy',h.node.action.id)).toBe(true);expect(h.node.action.stage).toBe('sent');expect(h.launches).toHaveLength(1);
    expect(h.launches[0].b).toEqual(brief);expect(h.api.execute('form','Duy',h.node.action.id)).toBe(false);expect(h.start()).toBe(false);
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
  it('cancels preparation and ignores late replies',()=>{
    const h=harness();h.start();expect(h.api.cancel('form','Duy')).toBe(true);h.ready();expect(h.node.action).toBeUndefined();expect(h.stops).toHaveLength(1);
  });
  it('keeps a replacement request cancellable if a cancelled request replies late',()=>{
    const h=harness();h.start();const old=h.requests[0];h.api.cancel('form','Duy');h.start();
    old.onDone(reply({status:'ready',brief}));expect(h.node.action.stage).toBe('gathering');
    h.api.cancel('form','Duy');expect(h.stops).toHaveLength(2);
  });
  it('ignores a completed request after deletion or access removal',()=>{
    for(const change of ['remove','revoke']){const h=harness();h.start();const before=h.changes;h[change]();h.ready();expect(h.changes).toBe(before+(change==='revoke'?1:0));if(change==='revoke')expect(h.node.action.stage).toBe('error');expect(h.launches).toHaveLength(0);}
  });
  it('reports changed inputs, invalid output, and interrupted preparation',()=>{
    const h=harness();h.start();h.node.label='New intent';h.ready();expect(h.node.action.stage).toBe('error');
    h.start();h.requests.at(-1).onDone('Not signed in');expect(h.node.action.stage).toBe('error');
    h.start();recoverAction(h.node);expect(h.node.action.stage).toBe('error');expect(h.node.action.error).toContain('restarted');
  });
  it('does not mark a handoff failure as completed and stops children on close',()=>{
    const h=harness();h.start();h.ready();h.api.execute('form','Duy',h.node.action.id);h.launches[0].done(new Error('No app'));expect(h.node.action.stage).toBe('error');
    h.start();h.api.close();expect(h.stops).toHaveLength(1);
  });
  it('validates output, email details and bounds without accepting model operations',()=>{
    for(const value of [null,{}, {status:'ready',brief:{}},{status:'ready',brief:{...brief,steps:[]}}, {status:'ready',brief:{...brief,result:[]}}]) expect(readActionReply(reply(value))).toBeNull();
    const email={...brief,kind:'email',email:{to:'invented',subject:'Hello',body:'Thanks'}};
    expect(readActionReply(reply({status:'ready',brief:email})).stage).toBe('clarify');
    email.email.to='customer@example.com';expect(readActionReply(reply({status:'ready',brief:email}))).toMatchObject({stage:'ready',brief:{target:'customer@example.com'}});
    expect(readActionReply(reply({status:'ready',brief:{...brief,command:'rm everything'}})).brief.command).toBeUndefined();
    expect(readActionReply(reply({status:'clarify',question:'Goal?',choices:[{},'Build','Send','Review','More']})).choices).toEqual(['Build','Send']);
  });
  it('keeps task details private from links and cloud sharing',()=>{
    const node={id:'one',label:'One',x:0,y:0,action:{stage:'ready',brief,by:'Duy'}};
    const s={nodes:[{...node,inside:{nodes:[{...node,id:'inside'}],edges:[]}}],edges:[]};
    const guest=sharedState(s,false,true);expect(guest.nodes[0].action).toBeUndefined();expect(guest.nodes[0].inside.nodes[0].action).toBeUndefined();expect(s.nodes[0].action).toBeDefined();
    expect(mapData(s).nodes[0].action).toBeUndefined();
    for(const type of ['actionbox','actionstart','actionretry','actionanswer','actionexecute','actioncancel','actionrevise'])expect(LINK_EDITS.has(type)).toBe(false);
  });
});
