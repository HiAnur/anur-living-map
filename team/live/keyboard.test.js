import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { branchIds } from './editing.js';

// Exercise the page's handlers with delayed saves, without requiring a browser in CI.
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('const pendingRemovals ='), html.indexOf('// Map undo leaves'));
function harness(){
  let input, handler;
  const ctx = vm.createContext({ console, Promise, Set, Map });
  const editor = { style: {}, classList: { add(){}, remove(){} }, set innerHTML(v){ if (v) input = { value:'', style:{}, scrollHeight:47, focus(){}, select(){ this.selected = true; }, classList:{add(){},remove(){}}, addEventListener(type, f){ this[type] = f; } }; }, querySelector(){ return input; } };
  const rubber = { innerHTML: '' };
  const controls = {getBoundingClientRect:()=>({top:740,width:300,height:44})};
  Object.assign(ctx, { S:{ nodes:[{id:'root',label:'Root',x:0,y:0}],edges:[] }, LIVE:null, PREVIEW:null, FILE:false, naming:null, view:'system', selected:'root', keyboardSelection:false, group:new Set(), pickedLine:null, delAsk:null, tool:'select', cam:{x:0,y:0,z:1}, folded:new Set(), lastTopics:new Map(), fold:{start:'root'},
    document:{addEventListener(type,f){handler=f;}}, $:id=>id==='newbox'?editor:['tools','foot'].includes(id)?controls:rubber,
    canvas:{getBoundingClientRect:()=>({left:0,top:0,width:1200,height:800})},
    crossLinks:()=>true, routePts:(a,b)=>[[a.x+70,a.y],[b.x-72,b.y]], W:()=>140, HT:()=>50, sideAt:(n,side)=>[n.x+(side==='r'?70:-70),n.y], sideFacing:()=> 'r',
    branchIds, keepInView(){}, render(){}, renderSide(){}, fitPane(){}, place(){}, saveFolds(){}, toast(){},
    setTool(t){ctx.tool=t;}, toStage:(x,y)=>[x,y], locked:n=>!!n.locked,
    nodeById:id=>ctx.S.nodes.find(n=>n.id===id), scope:()=>ctx.S,
    act:async(type,a)=>({ok:true,json:async()=>({id:type==='add'?a.label.toLowerCase():a.id})}),
  });
  vm.runInContext(html.slice(html.indexOf('function fanPts('),html.indexOf('// Lines that enter')),ctx);
  vm.runInContext(source,ctx);
  vm.runInContext(html.slice(html.indexOf('function deleteBox('),html.indexOf("document.addEventListener('keydown'",html.indexOf('function deleteBox('))),ctx);
  const event=(key,extra={})=>({key,target:{closest:()=>false},preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra});
  return {ctx, rubber, input:()=>input, key:(key,extra)=>handler(event(key,extra)), edit:key=>input.keydown(event(key)), type:text=>{input.beforeinput({inputType:'insertText'});input.value=text;input.input();}, blur:()=>input.blur()};
}
describe('keyboard brainstorming',()=>{
  it('keeps each parent centered while deleting back through a long branch',()=>{
    const h=harness();h.ctx.S.nodes=Array.from({length:31},(_,i)=>({id:`n${i}`,label:'Topic',x:i*500,y:i*85}));
    h.ctx.S.edges=Array.from({length:30},(_,i)=>({from:`n${i}`,to:`n${i+1}`}));h.ctx.selected='n30';h.ctx.cam.z=1.5;
    for(let i=30;i>0;i--){
      h.ctx.deleteBox(`n${i}`);expect(h.ctx.selected).toBe(`n${i-1}`);
      const n=h.ctx.nodeById(h.ctx.selected);expect(n.x*h.ctx.cam.z+h.ctx.cam.x).toBe(600);expect(n.y*h.ctx.cam.z+h.ctx.cam.y).toBe(400);expect(h.ctx.cam.z).toBe(1.5);
    }
  });
  it('selects a remaining standalone box and handles deleting the last box',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'other',label:'Other',x:2000,y:1000});h.ctx.deleteBox('root');expect(h.ctx.selected).toBe('other');expect(h.ctx.cam.x).toBe(-1400);
    h.ctx.deleteBox('other');expect(h.ctx.selected).toBeNull();
  });
  it('centers the parent when deleting an empty edited name without restoring the deleted box',async()=>{
    const h=harness();h.ctx.S.nodes.push({id:'child',label:'Child',x:2000,y:1000});h.ctx.S.edges.push({from:'root',to:'child'});h.ctx.selected='child';
    h.key('F2');h.type('');h.edit('Backspace');await new Promise(setImmediate);
    expect(h.ctx.selected).toBe('root');expect(h.ctx.cam.x).toBe(600);expect(h.ctx.cam.y).toBe(400);
  });
  it('brings a draft parent into view even before its saved node arrives',async()=>{
    const h=harness();h.ctx.topicDraft({id:Promise.resolve('pending'),label:'Parent',x:3000,y:1000},true);h.edit('Backspace');await new Promise(setImmediate);
    expect(h.ctx.selected).toBe('pending');expect(h.ctx.cam.x).toBe(-2400);expect(h.ctx.cam.y).toBe(-600);
  });
  it('keeps the full zoomed editor above the toolbar and inside the canvas',()=>{
    const h=harness();h.ctx.cam.z=2.5;h.ctx.askName({x:460,y:300});
    expect(460*2.5+h.ctx.cam.x+175).toBeLessThanOrEqual(1184);
    expect(300*2.5+h.ctx.cam.y+62.5).toBeLessThanOrEqual(724);
    h.ctx.askName({x:-400,y:-300});
    expect(-400*2.5+h.ctx.cam.x-175).toBeGreaterThanOrEqual(16);
    expect(-300*2.5+h.ctx.cam.y-62.5).toBeGreaterThanOrEqual(16);
    expect(h.ctx.cam.z).toBe(2.5);
  });
  it('does not pan an editor already clear of the controls',()=>{
    const h=harness();h.ctx.askName({x:400,y:300});expect(h.ctx.cam).toEqual({x:0,y:0,z:1});
  });
  it('opens a selected Sub-topic and draws its parent arrow before saving',()=>{
    const h=harness();h.key('Tab');expect(h.input().value).toBe('Sub-topic');expect(h.ctx.naming.untouched).toBe(true);expect(h.rubber.innerHTML).toContain('marker-end');expect(h.ctx.naming.link.id).toBe('root');
  });
  it('cancels untouched drafts only with Delete, Backspace or Escape',async()=>{
    for (const key of ['Backspace','Delete','Escape']){
      const h=harness(), calls=[];h.ctx.act=(...args)=>calls.push(args);h.key('Tab');
      if(key==='blur') h.blur();else h.edit(key);
      await Promise.resolve();expect(h.ctx.naming).toBeNull();expect(h.ctx.selected).toBe('root');expect(calls).toEqual([]);expect(h.rubber.innerHTML).toBe('');
    }
  });
  it('repeated Tab accepts default names and chains children before saves finish',async()=>{
    const h=harness(), calls=[];let release;const gate=new Promise(resolve=>{release=resolve;});
    h.ctx.act=async(type,args)=>{const id=`topic-${calls.length+1}`;calls.push([type,args]);await gate;return {ok:true,json:async()=>({id})};};
    h.key('Tab');h.edit('Tab');h.edit('Tab');h.edit('Tab');
    expect(h.ctx.naming.untouched).toBe(true);expect(h.input().value).toBe('Sub-topic');
    release();expect(await h.ctx.naming.link.id).toBe('topic-3');
    expect(calls.map(([,args])=>args.from)).toEqual(['root','topic-1','topic-2']);
    expect(calls.every(([,args])=>args.label==='Sub-topic')).toBe(true);
    h.edit('Backspace');await new Promise(setImmediate);expect(h.ctx.selected).toBe('topic-3');
  });
  it('Enter accepts an untouched draft and opens its sibling',async()=>{
    const h=harness(), calls=[];h.ctx.act=async(type,args)=>{calls.push([type,args]);return {ok:true,json:async()=>({id:'child'})};};
    h.key('Tab');h.edit('Enter');expect(h.ctx.naming.link.id).toBe('root');expect(h.ctx.naming.untouched).toBe(true);
    await h.ctx.naming.returnTo;expect(calls[0][1].from).toBe('root');
  });
  it('arrows keep an untouched topic and return to its actual parent',async()=>{
    const h=harness(), calls=[];h.ctx.act=async(type,args)=>{calls.push([type,args]);return {ok:true,json:async()=>({id:'saved'})};};
    h.ctx.S.nodes.push({id:'unrelated',label:'Other',x:0,y:85});h.key('Tab');h.edit('ArrowLeft');
    await new Promise(setImmediate);expect(h.ctx.naming).toBeNull();expect(h.ctx.selected).toBe('root');expect(calls[0][1].label).toBe('Sub-topic');
  });
  it('keeps the final topic after rapid Tab presses and clicking elsewhere',async()=>{
    const h=harness(), calls=[];let release;const gate=new Promise(resolve=>{release=resolve;});
    h.ctx.act=async(type,args)=>{const id=`topic-${calls.length+1}`;calls.push([type,args]);await gate;return {ok:true,json:async()=>({id})};};
    h.key('Tab');h.edit('Tab');h.edit('Tab');h.blur();h.ctx.selected='clicked';release();await new Promise(setImmediate);
    expect(calls.map(([,a])=>a.from)).toEqual(['root','topic-1','topic-2']);expect(h.ctx.selected).toBe('clicked');
  });
  it('back to a parent then Tab adds another child without overlapping an unfinished save',async()=>{
    const h=harness(), calls=[];let release;const gate=new Promise(resolve=>{release=resolve;});
    h.ctx.act=async(type,args)=>{calls.push([type,args]);await gate;return {ok:true,json:async()=>({id:'first-child'})};};
    h.key('Tab');const first={...h.ctx.naming};h.edit('ArrowLeft');await Promise.resolve();h.key('Tab');
    expect(h.ctx.naming.link.id).toBe('root');expect(h.ctx.naming.x).toBe(first.x);expect(h.ctx.naming.y).toBeGreaterThan(first.y);
    release();await new Promise(setImmediate);expect(h.ctx.naming).not.toBeNull();expect(calls[0][1].from).toBe('root');
  });
  it('arrows preserve the text editor once typing starts',()=>{
    const h=harness();h.key('Tab');h.type('Typed');const draft=h.ctx.naming;h.edit('ArrowLeft');expect(h.ctx.naming).toBe(draft);expect(h.input().value).toBe('Typed');
  });
  it('saves only entered names and discards names erased before saving',async()=>{
    const h=harness(), calls=[];h.ctx.act=async(type,args)=>{calls.push([type,args]);return {ok:true,json:async()=>({id:'typed'})};};
    h.key('Tab');h.type('Sub-topic');h.blur();await Promise.resolve();await Promise.resolve();expect(calls[0][1].label).toBe('Sub-topic');
    const empty=harness();empty.ctx.act=(...args)=>calls.push(args);empty.key('r');empty.type('');empty.blur();expect(calls).toHaveLength(1);
  });
  it('uses the saved branch stem for the new topic preview',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'child',label:'Child',x:210,y:0});h.ctx.S.edges.push({from:'root',to:'child'});h.key('Tab');
    expect(h.rubber.innerHTML).toContain('M70 0L84 0L84 85L138 85');
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
    const h=harness();h.key('Tab');h.type('Child');h.edit('Tab');expect(h.input().value).toBe('Sub-topic');expect(await h.ctx.naming.link.id).toBe('child');expect(h.rubber.innerHTML).toContain('marker-end');
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
