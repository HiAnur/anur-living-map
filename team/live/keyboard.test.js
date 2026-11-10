import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { branchIds } from './editing.js';
import { actionExecuted, actionLeaving } from './page-action.js';
import { layoutFor } from './page-layout.js';

// Exercise the page's handlers with delayed saves, without requiring a browser in CI.
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('const pendingRemovals ='), html.indexOf('// Tidy shortcut'));
const livePreviewStart = html.indexOf('    if (!PREVIEW)', html.indexOf('    LIVE = next;'));
const livePreview = html.slice(livePreviewStart, html.indexOf('    render();', livePreviewStart));
function harness(){
  let input, handler, pickTimer;
  const ctx = vm.createContext({ console, Promise, Set, Map, actionLeaving, actionExecuted, ME: 'Ana' });
  const editor = { style: {}, classList: { add(){}, remove(){}, toggle(){} }, set innerHTML(v){ if (v) input = { value:'', style:{}, scrollHeight:47, focus(options){ this.focusOptions = options; }, select(){ this.selected = true; }, classList:{add(){},remove(){}}, addEventListener(type, f){ this[type] = f; } }; }, querySelector(){ return input; } };
  const rubber = { innerHTML: '', classList:{contains:()=>false} };
  const controls = {getBoundingClientRect:()=>({top:740,width:300,height:44})};
  Object.assign(ctx, { S:{ nodes:[{id:'root',label:'Root',x:0,y:0}],edges:[] }, LIVE:null, PREVIEW:null,READ_ONLY:false, FILE:false, naming:null, lastTap:{id:null,at:0}, diagramChange:()=>null, view:'system', selected:'root', keyboardSelection:false, group:new Set(), pickedLine:null, delAsk:null, tool:'select', cam:{x:0,y:0,z:1}, folded:new Set(), lastTopics:new Map(), fold:{start:'root'},
    document:{addEventListener(type,f){handler=f;}}, $:id=>id==='newbox'?editor:['tools','foot'].includes(id)?controls:rubber,
    setTimeout(fn){pickTimer=fn;return 1;},clearTimeout(){pickTimer=null;},
    canvas:{getBoundingClientRect:()=>({left:0,top:0,width:1200,height:800})},
    crossLinks:()=>true, routePts:(a,b)=>[[a.x+70,a.y],[b.x-72,b.y]], W:()=>140, HT:()=>50, sideAt:(n,side)=>[n.x+(side==='r'?70:-70),n.y], sideFacing:()=> 'r',
    lit:null,nodesEl:{querySelectorAll:()=>[]},branchIds, keepInView(){}, render(){}, renderSide(){},renderChat(){},renderDecs(){},renderHist(){},renderMem(){},renderComments(){}, fitPane(){}, place(){}, saveFolds(){}, toast(){},
    setTool(t){ctx.tool=t;}, toStage:(x,y)=>[x,y], locked:n=>!!n.locked,
    nodeById:id=>ctx.S.nodes.find(n=>n.id===id), scope:()=>ctx.S,
    act:async(type,a)=>({ok:true,json:async()=>({id:type==='add'?a.label.toLowerCase():a.id})}),
  });
  ctx.canvas.querySelectorAll=()=>[];
  // the page's sizes, looked up each time, so a test that changes them changes what the layout sees
  Object.assign(ctx, layoutFor({ W:(n)=>ctx.W(n), HT:(n)=>ctx.HT(n) }));
  vm.runInContext(source,ctx);
  vm.runInContext(html.slice(html.indexOf('const DBL ='),html.indexOf("canvas.addEventListener('pointerup'")),ctx);
  vm.runInContext(html.slice(html.indexOf('function deleteBox('),html.indexOf("document.addEventListener('keydown'",html.indexOf('function deleteBox('))),ctx);
  /** @type {(key: any, extra?: any) => any} */ const event=(key,extra={})=>({key,target:{closest:()=>false},preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra});
  return {ctx, rubber, input:()=>input, key:(key,extra)=>handler(event(key,extra)), edit:key=>input.keydown(event(key)), type:text=>{input.beforeinput({inputType:'insertText'});input.value=text;input.input();}, blur:()=>input.blur(),pick:id=>vm.runInContext('pick',ctx)(ctx.nodeById(id)),flushPick:()=>{const fn=pickTimer;pickTimer=null;fn?.();}};
}
describe('keyboard brainstorming',()=>{
  it('keeps an open details pane visible when clicking the selected box or another box',()=>{
    const h=harness(),frames=[];h.rubber.classList.contains=()=>true;
    h.ctx.S.nodes.push({id:'rivals',label:'Rivals',x:300,y:0});
    const paint=h.ctx.renderPickedBox;h.ctx.renderPickedBox=(details)=>{frames.push(h.ctx.keyboardSelection);paint(details);};
    h.pick('root');h.flushPick();h.pick('rivals');h.flushPick();
    expect(frames).toEqual([false,false]);expect(h.ctx.selected).toBe('rivals');
    h.key('Tab');expect(h.ctx.naming.link.id).toBe('rivals');
  });
  it('selects and opens a box on the first click without redrawing the map',()=>{
    const h=harness(),panels=[];h.ctx.render=()=>{throw Error('Full map redraw during selection');};
    h.ctx.renderSide=()=>panels.push(h.ctx.selected);
    h.pick('root');expect(h.ctx.selected).toBe('root');expect(panels).toEqual([]);
    h.flushPick();expect(panels).toEqual(['root']);expect(h.ctx.keyboardSelection).toBe(false);
  });
  it('does not create, rename, or delete topics through a view link',()=>{
    const h=harness();h.ctx.READ_ONLY=true;h.ctx.VIEW_SAYS='View only';
    for(const key of ['Tab','Enter','F2','x']) h.key(key);
    expect(h.ctx.naming).toBeNull();
    h.ctx.deleteBox('root');expect(h.ctx.S.nodes.map(n=>n.id)).toEqual(['root']);
  });
  it('branches from the clicked topic immediately, before the double-click delay expires',async()=>{
    const h=harness(),calls=[];h.ctx.S.nodes.push({id:'deep',label:'Branch here',x:1260,y:255},{id:'existing',label:'Existing child',x:1470,y:255});h.ctx.S.edges.push({from:'root',to:'deep'},{from:'deep',to:'existing'});
    h.ctx.act=async(type,a)=>{calls.push(a);return {ok:true,json:async()=>({id:'new-child'})};};
    h.pick('deep');h.key('Tab');expect(h.ctx.naming.link.id).toBe('deep');h.flushPick();expect(h.ctx.keyboardSelection).toBe(true);
    h.blur();await new Promise(setImmediate);expect(calls[0].from).toBe('deep');expect(h.ctx.S.edges).toContainEqual({from:'deep',to:'existing'});
  });
  it('keeps a clicked selected topic as the parent instead of toggling back to the root',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'deep',label:'Branch here',x:1260,y:255});h.ctx.S.edges.push({from:'root',to:'deep'});
    h.pick('deep');h.flushPick();h.pick('deep');h.flushPick();h.key('Tab');expect(h.ctx.naming.link.id).toBe('deep');
  });
  it('does not let an older save replace the newly clicked parent',async()=>{
    const h=harness();h.ctx.S.nodes.push({id:'deep',label:'Branch here',x:1260,y:255});h.ctx.S.edges.push({from:'root',to:'deep'});
    /** @type {any} */ let release;const gate=new Promise(resolve=>{release=resolve;});h.ctx.act=async()=>{await gate;return {ok:true,json:async()=>({id:'old-save'})};};
    h.key('Tab');const saved=h.ctx.endName(true);h.pick('deep');h.flushPick();release();await saved;
    expect(h.ctx.selected).toBe('deep');h.key('Tab');expect(h.ctx.naming.link.id).toBe('deep');
  });
  it('keeps each parent visible while deleting back through a long branch',()=>{
    const h=harness();h.ctx.S.nodes=Array.from({length:31},(_,i)=>({id:`n${i}`,label:'Topic',x:i*500,y:i*85}));
    h.ctx.S.edges=Array.from({length:30},(_,i)=>({from:`n${i}`,to:`n${i+1}`}));h.ctx.selected='n30';h.ctx.cam.z=1.5;
    for(let i=30;i>0;i--){
      h.ctx.deleteBox(`n${i}`);expect(h.ctx.selected).toBe(`n${i-1}`);
      const n=h.ctx.nodeById(h.ctx.selected);expect(n.x*h.ctx.cam.z+h.ctx.cam.x).toBeGreaterThanOrEqual(121);expect(n.x*h.ctx.cam.z+h.ctx.cam.x).toBeLessThanOrEqual(1079);expect(n.y*h.ctx.cam.z+h.ctx.cam.y).toBeGreaterThanOrEqual(53.5);expect(n.y*h.ctx.cam.z+h.ctx.cam.y).toBeLessThanOrEqual(686.5);expect(h.ctx.cam.z).toBe(1.5);
    }
  });
  it('selects a remaining standalone box and handles deleting the last box',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'other',label:'Other',x:2000,y:1000});h.ctx.deleteBox('root');expect(h.ctx.selected).toBe('other');expect(h.ctx.cam.x).toBe(-886);
    h.ctx.deleteBox('other');expect(h.ctx.selected).toBeNull();
  });
  it('reveals the parent when deleting an empty edited name without restoring the deleted box',async()=>{
    const h=harness();h.ctx.S.nodes.push({id:'child',label:'Child',x:2000,y:1000});h.ctx.S.edges.push({from:'root',to:'child'});h.ctx.selected='child';
    h.key('F2');h.type('');h.edit('Backspace');await new Promise(setImmediate);
    expect(h.ctx.selected).toBe('root');expect(h.ctx.cam.x).toBe(86);expect(h.ctx.cam.y).toBe(41);
  });
  it('brings a draft parent into view even before its saved node arrives',async()=>{
    const h=harness();h.ctx.topicDraft({id:Promise.resolve('pending'),label:'Parent',x:3000,y:1000},true);h.edit('Backspace');await new Promise(setImmediate);
    expect(h.ctx.selected).toBe('pending');expect(h.ctx.cam.x).toBe(-2096);expect(h.ctx.cam.y).toBe(-301);
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
    expect(h.input().focusOptions).toEqual({preventScroll:true});
  });
  it('keeps visible arrow selections and cancelling a draft in place',async()=>{
    const h=harness();h.ctx.S.nodes.push({id:'child',label:'Child',x:210,y:0});h.ctx.S.edges.push({from:'root',to:'child'});h.ctx.cam={x:300,y:300,z:1};
    h.key('ArrowRight');expect(h.ctx.selected).toBe('child');expect(h.ctx.cam).toEqual({x:300,y:300,z:1});
    h.key('Tab');h.edit('Escape');await new Promise(setImmediate);expect(h.ctx.cam).toEqual({x:300,y:300,z:1});
  });
  it('Tab with no selection uses the visible previous topic without centering it',()=>{
    const h=harness();h.ctx.selected=null;h.ctx.cam={x:250,y:300,z:1};h.key('Tab');
    expect(h.ctx.naming.link.id).toBe('root');expect(h.ctx.cam).toEqual({x:250,y:300,z:1});
  });
  it('repeated Tab pans only at the right edge and keeps the vertical position and zoom',()=>{
    const h=harness();h.ctx.cam={x:120,y:300,z:1};
    for(let i=1;i<=12;i++){
      const before={...h.ctx.cam};if(i===1)h.key('Tab');else h.edit('Tab');
      const expected=Math.min(before.x,1184-70-h.ctx.naming.x);
      expect(h.ctx.cam).toEqual({x:expected,y:300,z:1});
    }
  });
  it('reveals an offscreen selection at the nearest edge without centering or zooming',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'left',label:'Left',x:-2000,y:300},{id:'right',label:'Right',x:2000,y:300});
    h.ctx.selectTopic('left');expect(h.ctx.cam).toEqual({x:2086,y:0,z:1});
    h.ctx.selectTopic('right');expect(h.ctx.cam).toEqual({x:-886,y:0,z:1});
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
    const h=harness(), calls=[];
    /** @type {any} */ let release;const gate=new Promise(resolve=>{release=resolve;});
    h.ctx.act=async(type,args)=>{const id=`topic-${calls.length+1}`;calls.push([type,args]);await gate;return {ok:true,json:async()=>({id})};};
    h.key('Tab');h.edit('Tab');h.edit('Tab');h.edit('Tab');
    expect(h.ctx.naming.untouched).toBe(true);expect(h.input().value).toBe('Sub-topic');
    release();expect(await h.ctx.naming.link.id).toBe('topic-3');
    expect(calls.map(([,args])=>args.from)).toEqual(['root','topic-1','topic-2']);
    expect(calls.every(([,args])=>args.label==='Sub-topic')).toBe(true);
    h.edit('Backspace');await new Promise(setImmediate);expect(h.ctx.selected).toBe('topic-3');
  });
  it('chains rapid children beside an existing lower branch without stale reflow positions',async()=>{
    const h=harness(),calls=[],failures=[];
    h.ctx.S.nodes=[{id:'root',label:'Root',x:0,y:100},{id:'branch',label:'Sub-topic',x:210,y:85},{id:'existing',label:'Sub-topic',x:420,y:85},{id:'lower',label:'Sub-topic',x:210,y:255},{id:'lower-child',label:'Sub-topic',x:420,y:255},{id:'lower-top',label:'Sub-topic',x:630,y:170},{id:'lower-mid',label:'Sub-topic',x:630,y:255},{id:'lower-bottom',label:'Sub-topic',x:630,y:340}];
    h.ctx.S.edges=[{from:'root',to:'branch'},{from:'branch',to:'existing'},{from:'root',to:'lower'},{from:'lower',to:'lower-child'},...['lower-top','lower-mid','lower-bottom'].map(to=>({from:'lower-child',to}))];
    h.ctx.selected='branch';const state=structuredClone(h.ctx.S);
    const broadcast=()=>{h.ctx.S=structuredClone(state);vm.runInContext(livePreview,h.ctx);};
    h.ctx.act=async(type,a)=>{
      calls.push(a);for(const m of a.reflow||[]){const n=state.nodes.find(n=>n.id===m.id);if(n?.y!==m.fromY)failures.push({id:m.id,expected:m.fromY,actual:n?.y});}
      if(failures.length)return {ok:false};
      for(const m of a.reflow||[])state.nodes.find(n=>n.id===m.id).y=m.y;
      const id=`created-${calls.length}`;state.nodes.push({id,label:a.label,x:a.x,y:a.y});state.edges.push({from:a.from,to:id});broadcast();return {ok:true,json:async()=>({id})};
    };
    h.key('Tab');h.edit('Tab');h.edit('Tab');h.blur();await new Promise(setImmediate);
    expect(failures).toEqual([]);expect(calls.map(a=>a.from)).toEqual(['branch','created-1','created-2']);
    expect(state.nodes.filter(n=>n.id.startsWith('created')).map(n=>n.y)).toEqual([170,170,170]);
  });
  it('rebases an open child draft when a live layout update arrives before the next Tab',async()=>{
    const h=harness(), calls=[], failures=[];
    h.ctx.S.nodes.push({id:'one',label:'One',x:210,y:0},{id:'a',label:'A',x:420,y:0},{id:'two',label:'Two',x:210,y:85},{id:'b',label:'B',x:420,y:85});
    h.ctx.S.edges.push({from:'root',to:'one'},{from:'one',to:'a'},{from:'root',to:'two'},{from:'two',to:'b'});h.ctx.selected='one';
    const state=structuredClone(h.ctx.S);
    h.ctx.act=async(type,a)=>{calls.push(a);for(const m of a.reflow||[]){const n=state.nodes.find(n=>n.id===m.id);if(n?.y!==m.fromY)failures.push(m.id);}
      if(failures.length)return {ok:false};
      for(const m of a.reflow||[])state.nodes.find(n=>n.id===m.id).y=m.y;
      const id=`created-${calls.length}`;state.nodes.push({id,label:a.label,x:a.x,y:a.y});state.edges.push({from:a.from,to:id});h.ctx.S=structuredClone(state);return {ok:true,json:async()=>({id})};};
    h.key('Tab');
    state.nodes.find(n=>n.id==='two').y=105;state.nodes.find(n=>n.id==='b').y=105;
    h.ctx.S=structuredClone(state);
    vm.runInContext(livePreview,h.ctx);
    h.edit('Tab');h.blur();await new Promise(setImmediate);
    expect(failures).toEqual([]);expect(calls.map(a=>a.from)).toEqual(['one','created-1']);
  });
  it('keeps typed text through live updates and cancellation restores the latest saved positions',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'one',label:'One',x:210,y:0},{id:'a',label:'A',x:420,y:0},{id:'two',label:'Two',x:210,y:85});
    h.ctx.S.edges.push({from:'root',to:'one'},{from:'one',to:'a'},{from:'root',to:'two'});h.ctx.selected='one';
    const state=structuredClone(h.ctx.S);h.key('Tab');h.type('Keep these words');
    state.nodes.find(n=>n.id==='two').y=105;h.ctx.S=structuredClone(state);vm.runInContext(livePreview,h.ctx);
    expect(h.input().value).toBe('Keep these words');expect(h.ctx.nodeById('two').y).toBeGreaterThan(105);
    h.edit('Escape');expect(h.ctx.S.nodes).toEqual(state.nodes);
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
    const h=harness(), calls=[];
    /** @type {any} */ let release;const gate=new Promise(resolve=>{release=resolve;});
    h.ctx.act=async(type,args)=>{const id=`topic-${calls.length+1}`;calls.push([type,args]);await gate;return {ok:true,json:async()=>({id})};};
    h.key('Tab');h.edit('Tab');h.edit('Tab');h.blur();h.ctx.selected='clicked';release();await new Promise(setImmediate);
    expect(calls.map(([,a])=>a.from)).toEqual(['root','topic-1','topic-2']);expect(h.ctx.selected).toBe('clicked');
  });
  it('back to a parent then Tab adds another child without overlapping an unfinished save',async()=>{
    const h=harness(), calls=[];
    /** @type {any} */ let release;const gate=new Promise(resolve=>{release=resolve;});
    h.ctx.act=async(type,args)=>{calls.push([type,args]);await gate;return {ok:true,json:async()=>({id:'first-child'})};};
    h.key('Tab');const first={...h.ctx.naming};h.edit('ArrowLeft');await Promise.resolve();h.key('Tab');
    expect(h.ctx.naming.link.id).toBe('root');expect(h.ctx.naming.x).toBe(first.x);expect(h.ctx.naming.y).toBeGreaterThan(first.y);
    release();await new Promise(setImmediate);expect(h.ctx.naming).not.toBeNull();expect(calls[0][1].from).toBe('root');
  });
  it('previews lower branches moving and restores them when the new topic is cancelled',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'one',label:'One',x:210,y:0},{id:'a',label:'A',x:420,y:0},{id:'two',label:'Two',x:210,y:85},{id:'b',label:'B',x:420,y:85});
    h.ctx.S.edges.push({from:'root',to:'one'},{from:'one',to:'a'},{from:'root',to:'two'},{from:'two',to:'b'});h.ctx.selected='one';
    h.key('Tab');expect(h.ctx.naming.y).toBe(85);expect(h.ctx.nodeById('two').y).toBe(170);expect(h.ctx.nodeById('b').y).toBe(170);
    h.edit('Escape');expect(h.ctx.nodeById('one').y).toBe(0);expect(h.ctx.nodeById('two').y).toBe(85);expect(h.ctx.nodeById('b').y).toBe(85);
  });
  it('saves the insertion and all shifted boxes as one add action',async()=>{
    const h=harness(),calls=[];h.ctx.S.nodes.push({id:'one',label:'One',x:210,y:0},{id:'a',label:'A',x:420,y:0},{id:'two',label:'Two',x:210,y:85},{id:'b',label:'B',x:420,y:85});
    h.ctx.S.edges.push({from:'root',to:'one'},{from:'one',to:'a'},{from:'root',to:'two'},{from:'two',to:'b'});h.ctx.selected='one';
    h.ctx.act=async(type,args)=>{calls.push([type,args]);return {ok:true,json:async()=>({id:'new'})};};h.key('Tab');h.blur();await new Promise(setImmediate);
    expect(calls).toHaveLength(1);expect(calls[0][0]).toBe('add');expect(calls[0][1].reflow).toContainEqual({id:'two',fromY:85,y:170});expect(calls[0][1].reflow).toContainEqual({id:'b',fromY:85,y:170});
  });
  it('keeps rapid sibling insertions ordered while previous layouts are still saving',async()=>{
    const h=harness(),calls=[];h.ctx.S.nodes.push({id:'one',label:'One',x:210,y:0},{id:'a',label:'A',x:420,y:0},{id:'two',label:'Two',x:210,y:85},{id:'b',label:'B',x:420,y:85});
    h.ctx.S.edges.push({from:'root',to:'one'},{from:'one',to:'a'},{from:'root',to:'two'},{from:'two',to:'b'});h.ctx.selected='one';
    const state=structuredClone(h.ctx.S);
    /** @type {any} */ let release;const gate=new Promise(resolve=>{release=resolve;});
    h.ctx.act=async(type,a)=>{await gate;calls.push(a);for(const m of a.reflow||[]){const n=state.nodes.find(n=>n.id===m.id);expect(n.y).toBe(m.fromY);n.y=m.y;}
      const id=`new-${calls.length}`;state.nodes.push({id,label:a.label,x:a.x,y:a.y});state.edges.push({from:a.from,to:id});h.ctx.S=structuredClone(state);return {ok:true,json:async()=>({id})};};
    h.key('Tab');h.edit('Enter');h.edit('Enter');h.blur();release();await new Promise(setImmediate);
    expect(calls.map(a=>a.y)).toEqual([85,170,255]);expect(calls.map(a=>a.from)).toEqual(['one','one','one']);
    expect(state.nodes.find(n=>n.id==='two').y).toBe(340);expect(state.nodes.find(n=>n.id==='b').y).toBe(340);
  });
  it('arrows preserve the text editor once typing starts',()=>{
    const h=harness();h.key('Tab');h.type('Typed');const draft=h.ctx.naming;h.edit('ArrowLeft');expect(h.ctx.naming).toBe(draft);expect(h.input().value).toBe('Typed');
  });
  it('saves only entered names and discards names erased before saving',async()=>{
    const h=harness(), calls=[];h.ctx.act=async(type,args)=>{calls.push([type,args]);return {ok:true,json:async()=>({id:'typed'})};};
    h.key('Tab');h.type('Sub-topic');h.blur();await new Promise(setImmediate);expect(calls[0][1].label).toBe('Sub-topic');
    const empty=harness();empty.ctx.act=(...args)=>calls.push(args);empty.key('Tab');empty.type('');empty.blur();expect(calls).toHaveLength(1);
  });
  it('uses the saved branch stem for the new topic preview',()=>{
    const h=harness();h.ctx.S.nodes.push({id:'child',label:'Child',x:210,y:0});h.ctx.S.edges.push({from:'root',to:'child'});h.key('Tab');
    expect(h.rubber.innerHTML).toContain('M70 0L84 0L84 85L138 85');
  });
  it('leaves Command R to the drawing tool even with a box selected',()=>{
    const h=harness();h.key('r',{metaKey:true});expect(h.ctx.naming).toBeNull();expect(h.ctx.selected).toBe('root');
  });
  it('keeps tool letters and text fields out of rename handling',()=>{
    const h=harness();h.key('c');expect(h.ctx.naming).toBeNull();h.key('r',{target:{closest:()=>true}});expect(h.ctx.naming).toBeNull();h.key('Tab',{isComposing:true});expect(h.ctx.naming).toBeNull();
  });
  it('Enter saves an existing name without creating a sibling',async()=>{
    const h=harness(),calls=[];h.ctx.act=async(type,a)=>{calls.push([type,a]);return {ok:true,json:async()=>({id:a.id})};};
    h.key('F2');h.type('Renamed root');h.edit('Enter');await vm.runInContext('topicSaveQueue',h.ctx);
    expect(calls).toEqual([['renamebox',{id:'root',label:'Renamed root'}]]);expect(h.ctx.naming).toBeNull();
  });
  it('double-clicks edit only the text area clicked, including after switching areas',async()=>{
    const h=harness(),calls=[];h.ctx.S.nodes[0].sub='Original description';
    h.ctx.act=async(type,args)=>{calls.push([type,args]);return {ok:true,json:async()=>({id:args.id})};};
    h.ctx.tapTopic(h.ctx.S.nodes[0],'label');h.ctx.tapTopic(h.ctx.S.nodes[0],'sub');expect(h.ctx.naming).toBeNull();
    h.ctx.tapTopic(h.ctx.S.nodes[0],'sub');expect(h.input().value).toBe('Original description');expect(h.input().selected).toBe(true);
    h.type('Changed description');h.edit('Enter');await vm.runInContext('topicSaveQueue',h.ctx);
    expect(calls).toEqual([['describebox',{id:'root',sub:'Changed description'}]]);expect(h.ctx.S.nodes[0].label).toBe('Root');
    h.ctx.tapTopic(h.ctx.S.nodes[0],'label');h.ctx.tapTopic(h.ctx.S.nodes[0],'label');expect(h.input().value).toBe('Root');
    h.type('Changed name');h.edit('Enter');await vm.runInContext('topicSaveQueue',h.ctx);
    expect(calls.at(-1)).toEqual(['renamebox',{id:'root',label:'Changed name'}]);
  });
  it('clearing a description keeps the box, and Tab saves without creating a child',async()=>{
    const h=harness(),calls=[];h.ctx.S.nodes[0].sub='Description';
    h.ctx.act=async(type,args)=>{calls.push([type,args]);return {ok:true,json:async()=>({id:args.id})};};
    h.ctx.askName({x:0,y:0,edit:'root',field:'sub',text:'Description'});h.type('');h.edit('Backspace');
    expect(h.ctx.S.nodes).toHaveLength(1);expect(h.ctx.naming.field).toBe('sub');
    h.edit('Tab');await vm.runInContext('topicSaveQueue',h.ctx);
    expect(calls).toEqual([['describebox',{id:'root',sub:''}]]);expect(h.ctx.naming).toBeNull();
  });
  it('cancels description edits and keeps read-only double-clicks from opening an editor',()=>{
    const h=harness();h.ctx.S.nodes[0].sub='Keep this';
    h.ctx.askName({x:0,y:0,edit:'root',field:'sub',text:'Keep this'});h.type('Discard this');h.edit('Escape');
    expect(h.ctx.S.nodes[0].sub).toBe('Keep this');expect(h.ctx.naming).toBeNull();
    for(const mode of ['READ_ONLY','FILE','PREVIEW']){h.ctx[mode]=true;h.ctx.tapTopic(h.ctx.S.nodes[0],'sub');h.ctx.tapTopic(h.ctx.S.nodes[0],'sub');expect(h.ctx.naming).toBeNull();h.ctx[mode]=false;}
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
    const h=harness();h.ctx.PREVIEW={};h.key('Tab');expect(h.ctx.naming).toBeNull();h.ctx.PREVIEW=null;h.ctx.FILE=true;h.key('Tab');expect(h.ctx.naming).toBeNull();
  });
});
