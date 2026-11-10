import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { AUTO_PLAN_QUESTION, autoPlanAdditions, autoPlanPrompt } from './auto-plan.js';
import { actionBoxes } from './action-box.js';
import { readPlannedTask } from './action-plan.js';

const server = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
function harness() {
  /** @type {any} */ const state = { title: 'Launch', nodes: [{id:'launch',label:'Launch',area:'product'},{id:'audience',label:'Audience',area:'product'},{id:'private',label:'Private budget',area:'finance'}], edges: [{from:'launch',to:'audience'}], people: [{id:'Tester',sees:'product'}], calls: [], threads: {}, log: [] };
  const calls = [];
  const actionRequests=[],runs=[];
  const actions=actionBoxes(/** @type {any} */ ({nodeOf:id=>state.nodes.find(n=>n.id===id),allNodes:()=>state.nodes,canUse:()=>true,context:()=>'',ask:r=>actionRequests.push(r),changed(){},run:r=>runs.push(r)}));
  const ctx = vm.createContext({ contextMaps:null, activeAsks:new Set(), state, project:'', name:'test-map', home:'.', AUTO_PLAN_QUESTION, autoPlanPrompt, autoPlanAdditions, readPlannedTask, actions,
    nodeOf:id=>state.nodes.find(n=>n.id===id), allNodes:()=>state.nodes, allEdges:()=>state.edges,
    stamp:()=> '12:00', fs:{mkdirSync(){}}, askClaude:a=>calls.push(a), save(){}, push(){}, clearTimeout(){}, setTimeout(){return 1;}, SIGNED_OUT:'signed out',
    placeProposed(){},
    mineChat:(key,by)=>key.startsWith(`@${by}>`), ownerOf:()=>null, tell(){},
    draw:plan=>{state.nodes.push(...plan.nodes);state.edges.push(...plan.edges);},
  });
  vm.runInContext(server.slice(server.indexOf('  const selectedContextMaps ='),server.indexOf('  const updateBoxDates =')),ctx);
  vm.runInContext(server.slice(server.indexOf('  const seesOf ='),server.indexOf('  const actions = actionBoxes(')),ctx);
  vm.runInContext(server.slice(server.indexOf('  function proposal('),server.indexOf('  // a proposed change')),ctx);
  const checkStart=server.indexOf('  function check('), checkEnd=server.indexOf('\n  }',checkStart)+4;
  vm.runInContext(server.slice(checkStart,checkEnd),ctx);
  vm.runInContext(server.slice(server.indexOf('  const pendingProposals ='),server.indexOf('  // History: every change saves itself')),ctx);
  vm.runInContext(`var acts={${server.slice(server.indexOf('    renamebox(a) {'),server.indexOf('    remove(a) {'))}${server.slice(server.indexOf('    ask(a) {'),server.indexOf('    // the Save menu:'))}${server.slice(server.indexOf('    apply(a) {'),server.indexOf('    drop(a) {'))}}`,ctx);
  return {state,calls,actions,actionRequests,runs,describe:a=>ctx.acts.describebox({by:'Tester',proposed:true,...a}),rename:a=>ctx.acts.renamebox({by:'Tester',proposed:true,...a}),ask:a=>ctx.acts.ask({by:'Tester',node:'launch',autoPlan:true,text:AUTO_PLAN_QUESTION,...a}),check:(p)=>ctx.check(p,'Tester'),apply:()=>ctx.acts.apply({by:'Tester',thread:'@Tester>launch',index:1})};
}
// what Claude's answer hands back: its words, and the change its propose_change call offered
const reply = plan => ['Suggested next steps.', undefined, plan];

