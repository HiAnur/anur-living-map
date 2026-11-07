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
