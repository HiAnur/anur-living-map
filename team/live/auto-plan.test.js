import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { AUTO_PLAN_QUESTION, autoPlanAdditions, autoPlanPrompt } from './auto-plan.js';

const server = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
function harness() {
  const state = { title: 'Launch', nodes: [{id:'launch',label:'Launch',area:'product'},{id:'audience',label:'Audience',area:'product'},{id:'private',label:'Private budget',area:'finance'}], edges: [{from:'launch',to:'audience'}], people: [{id:'Tester',sees:'product'}], calls: [], threads: {}, log: [] };
  const calls = [];
  const ctx = vm.createContext({ state, project:'', name:'test-map', home:'.', AUTO_PLAN_QUESTION, autoPlanPrompt, autoPlanAdditions,
    nodeOf:id=>state.nodes.find(n=>n.id===id), allNodes:()=>state.nodes, allEdges:()=>state.edges,
    stamp:()=> '12:00', fs:{mkdirSync(){}}, askClaude:a=>calls.push(a), save(){}, push(){}, clearTimeout(){}, setTimeout(){return 1;}, SIGNED_OUT:'signed out',
    withoutBlock:text=>text.split('```map')[0].trim(), placeProposed(){},
    mineChat:(key,by)=>key.startsWith(`@${by}>`), ownerOf:()=>null, tell(){},
    draw:plan=>{state.nodes.push(...plan.nodes);state.edges.push(...plan.edges);},
  });
  vm.runInContext(server.slice(server.indexOf('  const seesOf ='),server.indexOf('  // Instructions (what Claude')),ctx);
  vm.runInContext(server.slice(server.indexOf('  function proposal('),server.indexOf('  // a proposed change')),ctx);
  const checkStart=server.indexOf('  function check('), checkEnd=server.indexOf('\n  }',checkStart)+4;
  vm.runInContext(server.slice(checkStart,checkEnd),ctx);
  vm.runInContext(server.slice(server.indexOf('  const pendingProposals ='),server.indexOf('  const withoutBlock =')),ctx);
  vm.runInContext(`var acts={${server.slice(server.indexOf('    renamebox(a) {'),server.indexOf('    remove(a) {'))}${server.slice(server.indexOf('    ask(a) {'),server.indexOf('    // the Save menu:'))}${server.slice(server.indexOf('    apply(a) {'),server.indexOf('    drop(a) {'))}}`,ctx);
  return {state,calls,describe:a=>ctx.acts.describebox({by:'Tester',proposed:true,...a}),rename:a=>ctx.acts.renamebox({by:'Tester',proposed:true,...a}),ask:a=>ctx.acts.ask({by:'Tester',node:'launch',autoPlan:true,...a}),apply:()=>ctx.acts.apply({by:'Tester',thread:'@Tester>launch',index:1})};
}
const reply = plan => `Suggested next steps.\n\`\`\`map\n${JSON.stringify(plan)}\n\`\`\``;

