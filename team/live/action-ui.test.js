import { describe, expect, it } from 'vitest';

import { actionCancellable } from './action-stages.js';
import { actionScreens } from './page-action.js';

const esc=s=>String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// the Action screens as Duy sees them, with the page's helpers stood in for; `box` and `open` stand for the map
// and the sections opened, and a test may change either
function panel(){
  const p={box:/** @type {(id: string) => any} */ (()=>({label:'Research'})),open:new Set()};
  return Object.assign(p,actionScreens({me:'Duy',live:true,admin:false,people:[],esc,prose:esc,md:esc,yours:s=>`<p>${esc(s)}</p>`,claudes:s=>s,attached:()=>'',sendIcon:'Send',
    opened:k=>p.open.has(k),box:id=>p.box(id),cancellable:actionCancellable}));
}
describe('planned Action controls',()=>{
  it('shows prefilled instructions, expected result and destination without offering Execute',()=>{
    const p=panel(),goal='Write </textarea><script>alert(1)</script>',plan={goal,result:'A sourced report',destination:'Attach here',readiness:'needs_information',steps:['Read sources'],evidence:['Report attached'],blockers:[{detail:'Confirm the audience',resolver:'You'}]};
    const rendered=p.actionChat({id:'report',action:{by:'Duy',stage:'draft',intent:goal,plan}},'');
    expect(rendered).toContain('A sourced report');expect(rendered).toContain('Attach here');expect(rendered).toContain('Confirm the audience (You)');expect(rendered).toContain('aria-label="Prepare action"');expect(rendered).toContain(`required>${esc(goal)}</textarea>`);expect(rendered).not.toContain('<script>');expect(rendered).not.toContain('data-box-action="actionexecute"');expect(rendered).not.toContain('What do you want to do?');
  });
  it('shows the dependency reason and only offers checking again while waiting',()=>{
    const p=panel(),rendered=p.actionChat({id:'report',action:{by:'Duy',stage:'waiting',waiting:[{detail:'Waiting for Research to finish with confirmation.'}]}},'');
    expect(rendered).toContain('Waiting on a dependency');expect(rendered).toContain('Waiting for Research');expect(rendered).toContain('Check again');expect(rendered).not.toContain('actionexecute');expect(rendered).not.toContain('data-action-start');
  });
  it('updates a released dependency instead of repeating the old waiting assessment',()=>{
    const p=panel();p.box=()=>({label:'Research',action:{stage:'finished',completion:{status:'completed',evidence:['Saved research']}}});
    const rendered=p.plannedActionCard({id:'report',action:{stage:'draft'}},{goal:'Write report',result:'Saved report',readiness:'waiting',dependsOn:['research']});
    expect(rendered).toContain('Prerequisites completed. Ready for preparation');expect(rendered).toContain('Research · Completed');expect(rendered).not.toContain('Waiting on a dependency');
  });
  it('keeps previous documents downloadable and readable safely in the chat',()=>{
    const p=panel(),content='Original <script>message</script>\nSecond line',file={id:'v1',name:'Action version 1.md',content};
    const rendered=p.actionChat({id:'email',action:{by:'Duy',stage:'clarify',question:'What should change?',documents:[file]}},'');
    expect(rendered).toContain('download="Action version 1.md"');expect(rendered).toContain('View document');expect(rendered).toContain(esc(content));expect(rendered).not.toContain('<script>');
    expect(decodeURIComponent(/** @type {RegExpMatchArray} */ (rendered.match(/href="data:text\/markdown;charset=utf-8,([^"]+)/))[1])).toBe(content);
    p.open.add('action-document:v1');expect(p.actionDocuments({documents:[file]})).toContain('data-open-key="action-document:v1" open');
  });
  it('keeps existing reviewed execution and completed evidence controls',()=>{
    const p=panel(),n={id:'report',action:{by:'Duy',id:'revision',stage:'ready',brief:{goal:'Write report',target:'Attach here',result:'Report',steps:['Write']}}};
    expect(p.actionChat(n,'')).toContain('data-box-action="actionexecute"');
    n.action={...n.action,stage:'finished',session:'chat',turns:[{who:'Claude',text:'Saved the report.',completion:{status:'completed',summary:'Saved the report.',evidence:['report.md']}}]};
    const rendered=p.actionChat(n,'');expect(rendered).toContain('Executed');expect(rendered).toContain('View details');expect(rendered).toContain('report.md');expect(rendered).not.toContain('data-box-action="actionexecute"');
  });
});

