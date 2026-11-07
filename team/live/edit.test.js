import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf("const pick = (n) =>"),html.indexOf("canvas.addEventListener('pointerleave'"));
function harness(){
  let up, pending;const edits=[],opened=[];
  const ctx=vm.createContext({
    canvas:{addEventListener(type,handler){up=handler;}},drawing:null,marquee:null,drag:null,panning:null,moved:false,PREVIEW:null,FILE:false,
    lastTap:{id:null,at:0},DBL:320,tapTimer:null,clearTimeout(){pending=null;},setTimeout(fn){pending=fn;return 1;},Date,selected:null,render(){},keepInView(){},
    locked:n=>!!n.locked,diagramChange:()=>false,
    askName:at=>edits.push(at),enter:id=>opened.push(id),openDiagram:id=>opened.push(id),
  });
  vm.runInContext(source,ctx);
  return {ctx,edits,opened,click:n=>{ctx.drag={n};up({});}};
}
describe('double click topic editing',()=>{
  const node={id:'child',label:'Sub-topic',x:210,y:0};
  it('opens the existing name for replacement on the second click',()=>{
    const h=harness();h.click(node);expect(h.edits).toEqual([]);expect(h.ctx.selected).toBeNull();h.click(node);
    expect(h.edits).toEqual([{x:210,y:0,edit:'child',text:'Sub-topic'}]);expect(h.ctx.drag).toBeNull();
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
