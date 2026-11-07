import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
describe('pointer tool shortcut',()=>{
  it('switches Hand to Select, clears temporary panning and updates the toolbar',()=>{
    let handler;const classes=new Set(['hand','grabbing','spacepan']),active=new Set();
    const ctx=vm.createContext({tool:'hand',spaceDown:true,panning:{},draft:null,PREVIEW:null,READ_ONLY:false,render(){},
      canvas:{classList:{remove(...names){names.forEach(n=>classes.delete(n));},toggle(n,on){if(on)classes.add(n);else classes.delete(n);}}},
      document:{addEventListener(type,f){handler=f;},querySelectorAll:()=>['select','hand'].map(tool=>({dataset:{tool},classList:{toggle(n,on){if(on)active.add(tool);else active.delete(tool);}}}))},
    });
    vm.runInContext(html.slice(html.indexOf('function setTool('),html.indexOf('\n',html.indexOf('function setTool('))),ctx);
    vm.runInContext(html.slice(html.indexOf('const TOOL_KEYS ='),html.indexOf("document.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ draft")),ctx);
    handler({key:'v',code:'KeyV',metaKey:true,target:{closest:()=>false},preventDefault(){}});
    expect(ctx.tool).toBe('select');expect(ctx.spaceDown).toBe(false);expect(ctx.panning).toBeNull();expect([...active]).toEqual(['select']);expect(classes.size).toBe(0);
    for(const key of ['a','h','c']){handler({key,metaKey:true,target:{closest:()=>false},preventDefault(){}});expect(ctx.tool).toBe({a:'arrow',h:'hand',c:'comment'}[key]);}
    handler({key:'a',target:{closest:()=>false},preventDefault(){}});expect(ctx.tool).toBe('comment');
    for(const key of ['a','c','v']){handler({key,metaKey:true,target:{closest:()=>true},preventDefault(){throw Error('Text shortcut intercepted');}});expect(ctx.tool).toBe('comment');}
    ctx.tool='hand';handler({key:'v',code:'KeyV',metaKey:true,target:{closest:()=>true},preventDefault(){}});expect(ctx.tool).toBe('hand');
  });
});

describe('map history controls', () => {
  function historyHarness(){
    let keydown; const calls = [];
    const ctx = vm.createContext({ PREVIEW:null,READ_ONLY:false, FILE:false, naming:null, selected:null, delAsk:null,
      pendingTopics:new Set(), pendingActions:new Set(), pendingRemovals:new Set(), group:new Set(), topicSaveQueue:Promise.resolve(),
      document:{addEventListener(type,fn){keydown=fn;}}, toast(){}, render(){}, refreshMap:async()=>{}, nodeById:()=>null,
      act:async direction=>{calls.push(direction);return {ok:true,json:async()=>({})};},
    });
    vm.runInContext(html.slice(html.indexOf('// Map undo leaves'),html.indexOf('/* pan, zoom, drag */')),ctx);
    return {ctx,calls,keydown};
  }
  it('waits for a name save and runs rapid undo and redo clicks in order', async () => {
    const h=historyHarness(); let finish;
    h.ctx.topicSaveQueue=new Promise(resolve=>{finish=resolve;});
    const undo=h.ctx.mapUndo('undo'),redo=h.ctx.mapUndo('redo');
    await new Promise(setImmediate);expect(h.calls).toEqual([]);
    finish();await Promise.all([undo,redo]);expect(h.calls).toEqual(['undo','redo']);
  });
  it('uses the same history for shortcuts while keeping normal text undo', async () => {
    const h=historyHarness();
    const key=(shiftKey,typing)=>({key:'z',metaKey:true,shiftKey,target:{closest:()=>typing},preventDefault(){},stopImmediatePropagation(){}});
    h.keydown(key(false,true));await new Promise(setImmediate);expect(h.calls).toEqual([]);
    h.keydown(key(false,false));h.keydown(key(true,false));await new Promise(setImmediate);expect(h.calls).toEqual(['undo','redo']);
  });
  it('finishes a selected draft before undoing it', async () => {
    const h=historyHarness();h.ctx.naming={untouched:true};h.ctx.endName=()=>{h.calls.push('save');h.ctx.naming=null;};
    await h.ctx.mapUndo('undo');expect(h.calls).toEqual(['save','undo']);
  });
});
