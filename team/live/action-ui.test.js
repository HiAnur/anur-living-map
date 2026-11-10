import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { actionExecuted, actionStatus } from './page-action.js';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const esc=s=>String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function panel(){
  const ctx=vm.createContext({ME:'Duy',READ_ONLY:false,FILE:false,PREVIEW:false,esc,md:esc,yours:s=>`<p>${esc(s)}</p>`,claudes:s=>s,attached:()=>'',SEND_ICON:'Send',openSecs:new Set(),nodeById:()=>({label:'Research'}),locked:()=>false});
  Object.assign(ctx, { actionExecuted, actionStatus });
  vm.runInContext(html.slice(html.indexOf('function actionStatusPill('),html.indexOf('async function runBoxAction(')),ctx);
  return ctx;
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
    const p=panel();p.nodeById=()=>({label:'Research',action:{stage:'finished',completion:{status:'completed',evidence:['Saved research']}}});
    const rendered=p.plannedActionCard({id:'report',action:{stage:'draft'}},{goal:'Write report',result:'Saved report',readiness:'waiting',dependsOn:['research']});
    expect(rendered).toContain('Prerequisites completed. Ready for preparation');expect(rendered).toContain('Research · Completed');expect(rendered).not.toContain('Waiting on a dependency');
  });
  it('keeps previous documents downloadable and readable safely in the chat',()=>{
    const p=panel(),content='Original <script>message</script>\nSecond line',file={id:'v1',name:'Action version 1.md',content};
    const rendered=p.actionChat({id:'email',action:{by:'Duy',stage:'clarify',question:'What should change?',documents:[file]}},'');
    expect(rendered).toContain('download="Action version 1.md"');expect(rendered).toContain('View document');expect(rendered).toContain(esc(content));expect(rendered).not.toContain('<script>');
    expect(decodeURIComponent(rendered.match(/href="data:text\/markdown;charset=utf-8,([^"]+)/)[1])).toBe(content);
    p.openSecs.add('action-document:v1');expect(p.actionDocuments({documents:[file]})).toContain('data-open-key="action-document:v1" open');
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
    for(const [stage,label] of Object.entries({gathering:'Preparing',clarify:'Needs clarity',waiting:'Waiting',ready:'Ready to execute',running:'Executing',error:'Blocked',blocked:'Blocked',sent:'Unconfirmed',unconfirmed:'Unconfirmed'})){
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
