import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./maps.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function brainObjects('), html.indexOf('let brainMaps =')), ctx);
describe('All brain objects', () => {
  it('includes nested map boxes, settled decisions, instructions and memories', () => {
    const state = { nodes: [{ id:'a', label:'Launch', inside:{nodes:[{id:'b',label:'Test'}]} }],
      calls:[{id:'yes',node:'b',status:'answered'},{id:'wait',node:'a',status:'open'}],
      log:[{action:'confirmed',text:'Use a small pilot',node:'a',who:'Duy'}],
      memory:[{id:'rule',kind:'instruction'},{id:'fact',box:'b',kind:'memory'}] };
    const before=JSON.stringify(state), got=ctx.brainObjects(state,'Duy');
    expect(got.nodes.map(n=>[n.id,n.container])).toEqual([['a','system'],['b','a']]);
    expect(got.decisions.map(c=>c.id)).toEqual(['yes','log-0']);
    expect(got.memory.map(m=>m.id)).toEqual(['rule','fact']);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('uses the chosen map visibility and hides inaccessible or removed box objects', () => {
    const got=ctx.brainObjects({people:[{id:'Duy',sees:'public'}],
      nodes:[{id:'a',area:'public'},{id:'b',area:'private',inside:{nodes:[{id:'c',area:'public'}]}}],
      calls:[{node:'a',status:'confirmed'},{node:'b',status:'answered'},{node:'gone',status:'answered'}],
      memory:[{id:'all'},{id:'visible',box:'a'},{id:'hidden',box:'b'},{id:'gone',box:'gone'}]},'Duy');
    expect(got.nodes.map(n=>n.id)).toEqual(['a']);
    expect(got.decisions.map(c=>c.node)).toEqual(['a']);
    expect(got.memory.map(m=>m.id)).toEqual(['all','visible']);
  });
});

describe('All brain loading', () => {
  it('ignores an older map response after another map is chosen', async () => {
    const pending=[];
    const c=vm.createContext({fetch:()=>new Promise(resolve=>pending.push(resolve)),renderBrain(){},fitPane(){}});
    vm.runInContext(html.slice(html.indexOf('let brainMaps ='),html.indexOf('function renderBrain(')),c);
    const old=c.loadBrain({href:'/old/'}), latest=c.loadBrain({href:'/new/'});
    pending[1]({ok:true,json:async()=>({title:'New'})}); await latest;
    pending[0]({ok:true,json:async()=>({title:'Old'})}); await old;
    expect(vm.runInContext('brainState.title',c)).toBe('New');
  });
  it('clears old content and shows an error when access is revoked', async () => {
    const c=vm.createContext({fetch:async()=>({ok:false}),renderBrain(){},fitPane(){}});
    vm.runInContext(html.slice(html.indexOf('let brainMaps ='),html.indexOf('function renderBrain(')),c);
    await c.loadBrain({href:'/removed/'});
    expect(vm.runInContext('brainState',c)).toBeNull();
    expect(vm.runInContext('brainError',c)).toContain('access has changed');
  });
});
