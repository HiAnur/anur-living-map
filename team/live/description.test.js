import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
function panel(){
  const node={id:'test',label:'First small test',sub:'cheapest way to learn something real'},selection={isCollapsed:true},input={value:'',focus(){},select(){}},calls=[],handlers={};
  const ctx=vm.createContext({nodeById:id=>id===node.id?node:null,locked:()=>false,READ_ONLY:false,FILE:false,PREVIEW:null,VIEW_SAYS:'View only',FILE_SAYS:'File',FROZEN_SAYS:'History',tapTimer:null,nameSession:0,getSelection:()=>selection,clearTimeout(){},toast(){},refreshMap(){},render(){},
    renderSide(){input.value=node[vm.runInContext('sideRename.field',ctx)]||'';},$:()=>input,act:async(type,args)=>{calls.push([type,args]);return {ok:true};},document:{addEventListener(type,fn){handlers[type]=fn;}}
  });
  vm.runInContext(html.slice(html.indexOf('let sideRename ='),html.indexOf('// the box whose card asks')),ctx);
  const open=(description=true)=>handlers.click({target:{closest:selector=>selector===(description?'#side [data-description-box]':'#side [data-rename-box]')?{dataset:{descriptionBox:'test',renameBox:'test'}}:null}});
  const key=(key,shiftKey=false)=>handlers.keydown({key,shiftKey,target:{id:'side-name'},preventDefault(){},stopImmediatePropagation(){}});
  return {ctx,node,input,calls,handlers,open,key,selection};
}
describe('inline box description',()=>{
  it('opens the description on one click and saves without changing the name',()=>{
    const h=panel();h.open();expect(h.input.value).toBe(h.node.sub);
    h.input.value='  A smaller experiment  ';h.key('Enter');
    expect(h.node.sub).toBe('A smaller experiment');expect(h.node.label).toBe('First small test');
    expect(h.calls).toEqual([['describebox',{id:'test',sub:'A smaller experiment'}]]);
  });
  it('cancels with Escape, supports line breaks, saves on blur and allows clearing',()=>{
    const h=panel();h.open();h.input.value='Discard';h.key('Escape');expect(h.calls).toEqual([]);
    h.open();h.input.value='First line\nSecond line';h.key('Enter',true);expect(h.calls).toEqual([]);
    h.handlers.focusout({target:{id:'side-name'}});expect(h.node.sub).toBe('First line\nSecond line');
    h.open();h.input.value='';h.key('Enter');expect(h.node.sub).toBe('');expect(h.calls).toHaveLength(2);
  });
  it('preserves name editing, leaves a text selection alone, and keeps viewers, files and history read only',()=>{
    const h=panel();h.open(false);h.input.value='Renamed';h.key('Enter');expect(h.calls).toEqual([['renamebox',{id:'test',label:'Renamed'}]]);
    const s=panel();s.selection.isCollapsed=false;s.open(false);expect(vm.runInContext('sideRename',s.ctx)).toBeNull();
    for(const mode of ['READ_ONLY','FILE','PREVIEW']){const h=panel();h.ctx[mode]=true;h.open();expect(vm.runInContext('sideRename',h.ctx)).toBeNull();expect(h.calls).toEqual([]);}
  });
});
it('gives the name field the heading\'s full width, so it is never a zero-wide sliver',()=>{
  expect(html).toContain('#side .box-heading > #side-name{flex:none;width:100%}');
});