describe('Auto plan',()=>{
  it('reads the map immediately on Auto plan without a mandatory goal question',()=>{
    const h=harness();expect(h.ask({text:''})).toBe(true);expect(h.ask({text:''})).toBe(false);
    expect(h.calls).toHaveLength(1);expect(h.state.threads['@Tester>launch']).toHaveLength(2);
    expect(h.state.threads['@Tester>launch'][0].text).toBe(AUTO_PLAN_QUESTION);
    expect(h.state.threads['@Tester>launch'][1]).toMatchObject({thinking:true,autoPlanAbout:'launch'});
    expect(h.calls[0].prompt).toContain('Audience [id: audience]');
    expect(h.calls[0].prompt).toContain('If the available context supports a useful plan, proceed directly.');
    h.calls[0].onDone(...reply({nodes:[{id:'pilot',label:'Pilot participants',sub:'What it is'}],edges:[{from:'audience',to:'pilot'}]}));
    expect(h.state.threads['@Tester>launch'][1].proposal.autoPlanAbout).toBe('launch');
  });
  it('keeps working through visible prose and hidden map generation, then clears the status',()=>{
    const h=harness();h.ask();const m=h.state.threads['@Tester>launch'][1];
    expect(m.doing).toBe('Planning additions');
    h.calls[0].onText('Here are the next steps.');expect(m.thinking).toBe(true);
    h.calls[0].onText('Here are the next steps.', true);
    expect(m.text).toBe('Here are the next steps.');expect(m.thinking).toBe(true);expect(m.doing).toBe('Preparing map changes');
    h.calls[0].onDone(...reply({nodes:[{id:'timing',label:'Timing',sub:'Choose a launch date'}]}));
    expect(m.thinking).toBeUndefined();expect(m.doing).toBeUndefined();expect(m.proposal.status).toBe('pending');
    expect(m.proposal.plan.nodes[0].sub).toBe('Choose a launch date');
    h.apply();expect(h.state.nodes.at(-1).sub).toBe('Choose a launch date');
  });
  it('offers a change only from the propose_change call, never from words in the reply',()=>{
    const h=harness();h.ask();
    h.calls[0].onDone('Here it is.\n```map\n{"nodes":[{"id":"timing","label":"Timing","sub":"Choose a date"}]}\n```');
    expect(h.state.threads['@Tester>launch'][1].proposal).toBeUndefined();
    for (const change of ['{"nodes":[]}',[{nodes:[]}],null]) {
      const again=harness();again.ask();again.calls[0].onDone('Here it is.',undefined,change);
      expect(again.state.threads['@Tester>launch'][1].proposal).toBeUndefined();
    }
  });
  it('clears working status for failed or signed-out replies',()=>{
    for (const text of ['signed out','Claude took too long. Ask again.']){
      const h=harness();h.ask();h.calls[0].onDone(text);const m=h.state.threads['@Tester>launch'][1];
      expect(m.thinking).toBeUndefined();expect(m.doing).toBeUndefined();expect(m.text).toBe(text);
    }
  });
  it('renames only your pending proposed box and applies the revised name',()=>{
    const h=harness();h.ask();h.calls[0].onDone(...reply({nodes:[{id:'timing',label:'Timing',sub:'Choose a date'}]}));
    const p=h.state.threads['@Tester>launch'][1].proposal;Object.assign(p.plan.nodes[0],{x:420,y:85});
    expect(h.rename({id:'timing',label:'Launch date',by:'SomeoneElse'})).toBe(false);
    expect(h.rename({id:'timing',label:' '})).toBe(false);
    expect(h.rename({id:'timing',label:'Launch date'})).toBe(true);
    expect(h.state.nodes.some(n=>n.id==='timing')).toBe(false);
    expect(p.plan.nodes[0]).toMatchObject({label:'Launch date',sub:'Choose a date',x:420,y:85});
    expect(p.ops).toContain('Add a line Launch → Launch date');
    h.apply();expect(h.state.nodes.at(-1).label).toBe('Launch date');
    expect(h.rename({id:'timing',label:'Too late'})).toBe(false);
  });
  it('edits only your pending proposed description and keeps its title when applied',()=>{
    const h=harness();h.ask();h.calls[0].onDone(...reply({nodes:[{id:'timing',label:'Timing',sub:'Choose a date'}]}));
    expect(h.describe({id:'timing',sub:'Changed',by:'SomeoneElse'})).toBe(false);
    expect(h.describe({id:'timing',sub:42})).toBe(false);
    expect(h.describe({id:'timing',sub:'  Confirm with the team  '})).toBe(true);
    const n=h.state.threads['@Tester>launch'][1].proposal.plan.nodes[0];expect(n).toMatchObject({label:'Timing',sub:'Confirm with the team'});
    h.apply();expect(h.state.nodes.at(-1)).toMatchObject({label:'Timing',sub:'Confirm with the team'});
    expect(h.describe({id:'timing',sub:'Too late'})).toBe(false);
  });
  it('uses the selected box and visible map in its side chat, once per unfinished reply',()=>{
    const h=harness();h.state.threads['@SomeoneElse']=[{who:'SomeoneElse',text:'Private chat'}];
    expect(h.ask()).toBe(true);expect(h.ask()).toBe(false);expect(h.calls).toHaveLength(1);
    expect(h.calls[0].prompt).toContain('Launch [id: launch]');expect(h.calls[0].prompt).toContain('Audience [id: audience]');
    expect(h.calls[0].prompt).toContain('This is Auto plan');expect(h.calls[0].prompt).not.toContain('Private budget');expect(h.calls[0].prompt).not.toContain('Private chat');
    expect(h.state.threads['@Tester>launch'][0].text).toBe(AUTO_PLAN_QUESTION);
  });
  it('includes grandchildren and other branches when planning from either a parent or a leaf',()=>{
    for (const selected of ['launch','pm']) {
      const h=harness();
      h.state.nodes.push({id:'categories',label:'Categories',area:'product'}, {id:'pm',label:'PM',sub:'Owns planning',desc:'Talk to the product lead',area:'product'}, {id:'pricing',label:'Pricing',sub:'Existing pricing research',area:'product'});
      h.state.edges.push({from:'audience',to:'categories'},{from:'categories',to:'pm'},{from:'launch',to:'pricing'});
      h.ask({node:selected});const prompt=h.calls[0].prompt;
      for (const text of ['PM [id: pm] (Owns planning)','Talk to the product lead','Pricing [id: pricing] (Existing pricing research)','Categories [id: categories] -> PM [id: pm]','Launch [id: launch] -> Audience [id: audience]']) expect(prompt).toContain(text);
      expect(prompt).toContain(`selected box (${selected}) and its entire branch`);
      expect(prompt).not.toContain('Private budget');
    }
  });
  it('keeps a suggested gap under an existing descendant through editing and Apply',()=>{
    const h=harness();h.state.nodes.push({id:'categories',label:'Categories',area:'product'});h.state.edges.push({from:'audience',to:'categories'});
    h.ask();h.calls[0].onDone(...reply({nodes:[{id:'founder',label:'Founder',sub:'The buyer'}],edges:[{from:'categories',to:'founder'}]}));
    const p=h.state.threads['@Tester>launch'][1].proposal;
    expect(p.plan.edges).toEqual([{from:'categories',to:'founder',state:'new'}]);
    h.rename({id:'founder',label:'Founder buyer'});h.describe({id:'founder',sub:'Who approves the budget'});
    h.apply();expect(h.state.edges.at(-1)).toMatchObject({from:'categories',to:'founder'});
    expect(h.state.nodes.at(-1)).toMatchObject({label:'Founder buyer',sub:'Who approves the budget'});
  });
  it('drops a destination that is removed, moved out of the branch or no longer accessible before Apply',()=>{
    for (const change of ['removed','moved','private']) {
      const h=harness();h.ask();h.calls[0].onDone(...reply({nodes:[{id:'founder',label:'Founder',sub:'What it is'}],edges:[{from:'audience',to:'founder'}]}));
      if(change==='removed') h.state.nodes=h.state.nodes.filter(n=>n.id!=='audience');
      if(change==='moved') h.state.edges=[];
      if(change==='private') h.state.nodes[1].area='finance';
      h.apply();expect(h.state.nodes.some(n=>n.id==='founder')).toBe(false);
      expect(h.state.threads['@Tester>launch'][1].proposal.status).toBe('dropped');
    }
  });
  it('rejects private, unrelated, ambiguous and nonexistent destinations without relocating them',()=>{
    const h=harness();h.state.nodes.push({id:'other',label:'Other',area:'product'});
    h.ask();h.calls[0].onDone(...reply({nodes:[{id:'a',label:'A',sub:'What it is'},{id:'b',label:'B',sub:'What it is'},{id:'c',label:'C',sub:'What it is'},{id:'d',label:'D',sub:'What it is'}],edges:[{from:'private',to:'a'},{from:'other',to:'b'},{from:'missing',to:'c'},{from:'launch',to:'d'},{from:'audience',to:'d'}]}));
    expect(h.state.threads['@Tester>launch'][1].proposal.status).toBe('dropped');
  });
  it('avoids duplicate names across the accessible map, including additions arriving before Apply',()=>{
    const h=harness();h.state.nodes.push({id:'pricing',label:'Pricing',area:'product'});
    h.ask();h.calls[0].onDone(...reply({nodes:[{id:'copy',label:' pricing ',sub:'What it is'},{id:'timing',label:'Timing',sub:'What it is'}]}));
    const p=h.state.threads['@Tester>launch'][1].proposal;expect(p.plan.nodes.map(n=>n.id)).toEqual(['timing']);
    h.state.nodes.push({id:'new-date',label:'Timing',area:'product'});h.apply();expect(p.status).toBe('dropped');
  });
  it('traverses cycles safely and never reaches a visible descendant through a private box',()=>{
    const existing=[{id:'root',label:'Root'},{id:'child',label:'Child'},{id:'private',label:'Secret'},{id:'behind',label:'Behind'}];
    const edges=[{from:'root',to:'child'},{from:'child',to:'root'},{from:'root',to:'private'},{from:'private',to:'behind'}];
    const plan=autoPlanAdditions({nodes:[{id:'a',label:'A',sub:'What it is'},{id:'b',label:'B',sub:'What it is'}],edges:[{from:'child',to:'a'},{from:'behind',to:'b'}]},'root',existing,edges,new Set(['root','child','behind']));
    expect(plan.edges).toEqual([{from:'child',to:'a'}]);
  });
  it('requires an accessible selected box',()=>{
    const h=harness();expect(h.ask({node:undefined})).toBe(false);expect(h.ask({node:'private'})).toBe(false);expect(h.ask({node:'missing'})).toBe(false);expect(h.calls).toHaveLength(0);
  });
  it('only proposes new children, then adds them on Apply',()=>{
    const h=harness();h.ask();h.calls[0].onDone(...reply({nodes:[{id:'launch',label:'Overwrite',sub:'What it is'},{id:'copy',label:' audience ',sub:'What it is'},{id:'timing',label:'Timing',desc:'Choose when to launch',state:'gone'}],edges:[{from:'launch',to:'timing'}],remove:['audience'],start:'timing',tidy:true,memory:[{text:'An instruction'}]}));
    const p=h.state.threads['@Tester>launch'][1].proposal;
    expect(h.state.nodes).toHaveLength(3);expect(p.status).toBe('pending');expect(p.plan.nodes).toEqual([{id:'timing',label:'Timing',sub:'Choose when to launch',desc:'Choose when to launch',state:'new',area:'product',by:'Claude'}]);
    expect(p.plan.edges).toEqual([{from:'launch',to:'timing',state:'new'}]);expect(p.plan.remove).toEqual([]);expect(p.plan.memory).toEqual([]);expect(p.plan.start).toBeUndefined();expect(p.plan.tidy).toBeUndefined();
    expect(h.apply()).toBe(true);expect(h.state.nodes).toHaveLength(4);expect(p.status).toBe('applied');expect(h.apply()).toBe(false);
  });
  it('does not overwrite a box added while suggestions were waiting',()=>{
    const h=harness();h.ask();h.calls[0].onDone(...reply({nodes:[{id:'timing',label:'Timing',sub:'What it is'}]}));h.state.nodes.push({id:'timing',label:'Someone else’s box'});
    expect(h.apply()).toBe(true);expect(h.state.nodes.filter(n=>n.id==='timing')).toEqual([{id:'timing',label:'Someone else’s box'}]);expect(h.state.threads['@Tester>launch'][1].proposal.status).toBe('dropped');
  });
  it('drops additions when their parent disappears or access changes',()=>{
    for(const stage of ['reply','apply']) {
      const h=harness();h.ask();if(stage==='apply')h.calls[0].onDone(...reply({nodes:[{id:'timing',label:'Timing',sub:'What it is'}]}));
      h.state.nodes[0].area='finance';if(stage==='reply')h.calls[0].onDone(...reply({nodes:[{id:'timing',label:'Timing',sub:'What it is'}]}));else h.apply();
      expect(h.state.threads['@Tester>launch'][1].proposal.status).toBe('dropped');expect(h.state.nodes).toHaveLength(3);
    }
  });
  it('asks about unclear intent without proposing boxes, then carries the answer into continued planning',()=>{
    const h=harness();h.ask();
    expect(h.calls[0].prompt).toContain('only when essential information is missing and different answers would materially change the plan');
    expect(h.calls[0].prompt).toContain('Do not guess or propose boxes in that reply.');
    const question='Is this launch for an internal pilot or paying customers?';
    h.calls[0].onDone(question);
    expect(h.state.threads['@Tester>launch'][1].proposal).toBeUndefined();expect(h.state.nodes).toHaveLength(3);
    h.ask({autoPlan:false,side:true,text:'An internal pilot with the support team.'});
    const prompt=h.calls[1].prompt;
    expect(prompt).toContain(question);expect(prompt).toContain('An internal pilot with the support team.');
    expect(prompt).toContain('continue the original request using their clarification');
    expect(prompt).toContain('Audience [id: audience]');
    h.calls[1].onDone(...reply({nodes:[{id:'pilot',label:'Support pilot',sub:'Try with the support team'}],edges:[{from:'launch',to:'pilot'}]}));
    expect(h.state.threads['@Tester>launch'][3].proposal.status).toBe('pending');
    expect(h.state.nodes).toHaveLength(3);
  });
  it('keeps ordinary Side Chat questions unchanged',()=>{
    const h=harness();h.ask({autoPlan:false,side:true,text:'Which audience should we consider?'});
    expect(h.calls[0].prompt).not.toContain('This is Auto plan');expect(h.calls[0].prompt).toContain('Which audience should we consider?');
  });
  it('bounds and validates malformed suggestions and ignores model supplied operations',()=>{
    expect(autoPlanAdditions(null,'root',[],[])).toEqual({nodes:[],edges:[]});
    const plan=autoPlanAdditions({nodes:[null,{id:{},label:'Bad',sub:'What it is'},{id:'empty',label:' ',sub:'What it is'},{id:'one',label:'One',sub:'What it is'},{id:'one',label:'Other',sub:'What it is'},...Array.from({length:9},(_,i)=>({id:`n${i}`,label:`Next ${i}`,sub:'What it is'}))]},'root',[{id:'root',label:'Root'}],[]);
    expect(plan.nodes).toHaveLength(10);expect(plan.edges.every(e=>e.from==='root')).toBe(true);
  });
  it('applies nested Topics and real draft Actions with their task details, without preparing or executing',()=>{
    const h=harness(),task={goal:'Research pilot participants',result:'A shortlist with supporting sources',destination:'Attach to this Action',inputs:['Audience'],steps:['Read the audience notes'],evidence:['Shortlist with sources'],dependsOn:[],readiness:'ready',blockers:[]};
    h.ask();h.calls[0].onDone(...reply({nodes:[{id:'research',label:'Research participants',sub:'What it is',boxType:'action',task,action:{stage:'ready',session:'injected'}},{id:'pilot',label:'Pilot planning',sub:'What it is',boxType:'topic'}],edges:[{from:'launch',to:'pilot'},{from:'pilot',to:'research'}]}));
    expect(h.state.nodes).toHaveLength(3);expect(h.apply()).toBe(true);
    const n=h.state.nodes.find(n=>n.id==='research');expect(n.boxType).toBe('action');expect(n.action).toMatchObject({by:'Tester',stage:'draft',intent:task.goal,plan:task});expect(n.action.session).toBeUndefined();expect(n.task).toBeUndefined();
    expect(h.actionRequests).toHaveLength(0);expect(h.runs).toHaveLength(0);expect(h.state.edges).toContainEqual({from:'pilot',to:'research',state:'new'});
    h.actions.start('research','Tester',n.action.intent);expect(h.actionRequests[0].prompt).toContain(task.result);expect(h.runs).toHaveLength(0);
  });
  it('drops cyclic, missing or Topic prerequisites and their dependent proposals',()=>{
    const task=(dependsOn)=>({goal:'Do the task',result:'A checked result',steps:['Do the work'],evidence:['Saved result'],dependsOn});
    const nodes=[{id:'a',label:'A',sub:'What it is',boxType:'action',task:task(['b'])},{id:'b',label:'B',sub:'What it is',boxType:'action',task:task(['a'])},{id:'c',label:'C',sub:'What it is',boxType:'action',task:task(['a'])},{id:'t',label:'Topic',sub:'What it is',boxType:'topic'},{id:'d',label:'D',sub:'What it is',boxType:'action',task:task(['t'])},{id:'e',label:'E',sub:'What it is',boxType:'action',task:task(['missing'])},{id:'ok',label:'Independent',sub:'What it is',boxType:'action',task:task([])}];
    const p=autoPlanAdditions({nodes},'root',[{id:'root',label:'Root'}],[]);expect(p.nodes.map(n=>n.id)).toEqual(['t','ok']);expect(p.dropped).toHaveLength(5);
  });
  it('rechecks prerequisite access at Apply without removing independent work',()=>{
    const h=harness();h.state.nodes.push({id:'research',label:'Existing research',area:'product',action:{stage:'draft'}});
    h.ask();h.calls[0].onDone(...reply({nodes:[{id:'write',label:'Write shortlist',sub:'What it is',boxType:'action',task:{goal:'Write a shortlist',result:'A saved shortlist',steps:['Write shortlist'],evidence:['Saved shortlist'],dependsOn:['research']}},{id:'schedule',label:'Pilot schedule',sub:'What it is',boxType:'topic'}]}));
    h.state.nodes.find(n=>n.id==='research').area='finance';expect(h.apply()).toBe(true);expect(h.state.nodes.some(n=>n.id==='write')).toBe(false);expect(h.state.nodes.some(n=>n.id==='schedule')).toBe(true);
  });
  it('does not put someone else\'s private Action details into the planner context',()=>{
    const h=harness();h.state.nodes[1].action={by:'Other',stage:'ready',plan:{goal:'Private account lookup'},completion:{evidence:['Private message ID']}};
    h.ask();expect(h.calls[0].prompt).not.toContain('Private account lookup');expect(h.calls[0].prompt).not.toContain('Private message ID');
  });
});