describe('Auto plan',()=>{
  it('keeps working through visible prose and hidden map generation, then clears the status',()=>{
    const h=harness();h.ask();const m=h.state.threads['@Tester>launch'][1];
    expect(m.doing).toBe('Planning additions');
    h.calls[0].onText('Here are the next steps.');expect(m.thinking).toBe(true);
    h.calls[0].onText('Here are the next steps.\n```map\n{"nodes":');
    expect(m.text).toBe('Here are the next steps.');expect(m.thinking).toBe(true);expect(m.doing).toBe('Preparing map changes');
    h.calls[0].onDone(reply({nodes:[{id:'timing',label:'Timing',sub:'Choose a launch date'}]}));
    expect(m.thinking).toBeUndefined();expect(m.doing).toBeUndefined();expect(m.proposal.status).toBe('pending');
    expect(m.proposal.plan.nodes[0].sub).toBe('Choose a launch date');
    h.apply();expect(h.state.nodes.at(-1).sub).toBe('Choose a launch date');
  });
  it('clears working status for failed or signed-out replies',()=>{
    for (const text of ['signed out','Claude took too long. Ask again.']){
      const h=harness();h.ask();h.calls[0].onDone(text);const m=h.state.threads['@Tester>launch'][1];
      expect(m.thinking).toBeUndefined();expect(m.doing).toBeUndefined();expect(m.text).toBe(text);
    }
  });
  it('renames only your pending proposed box and applies the revised name',()=>{
    const h=harness();h.ask();h.calls[0].onDone(reply({nodes:[{id:'timing',label:'Timing',sub:'Choose a date'}]}));
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
    const h=harness();h.ask();h.calls[0].onDone(reply({nodes:[{id:'timing',label:'Timing',sub:'Choose a date'}]}));
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
    h.ask();h.calls[0].onDone(reply({nodes:[{id:'founder',label:'Founder',sub:'The buyer'}],edges:[{from:'categories',to:'founder'}]}));
    const p=h.state.threads['@Tester>launch'][1].proposal;
    expect(p.plan.edges).toEqual([{from:'categories',to:'founder',state:'new'}]);
    h.rename({id:'founder',label:'Founder buyer'});h.describe({id:'founder',sub:'Who approves the budget'});
    h.apply();expect(h.state.edges.at(-1)).toMatchObject({from:'categories',to:'founder'});
    expect(h.state.nodes.at(-1)).toMatchObject({label:'Founder buyer',sub:'Who approves the budget'});
  });
  it('drops a destination that is removed, moved out of the branch or no longer accessible before Apply',()=>{
    for (const change of ['removed','moved','private']) {
      const h=harness();h.ask();h.calls[0].onDone(reply({nodes:[{id:'founder',label:'Founder'}],edges:[{from:'audience',to:'founder'}]}));
      if(change==='removed') h.state.nodes=h.state.nodes.filter(n=>n.id!=='audience');
      if(change==='moved') h.state.edges=[];
      if(change==='private') h.state.nodes[1].area='finance';
      h.apply();expect(h.state.nodes.some(n=>n.id==='founder')).toBe(false);
      expect(h.state.threads['@Tester>launch'][1].proposal.status).toBe('dropped');
    }
  });
  it('rejects private, unrelated, ambiguous and nonexistent destinations without relocating them',()=>{
    const h=harness();h.state.nodes.push({id:'other',label:'Other',area:'product'});
    h.ask();h.calls[0].onDone(reply({nodes:[{id:'a',label:'A'},{id:'b',label:'B'},{id:'c',label:'C'},{id:'d',label:'D'}],edges:[{from:'private',to:'a'},{from:'other',to:'b'},{from:'missing',to:'c'},{from:'launch',to:'d'},{from:'audience',to:'d'}]}));
    expect(h.state.threads['@Tester>launch'][1].proposal.status).toBe('dropped');
  });
  it('avoids duplicate names across the accessible map, including additions arriving before Apply',()=>{
    const h=harness();h.state.nodes.push({id:'pricing',label:'Pricing',area:'product'});
    h.ask();h.calls[0].onDone(reply({nodes:[{id:'copy',label:' pricing '},{id:'timing',label:'Timing'}]}));
    const p=h.state.threads['@Tester>launch'][1].proposal;expect(p.plan.nodes.map(n=>n.id)).toEqual(['timing']);
    h.state.nodes.push({id:'new-date',label:'Timing',area:'product'});h.apply();expect(p.status).toBe('dropped');
  });
  it('traverses cycles safely and never reaches a visible descendant through a private box',()=>{
    const existing=[{id:'root',label:'Root'},{id:'child',label:'Child'},{id:'private',label:'Secret'},{id:'behind',label:'Behind'}];
    const edges=[{from:'root',to:'child'},{from:'child',to:'root'},{from:'root',to:'private'},{from:'private',to:'behind'}];
    const plan=autoPlanAdditions({nodes:[{id:'a',label:'A'},{id:'b',label:'B'}],edges:[{from:'child',to:'a'},{from:'behind',to:'b'}]},'root',existing,edges,new Set(['root','child','behind']));
    expect(plan.edges).toEqual([{from:'child',to:'a'}]);
  });
  it('requires an accessible selected box',()=>{
    const h=harness();expect(h.ask({node:undefined})).toBe(false);expect(h.ask({node:'private'})).toBe(false);expect(h.ask({node:'missing'})).toBe(false);expect(h.calls).toHaveLength(0);
  });
  it('only proposes new children, then adds them on Apply',()=>{
    const h=harness();h.ask();h.calls[0].onDone(reply({nodes:[{id:'launch',label:'Overwrite'},{id:'copy',label:' audience '},{id:'timing',label:'Timing',desc:'Choose when to launch',state:'gone'}],edges:[{from:'launch',to:'timing'}],remove:['audience'],start:'timing',tidy:true,memory:[{text:'An instruction'}]}));
    const p=h.state.threads['@Tester>launch'][1].proposal;
    expect(h.state.nodes).toHaveLength(3);expect(p.status).toBe('pending');expect(p.plan.nodes).toEqual([{id:'timing',label:'Timing',sub:'Choose when to launch',desc:'Choose when to launch',state:'new',area:'product',by:'Claude'}]);
    expect(p.plan.edges).toEqual([{from:'launch',to:'timing',state:'new'}]);expect(p.plan.remove).toEqual([]);expect(p.plan.memory).toEqual([]);expect(p.plan.start).toBeUndefined();expect(p.plan.tidy).toBeUndefined();
    expect(h.apply()).toBe(true);expect(h.state.nodes).toHaveLength(4);expect(p.status).toBe('applied');expect(h.apply()).toBe(false);
  });
  it('does not overwrite a box added while suggestions were waiting',()=>{
    const h=harness();h.ask();h.calls[0].onDone(reply({nodes:[{id:'timing',label:'Timing'}]}));h.state.nodes.push({id:'timing',label:'Someone else’s box'});
    expect(h.apply()).toBe(true);expect(h.state.nodes.filter(n=>n.id==='timing')).toEqual([{id:'timing',label:'Someone else’s box'}]);expect(h.state.threads['@Tester>launch'][1].proposal.status).toBe('dropped');
  });
  it('drops additions when their parent disappears or access changes',()=>{
    for(const stage of ['reply','apply']) {
      const h=harness();h.ask();if(stage==='apply')h.calls[0].onDone(reply({nodes:[{id:'timing',label:'Timing'}]}));
      h.state.nodes[0].area='finance';if(stage==='reply')h.calls[0].onDone(reply({nodes:[{id:'timing',label:'Timing'}]}));else h.apply();
      expect(h.state.threads['@Tester>launch'][1].proposal.status).toBe('dropped');expect(h.state.nodes).toHaveLength(3);
    }
  });
  it('allows a clarifying question without inventing an empty plan',()=>{
    const h=harness();h.ask();h.calls[0].onDone('What are you launching?');expect(h.state.threads['@Tester>launch'][1].proposal).toBeUndefined();expect(h.state.nodes).toHaveLength(3);
  });
  it('keeps ordinary Side Chat questions unchanged',()=>{
    const h=harness();h.ask({autoPlan:false,side:true,text:'Which audience should we consider?'});
    expect(h.calls[0].prompt).not.toContain('This is Auto plan');expect(h.calls[0].prompt).toContain('Which audience should we consider?');
  });
  it('bounds and validates malformed suggestions and ignores model supplied operations',()=>{
    expect(autoPlanAdditions(null,'root',[],[])).toEqual({nodes:[],edges:[]});
    const plan=autoPlanAdditions({nodes:[null,{id:{},label:'Bad'},{id:'empty',label:' '},{id:'one',label:'One'},{id:'one',label:'Other'},...Array.from({length:9},(_,i)=>({id:`n${i}`,label:`Next ${i}`}))]},'root',[{id:'root',label:'Root'}],[]);
    expect(plan.nodes).toHaveLength(5);expect(plan.edges.every(e=>e.from==='root')).toBe(true);
  });
});
