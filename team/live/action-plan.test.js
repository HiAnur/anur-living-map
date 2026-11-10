import { describe, expect, it } from 'vitest';

import { actionBoxes } from './action-box.js';
import { readPlannedTask, taskSource, dependencyBlockers } from './action-plan.js';
import { withoutActions } from './sharing.js';

const plan={goal:'Write a report',result:'A report with sources',destination:'/sample/report.md',inputs:['Research findings'],steps:['Read findings','Write report'],evidence:['Saved report and source links'],dependsOn:['research'],readiness:'waiting',blockers:[]};
const brief={kind:'other',goal:plan.goal,target:plan.destination,result:plan.result,steps:plan.steps,tools:['Write']};
const reply='```action\n'+JSON.stringify({status:'ready',brief})+'\n```';
function setup(){
  const nodes=[{id:'research',label:'Research',action:{stage:'draft'}},{id:'report',label:'Report'}], requests=[],runs=[];
  const nodeOf=id=>nodes.find(n=>n.id===id);
  const api=actionBoxes(/** @type {any} */ ({nodeOf,allNodes:()=>nodes,canUse:n=>!n.private,context:()=>JSON.stringify(nodes),ask:r=>{requests.push(r);return ()=>{};},changed(){},run:r=>{runs.push(r);return ()=>{};}}));
  api.begin('report','Duy',plan);
  const complete=()=>{Object.assign(nodes[0].action,{stage:'finished',source:taskSource(nodes[0]),completion:{status:'completed',summary:'Found sources',evidence:['/sample/sources.md']}});api.reconcile();};
  return {nodes,requests,runs,api,complete,nodeOf};
}
describe('planned Action readiness',()=>{
  it('stores only task data and rejects malformed instructions',()=>{
    expect(readPlannedTask({...plan,session:'injected',stage:'ready',by:'Owner'})).toEqual(plan);
    for(const bad of [null,{}, {...plan,dependsOn:['../file']},{...plan,readiness:'execute'},{...plan,steps:{}},{...plan,blockers:[{detail:'Need a file'}]}]) expect(readPlannedTask(bad)).toBeNull();
  });
  it('waits without a model call, then reuses saved inputs after the prerequisite completes',()=>{
    const h=setup();h.api.reconcile();expect(h.nodes[1].action.stage).toBe('waiting');
    h.api.prepare('report','Duy');expect(h.requests).toHaveLength(0);expect(h.runs).toHaveLength(0);
    h.complete();expect(h.nodes[1].action.stage).toBe('draft');expect(h.nodes[1].action.intent).toBe(plan.goal);
    h.api.start('report','Duy',plan.goal);expect(h.requests[0].prompt).toContain('/sample/sources.md');expect(h.requests[0].prompt).toContain('Saved report and source links');
    h.requests[0].onDone(reply,{tools:['Write'],denied:[]});expect(h.nodes[1].action.stage).toBe('ready');expect(h.runs).toHaveLength(0);
    h.api.execute('report','Duy',h.nodes[1].action.id);expect(h.runs).toHaveLength(1);expect(h.api.execute('report','Duy',h.nodes[1].action.id)).toBe(false);
  });
  it('cannot become ready with invented tools or denied lookups, and retries without executing',()=>{
    for(const access of [{tools:['Read'],denied:[]},{tools:['Write'],denied:['Read']}]){
      const h=setup();h.complete();h.api.start('report','Duy',plan.goal);h.requests[0].onDone(reply,access);expect(h.nodes[1].action.stage).toBe('error');expect(h.runs).toHaveLength(0);
      h.api.prepare('report','Duy');h.requests[1].onDone(reply,{tools:['Write'],denied:[]});expect(h.nodes[1].action.stage).toBe('ready');expect(h.runs).toHaveLength(0);
    }
  });
  it('rechecks dependencies before Execute and ignores stale or unconfirmed completion',()=>{
    const h=setup();h.complete();h.api.start('report','Duy',plan.goal);h.requests[0].onDone(reply,{tools:['Write'],denied:[]});
    h.nodes[0].label='Different research';expect(h.api.execute('report','Duy',h.nodes[1].action.id)).toBe(false);expect(h.nodes[1].action.stage).toBe('waiting');expect(h.runs).toHaveLength(0);
    h.complete();for(const completion of [{status:'completed',evidence:[]},{status:'needs_input',evidence:['A file']},{status:'unconfirmed',evidence:['A file']}]){h.nodes[0].action.completion=completion;expect(dependencyBlockers(plan,h.nodeOf,()=>true)).toHaveLength(1);}
    expect(dependencyBlockers(plan,h.nodeOf,()=>false)[0].detail).not.toContain('Research');
  });
  it('removes planned details from export and guest data, including nested nodes',()=>{
    const n={id:'a',boxType:'action',task:plan,action:{plan},inside:{nodes:[{id:'b',task:plan,action:{plan}}]}};
    expect(withoutActions([n])).toEqual([{id:'a',boxType:'action',inside:{nodes:[{id:'b'}]}}]);
  });
});