describe('Action box status pills',()=>{
  it('uses one box name and the same status pill through every stage',()=>{
    const p=panel();
    expect(p.actionStatusPill()).toBe('');expect(p.actionStatusPill({stage:'draft'})).toBe('');
    expect(p.actionChat({id:'new',action:{by:'Duy',stage:'draft'}},'')).not.toContain('action-status-pill');
    for(const [stage,label] of Object.entries({gathering:'Preparing',clarify:'Needs clarity',waiting:'Waiting',ready:'Ready to execute',running:'Executing',error:'Couldn\'t prepare',blocked:'Blocked',sent:'Unconfirmed',unconfirmed:'Unconfirmed'})){
      const action={by:'Duy',stage,question:'Which report?',brief:{goal:'Write',steps:[]},...(['running','blocked'].includes(stage)?{session:'chat',turns:[]}:{} )};
      expect(p.actionStatusPill(action)).toContain(`Action status: ${label}`);
      const rendered=p.actionChat({id:'report',action},'');
      expect(rendered).toContain('Action box');expect(rendered).toContain(`Action status: ${label}`);expect(rendered).not.toContain('Execution box');
    }
  });
  it('marks only confirmed completion green and exposes incomplete outcomes',()=>{
    const p=panel();
    for(const [completion,label] of [[{status:'completed',evidence:['report.md']},'Executed'],[{status:'completed',evidence:[]},'Unconfirmed'],[{status:'needs_input'},'Needs clarity'],[{status:'blocked'},'Blocked'],[undefined,'Unconfirmed']]){
      const pill=p.actionStatusPill({stage:'finished',completion});
      expect(pill).toContain(`Action status: ${label}`);
      expect(pill.includes('data-tone="completed"')).toBe(label==='Executed');
    }
    expect(p.actionStatusPill({stage:'running',completion:{status:'completed',evidence:['old report']}})).toContain('Action status: Executing');
  });
});

describe('Actions made from your words, and Claude\'s own suggestions',()=>{
  const from={kind:'chat',quote:'I\'ll send Dan <the> pricing',at:1};
  it('says a draft was made from your words, with the quote, and offers Not an action and Not mine until it runs',()=>{
    const p=panel(),n={id:'pricing',action:{by:'Duy',id:'r',stage:'ready',from,brief:{goal:'Send it',target:'Dan',result:'Sent',steps:['Send']}}};
    const rendered=p.actionChat(n,'');
    expect(rendered).toContain('Made from your words: <q data-content>I\'ll send Dan &lt;the&gt; pricing</q>');
    expect(rendered).toContain('data-box-action="actionnotaction"');expect(rendered).toContain('data-box-action="actionnotmine" data-action-id="pricing" data-action-to="*"');
    const ran=p.actionChat({...n,action:{...n.action,stage:'finished',session:'s',turns:[]}},'');
    expect(ran).toContain('Made from your words');expect(ran).not.toContain('actionnotaction');
    // someone else sees whose words they were, and no buttons
    const theirs=p.actionChat({...n,action:{...n.action,by:'Priya'}},'');
    expect(theirs).toContain('Made from Priya\'s words');expect(theirs).not.toContain('actionnotmine');
  });
  it('never says Claude\'s suggestion is your words',()=>{
    const p=panel(),plan={goal:'Email Dan',result:'Sent',steps:['Send'],evidence:['Sent mail']};
    expect(p.plannedActionCard({id:'e',proposed:true},plan)).toContain('Claude suggests an Action for you');
    const applied=p.actionChat({id:'e',action:{by:'Duy',stage:'draft',intent:'Email Dan',plan,from:{kind:'suggested',at:1}}},'');
    expect(applied).toContain('Claude suggested this Action.');expect(applied).not.toContain('your words');expect(applied).not.toContain('actionnotaction');
  });
  it('offers Take it on only to the person an item names, or to anyone for the team',()=>{
    const p=panel(),item=(/** @type {string} */ to)=>({id:'c',for:to,task:{goal:'Check the contract'},from:{...from,said:'Ana'}});
    expect(p.actionItemCard(item('Duy'))).toContain('data-box-action="actiontakeon"');expect(p.actionItemCard(item('Duy'))).toContain('Action item for you');
    expect(p.actionItemCard(item('*'))).toContain('Action item for the team');expect(p.actionItemCard(item('*'))).toContain('actiontakeon');
    expect(p.actionItemCard(item('Priya'))).toContain('Action item for Priya');expect(p.actionItemCard(item('Priya'))).not.toContain('actiontakeon');
    expect(p.actionItemCard({id:'c',label:'Plain'})).toBe('');
  });
  it('records in the history that the map prepared it from your words',()=>{
    const p=panel(),rows=p.actionChat({id:'x',action:{by:'Duy',stage:'gathering',from,events:[{what:'created',by:'Duy',at:1,from:'chat'},{what:'preparing',by:'Map',at:2,auto:'words'}]}},'');
    expect(rows).toContain('Prepared automatically, from your words');expect(rows).toContain('Made from your words</b>');
  });
});
