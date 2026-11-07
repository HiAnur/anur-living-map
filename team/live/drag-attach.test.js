import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { branchIds, editHistory, editSnapshot, reparentTopic } from './editing.js';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const fixture = () => ({nodes:[
  {id:'root',label:'Root',x:0,y:0}, {id:'old',label:'Old parent',x:210,y:0},
  {id:'branch',label:'Moving branch',x:420,y:0}, {id:'child',label:'Child',x:630,y:0},
  {id:'new',label:'New parent',x:210,y:170}, {id:'existing',label:'Existing child',x:420,y:170},
  {id:'lower',label:'Lower branch',x:210,y:255}, {id:'lower-child',label:'Lower child',x:420,y:255},
],edges:[{from:'root',to:'old'},{from:'old',to:'branch'},{from:'branch',to:'child'},{from:'root',to:'new'},{from:'new',to:'existing'},{from:'root',to:'lower'},{from:'lower',to:'lower-child'}]});
function page(state = fixture()) {
  const rubber = {innerHTML:''}, ctx=vm.createContext({Set,Map,Math,branchIds,W:()=>140,HT:()=>50,
    S:state,PREVIEW:null,READ_ONLY:false,FILE:false,cam:{z:1},$ :()=>rubber,scope:()=>state,nodeById:id=>state.nodes.find(n=>n.id===id),locked:n=>!!n.locked,
    fanPts:()=>null,routePts:(a,b)=>[[a.x+70,a.y],[b.x-70,b.y]],render(){},canvas:{addEventListener(){}},document:{addEventListener(){}}
  });
  vm.runInContext(html.slice(html.indexOf('function planTopicInsert('),html.indexOf('function topicGraph(')),ctx);
  vm.runInContext(html.slice(html.indexOf('function planTopicAttach('),html.indexOf('// drag on empty map draws')),ctx);
  ctx.drag={n:state.nodes.find(n=>n.id==='branch'),source:structuredClone(state)};
  return {ctx,rubber,state,plan:()=>ctx.planTopicAttach(ctx.drag.source,'branch','new',1)};
}
describe('drag attachment preview',()=>{
  it('shows a green parent and landing box, then clears them away from a target',()=>{
    const h=page();h.ctx.previewTopicAttach(240,170);
    expect(h.ctx.drag.attach.parent).toBe('new');expect(h.rubber.innerHTML).toContain('class="attach-target"');expect(h.rubber.innerHTML).toContain('class="attach-box"');
    h.ctx.previewTopicAttach(1200,1000);expect(h.ctx.drag.attach).toBeNull();expect(h.rubber.innerHTML).toBe('');
  });
  it('never offers itself, its descendants, its current parent or a locked target',()=>{
    const h=page();
    for(const id of ['branch','child','old']){const n=h.ctx.nodeById(id);h.ctx.previewTopicAttach(n.x,n.y);expect(h.ctx.drag.attach).toBeNull();}
    h.ctx.nodeById('new').locked=true;h.ctx.previewTopicAttach(240,170);expect(h.ctx.drag.attach).toBeNull();
  });
  it('cancels the drag without saving or leaving a green preview',()=>{
    const h=page();h.ctx.drag.n.x=300;h.ctx.drag.n.y=190;h.ctx.previewTopicAttach(240,170);h.ctx.cancelTopicDrag();
    expect(h.ctx.nodeById('branch')).toMatchObject({x:420,y:0});expect(h.ctx.drag).toBeNull();expect(h.rubber.innerHTML).toBe('');
  });
  it('reserves the whole moved branch and shifts the following branch together',()=>{
    const h=page();h.ctx.drag.source.nodes.find(n=>n.id==='child').y=85;
    const p=h.plan(),at=id=>p.moves.find(m=>m.id===id)||h.ctx.nodeById(id);
    expect(at('branch').y).toBe(256);expect(at('child').y).toBe(341);
    expect(at('lower').y).toBe(425);expect(at('lower-child').y).toBe(425);expect(at('existing').y).toBe(170);
  });
  it('turns descendants outward when attaching on the left',()=>{
    const h=page(),p=h.ctx.planTopicAttach(h.ctx.drag.source,'branch','new',-1);
    expect(p.moves.find(m=>m.id==='branch').x).toBe(0);expect(p.moves.find(m=>m.id==='child').x).toBe(-210);
  });
});
describe('saving an attachment',()=>{
  it('moves the branch, replaces the old parent and undoes everything together',()=>{
    const h=page(),before=editSnapshot(h.state),history=editHistory(),a={id:'branch',...h.plan()};
    expect(reparentTopic(h.state,a)).toBe(true);
    expect(h.state.edges).not.toContainEqual({from:'old',to:'branch'});expect(h.state.edges).toContainEqual({from:'new',to:'branch'});expect(h.state.edges).toContainEqual({from:'branch',to:'child'});
    const saved=editSnapshot(h.state);history.record('Duy',before,saved);
    expect(history.apply('Duy','undo',h.state).ok).toBe(true);expect(h.state.nodes).toEqual(before.nodes);expect(h.state.edges).toEqual(expect.arrayContaining(before.edges));expect(h.state.edges).toHaveLength(before.edges.length);
    expect(history.apply('Duy','redo',h.state).ok).toBe(true);expect(editSnapshot(h.state)).toEqual(saved);
  });
  it('refuses cycles, stale positions, changed parents and incomplete branch moves atomically',()=>{
    for(const change of [
      (h,a)=>{a.parent='child';},
      h=>{h.ctx.nodeById('lower').y++;},
      h=>{h.state.edges.find(e=>e.to==='branch').from='new';},
      (h,a)=>{a.moves=a.moves.filter(m=>m.id!=='child');},
    ]){
      const h=page(),a={id:'branch',...h.plan()};change(h,a);const before=structuredClone(h.state);
      expect(reparentTopic(h.state,a)).toBe(false);expect(h.state).toEqual(before);
    }
  });
  it('refuses moving a protected child or displacing another person’s box',()=>{
    for(const denied of ['child','lower','new','old']){
      const h=page(),before=structuredClone(h.state);
      expect(reparentTopic(h.state,{id:'branch',...h.plan()},n=>n.id!==denied)).toBe(false);expect(h.state).toEqual(before);
    }
  });
  it('uses the requested nested map without connecting across views',()=>{
    const h=page(),inner=h.state,state={nodes:[{id:'container',inside:inner},{id:'outside',x:0,y:0}],edges:[]};
    expect(reparentTopic(state,{id:'branch',view:'container',...h.plan()})).toBe(true);
    expect(inner.edges).toContainEqual({from:'new',to:'branch'});expect(state.edges).toEqual([]);
    expect(reparentTopic(state,{id:'branch',view:'container',...h.plan(),parent:'outside'})).toBe(false);
  });
});
