import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
function panel(){
  const node={id:'test',label:'First small test',sub:'cheapest way to learn something real'},input={value:'',focus(){},select(){}},calls=[],handlers={};
  const ctx=vm.createContext({nodeById:id=>id===node.id?node:null,locked:()=>false,READ_ONLY:false,FILE:false,PREVIEW:null,VIEW_SAYS:'View only',FILE_SAYS:'File',FROZEN_SAYS:'History',tapTimer:null,nameSession:0,clearTimeout(){},toast(){},refreshMap(){},render(){},
    renderSide(){input.value=node[vm.runInContext('sideRename.field',ctx)]||'';},$:()=>input,act:async(type,args)=>{calls.push([type,args]);return {ok:true};},document:{addEventListener(type,fn){handlers[type]=fn;}}
  });
  vm.runInContext(html.slice(html.indexOf('let sideRename ='),html.indexOf('// the box whose card asks')),ctx);
  const open=(description=true)=>handlers.dblclick({target:{closest:selector=>selector===(description?'[data-description-box]':'[data-rename-box]')?{dataset:{descriptionBox:'test',renameBox:'test'}}:null}});
  const key=(key,shiftKey=false)=>handlers.keydown({key,shiftKey,target:{id:'side-name'},preventDefault(){},stopImmediatePropagation(){}});
  return {ctx,node,input,calls,handlers,open,key};
}
describe('inline box description',()=>{
  it('opens the description on double click and saves without changing the name',()=>{
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
  it('preserves name editing and keeps viewers, files and history read only',()=>{
    const h=panel();h.open(false);h.input.value='Renamed';h.key('Enter');expect(h.calls).toEqual([['renamebox',{id:'test',label:'Renamed'}]]);
    for(const mode of ['READ_ONLY','FILE','PREVIEW']){const h=panel();h.ctx[mode]=true;h.open();expect(vm.runInContext('sideRename',h.ctx)).toBeNull();expect(h.calls).toEqual([]);}
  });
});
