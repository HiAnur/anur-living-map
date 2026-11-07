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
  const rubber = {innerHTML:''}, ctx=vm.createContext({Set,Map,Math,branchIds,W:n=>n.w||140,HT:n=>n.h||50,
    esc:s=>s,S:state,PREVIEW:null,FILE:false,cam:{z:1},$ :()=>rubber,scope:()=>state,nodeById:id=>state.nodes.find(n=>n.id===id),locked:n=>!!n.locked,
    fanPts:()=>null,routePts:(a,b)=>[[a.x+70,a.y],[b.x-70,b.y]],render(){},canvas:{addEventListener(){}},document:{addEventListener(){}}
  });
  vm.runInContext(html.slice(html.indexOf('function planTopicInsert('),html.indexOf('function topicGraph(')),ctx);
  vm.runInContext(html.slice(html.indexOf('function planTopicAttach('),html.indexOf('// drag on empty map draws')),ctx);
  ctx.drag={dx:0,dy:0,n:state.nodes.find(n=>n.id==='branch'),source:structuredClone(state)};
  return {ctx,rubber,state,plan:()=>ctx.planTopicAttach(ctx.drag.source,'branch','new',1)};
}
describe('drag attachment preview',()=>{
  it('previews several selected branches without moving originals or detaching a selected child',()=>{
    const h=page(),before=structuredClone(h.state);
    h.ctx.drag.many=['branch','child','lower'].map(id=>({n:h.ctx.nodeById(id)}));
    expect(h.ctx.topicDragRoots(h.ctx.drag)).toEqual(['branch','lower']);
    h.ctx.moveTopicDrag(240,170);expect(h.state).toEqual(before);
    expect(h.ctx.drag.attach.ids).toEqual(['branch','lower']);
    expect(h.rubber.innerHTML.match(/class="attach-box"/g)).toHaveLength(2);
    const history=editHistory(),old=editSnapshot(h.state);
    expect(reparentTopic(h.state,h.ctx.drag.attach)).toBe(true);
    expect(h.state.edges).toContainEqual({from:'new',to:'branch'});expect(h.state.edges).toContainEqual({from:'new',to:'lower'});
    expect(h.state.edges).toContainEqual({from:'branch',to:'child'});expect(h.state.edges).not.toContainEqual({from:'new',to:'child'});
    const after=editSnapshot(h.state);history.record('Duy',old,after);expect(history.apply('Duy','undo',h.state).ok).toBe(true);
    expect(h.state.nodes).toEqual(old.nodes);expect(h.state.edges).toEqual(expect.arrayContaining(old.edges));
    expect(history.apply('Duy','redo',h.state).ok).toBe(true);expect(h.state.nodes).toEqual(after.nodes);
  });
  it('cancels a multi-selection and refuses targets inside any selected branch',()=>{
    const h=page(),before=structuredClone(h.state);h.ctx.drag.many=['branch','lower'].map(id=>({n:h.ctx.nodeById(id)}));
    h.ctx.moveTopicDrag(420,255);expect(h.ctx.drag.attach).toBeNull();h.ctx.cancelTopicDrag();expect(h.state).toEqual(before);expect(h.rubber.innerHTML).toBe('');
  });
  it('rejects the entire grouped attachment if one branch changed or became inaccessible',()=>{
    for(const denied of [false,true]){
      const h=page(),plan=h.ctx.planGroupAttach(h.state,['branch','lower'],'new',1);
      if(!denied)h.ctx.nodeById('lower-child').y++;
      const before=structuredClone(h.state);expect(reparentTopic(h.state,plan,n=>!denied||n.id!=='lower-child')).toBe(false);expect(h.state).toEqual(before);
    }
  });
  it('keeps every original box and line still while only the ghost follows the pointer',()=>{
    const h=page(),before=structuredClone(h.state);
    h.ctx.moveTopicDrag(240,170);
    expect(h.state).toEqual(before);expect(h.ctx.drag.at).toEqual({x:240,y:170});expect(h.ctx.drag.attach.parent).toBe('new');
    expect(h.rubber.innerHTML).toContain('class="drag-source"');expect(h.rubber.innerHTML).toContain('class="drag-ghost"');expect(h.rubber.innerHTML).toContain('class="attach-box"');
    expect(h.rubber.innerHTML.match(/class="drag-ghost-box"/g)).toHaveLength(2);expect(h.rubber.innerHTML).toContain('class="drag-ghost-label"');
    h.ctx.moveTopicDrag(1100,900);expect(h.state).toEqual(before);expect(h.ctx.drag.attach).toBeNull();
    h.ctx.cancelTopicDrag();expect(h.state).toEqual(before);expect(h.rubber.innerHTML).toBe('');
  });
  it('shows a green parent and landing box, then clears them away from a target',()=>{
    const h=page();h.ctx.previewTopicAttach(240,170);
    expect(h.ctx.drag.attach.parent).toBe('new');expect(h.rubber.innerHTML).toContain('class="attach-target"');expect(h.rubber.innerHTML).toContain('class="attach-box"');
    h.ctx.previewTopicAttach(1200,1000);expect(h.ctx.drag.attach).toBeNull();expect(h.rubber.innerHTML).not.toContain('attach-box');
  });
  it('never offers itself, its descendants, its current parent or a locked target',()=>{
    const h=page();
    for(const id of ['branch','child','old']){const n=h.ctx.nodeById(id);h.ctx.previewTopicAttach(n.x,n.y);expect(h.ctx.drag.attach).toBeNull();}
    h.ctx.nodeById('new').locked=true;h.ctx.previewTopicAttach(240,170);expect(h.ctx.drag.attach).toBeNull();
  });
  it('cancels the drag without saving or leaving a green preview',()=>{
    const h=page();h.ctx.moveTopicDrag(240,170);h.ctx.cancelTopicDrag();
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

describe('clear topic landings',()=>{
  const landed = (state,moves) => state.nodes.map(n=>({...n,...moves.find(m=>m.id===n.id)}));
  const expectClear = (state,moves) => {
    const nodes=landed(state,moves),ids=new Set(moves.map(m=>m.id));
    for(const a of nodes)for(const b of nodes){
      if(a.id===b.id || (!ids.has(a.id)&&!ids.has(b.id)))continue;
      expect(Math.abs(a.x-b.x)>=(a.w||140)/2+(b.w||140)/2+16 || Math.abs(a.y-b.y)>=(a.h||50)/2+(b.h||50)/2+16,`${a.id} overlaps ${b.id}`).toBe(true);
    }
  };
  it('keeps a free drop beside its current parent clear and carries its child together',()=>{
    const h=page(),before=structuredClone(h.state);
    h.ctx.moveTopicDrag(210,0);
    expect(h.ctx.drag.attach).toBeNull();
    const moves=h.ctx.drag.freeMoves;expectClear(h.state,moves);
    expect(moves.find(m=>m.id==='child').x-moves.find(m=>m.id==='branch').x).toBe(210);
    expect(moves.find(m=>m.id==='child').y).toBe(moves.find(m=>m.id==='branch').y);
    expect(h.state).toEqual(before);
  });
  it('checks the full group against wide, tall obstacles and finds the nearest clear gap',()=>{
    const state={nodes:[{id:'a',x:0,y:0},{id:'b',x:210,y:85},{id:'obstacle',x:500,y:220,w:300,h:120}],edges:[]},h=page(state);
    const moves=[{id:'a',fromX:0,fromY:0,x:400,y:210},{id:'b',fromX:210,fromY:85,x:610,y:295}];
    const clear=h.ctx.clearTopicLanding(state,moves);expectClear(state,clear);
    expect(clear[1].y-clear[0].y).toBe(85);expect(clear[0].x).toBe(400);
    expect(clear[0].y).toBe(321);
  });
  it('does not overlap a disconnected box when attaching a branch',()=>{
    const h=page();h.ctx.drag.source.nodes.push({id:'obstacle',label:'Wide box',x:470,y:255,w:240,h:80});
    const plan=h.plan();expectClear(h.ctx.drag.source,plan.moves);
  });
  it('leaves already clear drops unchanged and refuses moving a protected descendant',()=>{
    const h=page();h.ctx.moveTopicDrag(1000,1000);expect(h.ctx.drag.freeMoves.find(m=>m.id==='branch')).toMatchObject({x:1000,y:1000});
    h.ctx.nodeById('child').locked=true;h.ctx.moveTopicDrag(1000,1000);expect(h.ctx.drag.freeMoves).toBeNull();
  });
});
