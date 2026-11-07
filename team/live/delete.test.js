import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf("document.addEventListener('keydown'",html.indexOf('function deleteBox('));
const source=html.slice(start,html.indexOf('const ago =',start));
describe('delete selected boxes',()=>{
  it('deletes the group immediately without opening a confirmation',()=>{
    for(const key of ['Delete','Backspace']){
      let handler;const removed=[];
      const ctx=vm.createContext({document:{addEventListener(type,f){handler=f;}},group:new Set(['one','two']),delAsk:null,PREVIEW:null,FILE:false,deleteBox:id=>removed.push(id)});
      vm.runInContext(source,ctx);handler({key,target:{closest:()=>false},preventDefault(){}});
      expect(removed).toEqual(['*']);expect(ctx.delAsk).toBeNull();
    }
  });
});

describe('branch deletion confirmation',()=>{
  function page(){
    const calls=[],state={nodes:[{id:'root',label:'Root',x:0,y:0},{id:'parent',label:'Parent',x:210,y:0},{id:'child',label:'Child',x:420,y:0}],edges:[{from:'root',to:'parent'},{from:'parent',to:'child'}]};let handler;
    const ctx=vm.createContext({Set,Map,S:state,group:new Set(),selected:'parent',delAsk:null,PREVIEW:null,FILE:false,pendingRemovals:new Set(),pendingTopics:new Set(),keyboardSelection:true,
      nodeById:id=>state.nodes.find(n=>n.id===id),scope:()=>state,locked:()=>false,topicParent:n=>state.nodes.find(x=>state.edges.some(e=>e.from===x.id&&e.to===n.id)),
      render(){},keepInView(){},selectTopic:id=>{ctx.selected=id;},toast(){},refreshMap:async()=>{},
      hideRemoved:s=>{s.nodes=s.nodes.filter(n=>!ctx.pendingRemovals.has(n.id));s.edges=s.edges.filter(e=>!ctx.pendingRemovals.has(e.from)&&!ctx.pendingRemovals.has(e.to));},
      act:async(type,args)=>{calls.push([type,args]);return {ok:true};},document:{addEventListener(type,f){handler=f;}}
    });
    vm.runInContext(html.slice(html.indexOf('function branchIds('),html.indexOf('const ago =',start)),ctx);
    return {ctx,state,calls,key:key=>handler({key,target:{closest:()=>false},preventDefault(){},stopImmediatePropagation(){}})};
  }
  it('keeps a parent and children until Enter confirms, then removes them together',()=>{
    const h=page();h.key('Delete');expect(h.ctx.delAsk).toBe('parent');expect(h.calls).toEqual([]);expect(h.state.nodes).toHaveLength(3);
    h.key('Enter');expect(h.state.nodes.map(n=>n.id)).toEqual(['root']);expect(h.ctx.selected).toBe('root');expect(h.calls).toEqual([['remove',{ids:['parent'],cascade:true}]]);
  });
  it('waits for pending children before asking to delete the branch',async()=>{
    const h=page();let release;const pending={saved:new Promise(resolve=>{release=resolve;})};h.ctx.pendingTopics.add(pending);
    h.key('Delete');expect(h.ctx.delAsk).toBeNull();expect(h.calls).toEqual([]);
    pending.id='saved';release();await new Promise(setImmediate);expect(h.ctx.delAsk).toBe('parent');expect(h.calls).toEqual([]);
  });
  it('Escape keeps a branch and leaves leaf deletion immediate',()=>{
    const h=page();h.key('Backspace');h.key('Escape');expect(h.ctx.delAsk).toBeNull();expect(h.state.nodes).toHaveLength(3);expect(h.calls).toEqual([]);
    h.ctx.selected='child';h.key('Delete');expect(h.state.nodes.map(n=>n.id)).toEqual(['root','parent']);expect(h.calls).toHaveLength(1);
  });
});
