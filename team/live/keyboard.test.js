import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

// Exercise the page's handlers with delayed saves, without requiring a browser in CI.
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('const pendingRemovals ='), html.indexOf('/* pan, zoom, drag */'));
function harness(){
  let input, handler;
  const ctx = vm.createContext({ console, Promise, Set, Map });
  const editor = { style: {}, classList: { add(){}, remove(){} }, set innerHTML(v){ if (v) input = { value:'', focus(){}, select(){ this.selected = true; }, addEventListener(type, f){ if(type === 'keydown') this.key = f; } }; }, querySelector(){ return input; } };
  const rubber = { innerHTML: '' };
  Object.assign(ctx, { S:{ nodes:[{id:'root',label:'Root',x:0,y:0}],edges:[] }, LIVE:null, PREVIEW:null, FILE:false, naming:null, view:'system', selected:'root', keyboardSelection:false, group:new Set(), pickedLine:null, delAsk:null, tool:'select', cam:{x:0,y:0,z:1}, folded:new Set(), lastTopics:new Map(), fold:{start:'root'},
    document:{addEventListener(type,f){handler=f;}}, $:id=>id==='newbox'?editor:rubber,
    canvas:{getBoundingClientRect:()=>({left:0,top:0,width:1200,height:800})},
    W:()=>140, HT:()=>50, sideAt:(n,side)=>[n.x+(side==='r'?70:-70),n.y], sideFacing:()=> 'r',
    render(){}, renderSide(){}, fitPane(){}, place(){}, saveFolds(){}, toast(){},
    setTool(t){ctx.tool=t;}, toStage:(x,y)=>[x,y], locked:n=>!!n.locked,
    nodeById:id=>ctx.S.nodes.find(n=>n.id===id), scope:()=>ctx.S,
    act:async(type,a)=>({ok:true,json:async()=>({id:type==='add'?a.label.toLowerCase():a.id})}),
  });
  vm.runInContext(source,ctx);
  const event=(key,extra={})=>({key,target:{closest:()=>false},preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra});
  return {ctx, rubber, input:()=>input, key:(key,extra)=>handler(event(key,extra)), edit:key=>input.key(event(key))};
}
describe('keyboard brainstorming',()=>{
  it('opens a selected Sub-topic and draws its parent arrow before saving',()=>{
    const h=harness();h.key('Tab');expect(h.input().value).toBe('Sub-topic');expect(h.input().selected).toBe(true);expect(h.rubber.innerHTML).toContain('marker-end');expect(h.ctx.naming.link.id).toBe('root');
  });
  it('R makes an unconnected editable Topic even with a box selected',()=>{
    const h=harness();h.key('r');expect(h.input().value).toBe('Topic');expect(h.ctx.naming.link).toBeUndefined();expect(h.ctx.naming.edit).toBeUndefined();
  });
  it('keeps tool letters and text fields out of rename handling',()=>{
    const h=harness();h.key('c');expect(h.ctx.naming).toBeNull();h.key('r',{target:{closest:()=>true}});expect(h.ctx.naming).toBeNull();h.key('Tab',{isComposing:true});expect(h.ctx.naming).toBeNull();
  });
  it('F2 selects the existing name and Escape preserves it',async()=>{
    const h=harness();h.key('F2');expect(h.input().value).toBe('Root');h.input().value='Changed';h.edit('Escape');await Promise.resolve();expect(h.ctx.S.nodes[0].label).toBe('Root');expect(h.ctx.selected).toBe('root');
  });
  it('chains child creation to the saved parent id without waiting to type',async()=>{
    const h=harness();h.key('Tab');h.input().value='Child';h.edit('Tab');expect(h.input().value).toBe('Sub-topic');expect(await h.ctx.naming.link.id).toBe('child');expect(h.rubber.innerHTML).toContain('marker-end');
  });
  it('Enter makes a sibling using the same parent',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'child',label:'Child',x:210,y:0});h.ctx.S.edges.push({from:'root',to:'child'});h.ctx.selected='child';h.key('Enter');expect(h.ctx.naming.link.id).toBe('root');
  });
  it('arrows skip locked nodes and keep the details panel closed',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'locked',x:100,y:0,locked:true},{id:'next',x:210,y:0});h.key('ArrowRight');expect(h.ctx.selected).toBe('next');expect(h.ctx.keyboardSelection).toBe(true);
  });
  it('Tab with no selection uses the last topic instead of focusing Legend',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'last',label:'Last',x:210,y:0});h.ctx.selected=null;h.ctx.lastTopics.set('system','last');h.key('Tab');expect(h.ctx.naming.link.id).toBe('last');
  });
  it('Tab on a fresh map selects the root and empty maps open Topic',()=>{
    const h=harness();h.ctx.selected=null;h.key('Tab');expect(h.ctx.naming.link.id).toBe('root');
    const empty=harness();empty.ctx.selected=null;empty.ctx.S.nodes=[];empty.key('Tab');expect(empty.input().value).toBe('Topic');
  });
  it('does not edit history or saved-file previews',()=>{
    const h=harness();h.ctx.PREVIEW={};h.key('r');expect(h.ctx.naming).toBeNull();h.ctx.PREVIEW=null;h.ctx.FILE=true;h.key('Tab');expect(h.ctx.naming).toBeNull();
  });
});
