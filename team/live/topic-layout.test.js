import { describe, expect, it } from 'vitest';

import { boxActs } from './box-acts.js';
import { editHistory, editSnapshot } from './editing.js';
import { layoutFor } from './page-layout.js';

const ctx=/** @type {any} */ (layoutFor({W:()=>140,HT:n=>n.h||50}));
/** @type {() => any} */ const fixture=()=>({nodes:[{id:'root',x:-210,y:220},{id:'one',x:0,y:170},...Array.from({length:5},(_,i)=>({id:`one-${i}`,x:210,y:i*85})),{id:'two',x:0,y:468},{id:'a',x:210,y:425},{id:'b',x:210,y:510}],edges:[{from:'root',to:'one'},...Array.from({length:5},(_,i)=>({from:'one',to:`one-${i}`})),{from:'root',to:'two'},{from:'two',to:'a'},{from:'two',to:'b'}]});
const placed=(s,p)=>new Map(s.nodes.map(n=>[n.id,{...n,y:p.moves.find(m=>m.id===n.id)?.y??n.y}]));
describe('keyboard branch insertion',()=>{
  it('appends to its own branch and shifts the following parent and all its children together',()=>{
    const s=fixture(),p=ctx.planTopicInsert(s.nodes,s.edges,'one',null,210),n=placed(s,p);
    expect(p.y).toBe(425);expect(n.get('two').y-s.nodes.find(n=>n.id==='two').y).toBe(85);
    expect(n.get('a').y).toBe(510);expect(n.get('b').y).toBe(595);expect(n.get('root').y).toBe(220);
    for(let i=0;i<5;i++)expect(n.get(`one-${i}`).y).toBe(i*85);
    expect(s.nodes.find(n=>n.id==='a').y).toBe(425);
  });
  it('inserts a sibling after the selected branch and pushes later branches down',()=>{
    const s=fixture(),p=ctx.planTopicInsert(s.nodes,s.edges,'root','one',0),n=placed(s,p);
    expect(p.y).toBe(425);expect(n.get('a').y).toBeGreaterThan(p.y+49);expect(n.get('one-4').y).toBe(340);
  });
  it('leaves the other side of the root and unrelated maps in place',()=>{
    const s=fixture();s.nodes.push({id:'left',x:-420,y:200},{id:'left-child',x:-630,y:220},{id:'free',x:210,y:425});s.edges.push({from:'root',to:'left'},{from:'left',to:'left-child'});
    const p=ctx.planTopicInsert(s.nodes,s.edges,'one',null,210),n=placed(s,p);
    expect(n.get('left').y).toBe(200);expect(n.get('left-child').y).toBe(220);expect(n.get('free').y).toBe(425);
  });
  it('reserves space for tall existing topics and mirrors the same flow to the left',()=>{
    const s=fixture();for(const n of s.nodes)n.x=-n.x;s.nodes.find(n=>n.id==='one-4').h=118;
    const p=ctx.planTopicInsert(s.nodes,s.edges,'one',null,-210),n=placed(s,p);
    expect(p.y).toBe(459);expect(n.get('a').y).toBe(544);expect(p.x).toBe(-210);
  });
  it('keeps cycles and secondary cross-links out of the branch hierarchy',()=>{
    const s=fixture();s.edges.push({from:'b',to:'root'},{from:'one',to:'a'});
    const p=ctx.planTopicInsert(s.nodes,s.edges,'one',null,210);expect(p.y).toBe(425);expect(p.moves.find(n=>n.id==='a').y).toBe(510);
  });
});

describe('closing the space a moved branch leaves',()=>{
  it('brings later siblings and the next branch up by the space it freed',()=>{
    const s=fixture(),n=placed(s,{moves:ctx.planTopicRemove(s.nodes,s.edges,new Set(['one-2']))});
    expect([0,1,3,4].map(i=>n.get(`one-${i}`).y)).toEqual([0,85,170,255]);
    expect(n.get('one').y).toBe(128);expect(n.get('root').y).toBe(220);
    expect([n.get('two').y,n.get('a').y,n.get('b').y]).toEqual([383,340,425]);
  });
  it('keeps space the branch did not free and re-centres a parent on the children it keeps',()=>{
    const s=fixture();for(const id of ['two','a','b'])s.nodes.find(n=>n.id===id).y+=200;
    const n=placed(s,{moves:ctx.planTopicRemove(s.nodes,s.edges,new Set(['one-4']))});
    expect(n.get('one').y).toBe(128);expect(n.get('two').y).toBe(583);
    const t=fixture(),m=placed(t,{moves:ctx.planTopicRemove(t.nodes,t.edges,new Set(['b']))});
    expect(m.get('two').y).toBe(425);expect(m.get('one-4').y).toBe(340);
  });
});

function actions(state, sees='all'){
  return boxActs({getState:()=>state,nodeOf:id=>state.nodes.find(n=>n.id===id),seesOf:()=>sees,sideOf:()=>false,tell(){},pendingProposals:()=>[],unlinkEdge:()=>false,placeProposed(){}});
}
describe('saving branch insertion',()=>{
  it('undoes and redoes the new child and displaced branches together',()=>{
    const s=fixture(), original=editSnapshot(s), p=ctx.planTopicInsert(s.nodes,s.edges,'one',null,210), h=editHistory();
    expect(actions(s).add({label:'Sub-topic',x:p.x,y:p.y,from:'one',by:'Duy',reflow:p.moves})).toBe(true);
    const added=editSnapshot(s);h.record('Duy',original,added);
    expect(s.edges).toContainEqual({from:'one',to:'sub-topic'});expect(s.nodes.find(n=>n.id==='a').y).toBe(510);
    expect(h.apply('Duy','undo',s).ok).toBe(true);expect(editSnapshot(s)).toEqual(original);
    expect(h.apply('Duy','redo',s).ok).toBe(true);expect(editSnapshot(s)).toEqual(added);
  });
  it('rejects a stale branch position without adding or moving anything',()=>{
    const s=fixture(), p=ctx.planTopicInsert(s.nodes,s.edges,'one',null,210);s.nodes.find(n=>n.id==='a').y+=10;
    const before=structuredClone(s);
    expect(actions(s).add({label:'Sub-topic',x:p.x,y:p.y,from:'one',by:'Duy',reflow:p.moves})).toBe(false);
    expect(s).toEqual(before);
  });
  it('rejects shifting a branch outside the person’s area before any mutation',()=>{
    const s=fixture();for(const n of s.nodes)n.area='mine';s.nodes.find(n=>n.id==='a').area='other';
    const p=ctx.planTopicInsert(s.nodes,s.edges,'one',null,210),before=structuredClone(s);
    expect(actions(s,'mine').add({label:'Sub-topic',x:p.x,y:p.y,from:'one',by:'Duy',reflow:p.moves})).toBe(false);
    expect(s).toEqual(before);
  });
});
