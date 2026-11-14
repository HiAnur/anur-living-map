import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf("const pick = (n) =>"),html.indexOf("canvas.addEventListener('pointerleave'"));
function harness(){
  let up, pending;const edits=[],opened=[];
  const ctx=vm.createContext({
    canvas:{addEventListener(type,handler){up=handler;}},drawing:null,marquee:null,drag:null,panning:null,moved:false,PREVIEW:null,READ_ONLY:false,FILE:false,
    lastTap:{id:null,at:0},DBL:320,tapTimer:null,nameSession:0,naming:null,clearTimeout(){pending=null;},setTimeout(fn){pending=fn;return 1;},Date,selected:null,render(){},keepInView(){},
    locked:n=>!!n.locked,diagramChange:()=>false,hubbed:()=>false,LEVEL_CENTRE:"@centre",
    askName:at=>edits.push(at),enter:id=>opened.push(id),openDiagram:id=>opened.push(id),
  });
  ctx.$=()=>({classList:{contains:()=>false}});
  ctx.renderPickedBox=()=>{};
  vm.runInContext(source,ctx);
  return {ctx,edits,opened,click:(n,proposed=false)=>{ctx.drag={n,proposed};up({});}};
}
describe('double click topic editing',()=>{
  const node={id:'child',label:'Sub-topic',x:210,y:0};
  it('does not reuse a finished double click when the next click arrives quickly',()=>{
    const h=harness();h.click(node);h.click(node);expect(h.edits).toHaveLength(1);
    h.click(node);expect(h.edits).toHaveLength(1);
  });
  it('opens the existing name for replacement on the second click',()=>{
    const h=harness();h.click(node);expect(h.edits).toEqual([]);expect(h.ctx.selected).toBe('child');h.click(node);
    expect(h.edits).toEqual([{x:210,y:0,edit:'child',field:'label',text:'Sub-topic'}]);expect(h.ctx.drag).toBeNull();
  });
  it('edits a proposed box before applying it',()=>{
    const h=harness();h.click(node,true);h.click(node,true);expect(h.edits).toEqual([{x:210,y:0,edit:'child',field:'label',text:'Sub-topic',proposed:true}]);
  });
  it('preserves double click navigation for boxes containing maps',()=>{
    const h=harness();const n={...node,inside:{}};h.click(n);h.click(n);expect(h.opened).toEqual(['child']);expect(h.edits).toEqual([]);
  });
  it('does not rename locked boxes, history, files or two different boxes',()=>{
    for(const mode of ['locked','history','file','different']){
      const h=harness(),n={...node,locked:mode==='locked'};h.ctx.PREVIEW=mode==='history';h.ctx.FILE=mode==='file';
      h.click(n);h.click(mode==='different'?{...n,id:'other'}:n);expect(h.edits).toEqual([]);
    }
  });
});

// Exercise down/move/up together: trackpad jitter must still reach the click path.
function pointerHarness({zoom=1,proposed=false,many=false}={}){
  const h=harness(),handlers={},calls=[],renders=[],node={id:'child',label:'Child',x:210,y:0};
  Object.assign(h.ctx,{
    tool:'select',view:'flow:test',group:new Set(many?['child','sibling']:[]),spaceDown:false,
    nodeById:()=>node,proposedBox:()=>node,toStage:(x,y)=>[x/zoom,y/zoom],
    render:()=>renders.push('render'),act:(...args)=>calls.push(args),
    moveTopicDrag(){h.ctx.moved=true;renders.push('drag');},
    canvas:{addEventListener(type,handler){handlers[type]=handler;},setPointerCapture(){}},
  });
  vm.runInContext(html.slice(html.indexOf("canvas.addEventListener('pointerdown'"),html.indexOf('// Recognize double clicks')),h.ctx);
  vm.runInContext(html.slice(html.indexOf("canvas.addEventListener('pointerup'"),html.indexOf("canvas.addEventListener('pointerleave'")),h.ctx);
  const box={dataset:{id:'child'},classList:{contains:()=>proposed}};
  const target={closest:selector=>selector==='.node'?box:null};
  const event=(x,y)=>({clientX:x,clientY:y,button:0,pointerId:1,target});
  handlers.pointerdown(event(100,100));
  return {...h,calls,renders,move:(x,y)=>handlers.pointermove(event(x,y)),up:()=>handlers.pointerup(event(100,100))};
}
describe('click movement tolerance',()=>{
  it('selects after small pointer movements without drawing a drag or saving positions',()=>{
    for(const zoom of [.3,1,2.5])for(const proposed of [false,true])for(const many of [false,true]){
      const h=pointerHarness({zoom,proposed,many});
      h.move(100,100);h.move(102,102);h.move(104,100);h.up();
      expect(h.ctx.selected).toBe('child');expect(h.ctx.moved).toBe(false);
      expect(h.renders).toEqual([]);expect(h.calls).toEqual([]);
    }
  });
  it('starts a drag beyond four screen pixels and keeps dragging when the pointer returns',()=>{
    for(const zoom of [.3,1,2.5]){
      const h=pointerHarness({zoom});h.move(105,100);h.move(101,100);
      expect(h.ctx.moved).toBe(true);expect(h.renders).toEqual(['drag','drag']);
    }
  });
});