describe('what a proposal must give',()=>{
  const reasons=p=>p.dropped.map(d=>`${d.text}: ${d.why}`);
  it('leaves out a new box with no second line, and keeps one that has it or notes to take it from',()=>{
    const h=harness();
    const p=h.check({nodes:[{id:'bare',label:'Bare'},{id:'blank',label:'Blank',sub:'  '},{id:'kept',label:'Kept',sub:'Stays'}],edges:[{from:'launch',to:'bare'},{from:'launch',to:'kept'}]});
    expect(p.plan.nodes.map(n=>n.id)).toEqual(['kept']);
    expect(reasons(p)).toEqual(['Bare: a new box needs a second line that says what it is','Blank: a new box needs a second line that says what it is','a line launch → bare: a box it names is not on the map']);
    expect(h.check({nodes:[{id:'audience',label:'Audience',state:'todo'}]}).plan.nodes).toEqual([{id:'audience',label:'Audience',state:'todo'}]);
  });
  it('lets a line with no words hang a box under another only when it is the one line into that box',()=>{
    const h=harness();h.state.nodes.push({id:'pricing',label:'Pricing',area:'product'});
    // a new box's first line, and a box with no line into it yet
    const first=h.check({nodes:[{id:'new',label:'New',sub:'s'}],edges:[{from:'launch',to:'new'},{from:'audience',to:'pricing'}]});
    expect(first.plan.edges).toEqual([{from:'launch',to:'new',state:'new'},{from:'audience',to:'pricing',state:'new'}]);
    // a box moved under another: its old line taken away in the same change
    const moved=h.check({edges:[{from:'pricing',to:'audience'}],unlink:[{from:'launch',to:'audience'}]});
    expect(moved.plan.edges).toEqual([{from:'pricing',to:'audience',state:'new'}]);expect(moved.dropped).toEqual([]);
  });
  it('leaves out a line with no words into a box that already hangs under another, and keeps it with words',()=>{
    const h=harness();h.state.nodes.push({id:'pricing',label:'Pricing',area:'product'});
    const bare=h.check({edges:[{from:'pricing',to:'audience'},{from:'pricing',to:'audience',label:'  '}]});
    expect(bare.status).toBe('dropped');
    expect(reasons(bare)).toEqual(Array(2).fill('a line Pricing → Audience: say what happens on it: Audience already hangs under another box'));
    const said=h.check({edges:[{from:'pricing',to:'audience',label:'Sets the price'}]});
    expect(said.plan.edges).toEqual([{from:'pricing',to:'audience',label:'Sets the price',state:'new'}]);
    // two lines with no words into one new box: the box has two, so neither is only the line it hangs from
    const two=h.check({nodes:[{id:'new',label:'New',sub:'s'}],edges:[{from:'launch',to:'new'},{from:'audience',to:'new'}]});
    expect(two.plan.edges).toEqual([]);
  });
  it('drops an Auto plan box with nothing under its name, and the boxes it was to hold',()=>{
    const p=autoPlanAdditions({nodes:[{id:'bare',label:'Bare'},{id:'child',label:'Child',sub:'Under bare'},{id:'noted',label:'Noted',desc:'From the notes\nmore'}],edges:[{from:'bare',to:'child'}]},'root',[{id:'root',label:'Root'}],[]);
    expect(p.nodes.map(n=>[n.id,n.sub])).toEqual([['noted','From the notes']]);
    expect(p.dropped).toEqual([{text:'Bare',why:'a new box needs a second line that says what it is'},{text:'Child',why:'its parent is outside the accessible branch'}]);
  });
});
