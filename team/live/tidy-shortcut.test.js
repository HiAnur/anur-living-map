import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
function harness(){
  let handler;const calls=[];
  const ctx=vm.createContext({READ_ONLY:false,FILE:false,PREVIEW:null,view:'system',
    scope:()=>({nodes:[{id:'root'},{id:'draft',proposed:true}]}),W:()=>140,HT:()=>50,
    act:(...args)=>calls.push(args),document:{addEventListener:(_,fn)=>{handler=fn;}}});
  vm.runInContext(html.slice(html.indexOf('// Tidy shortcut'),html.indexOf('// Map undo leaves')),ctx);
  return {ctx,calls,key:extra=>handler({key:'L',metaKey:true,shiftKey:true,target:{closest:()=>false},preventDefault(){},...extra})};
}
describe('Tidy up shortcut',()=>{
  it('uses Command Shift L and Control Shift L on the current visible boxes',()=>{
    for(const modifier of [{metaKey:true},{metaKey:false,ctrlKey:true}]){
      const h=harness();h.key(modifier);expect(h.calls).toEqual([['tidy',{view:'system',only:['root'],sizes:[{id:'root',w:140,h:50}]}]]);
    }
  });
  it('does not interrupt text editing or fire on repeats, plain L, or other combinations',()=>{
    for(const event of [{target:{closest:()=>true}},{repeat:true},{metaKey:false},{shiftKey:false},{altKey:true},{isComposing:true},{defaultPrevented:true},{key:'z'}]){
      const h=harness();h.key(event);expect(h.calls).toEqual([]);
    }
  });
  it('leaves view-only links, saved files, history and diagram views unchanged',()=>{
    for(const mode of [{READ_ONLY:true},{FILE:true},{PREVIEW:{}},{view:'flow:root'},{view:'diagram:root'}]){
      const h=harness();Object.assign(h.ctx,mode);h.key();expect(h.calls).toEqual([]);
    }
  });
});
