import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./maps.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function brainObjects('), html.indexOf('let brainMaps =')), ctx);
describe('Context objects', () => {
  it('omits the share-link credential without modifying stored data', () => {
    const state={title:'Launch',nodes:[],linkSharing:{mode:'edit',token:'private-credential'}};
    expect(ctx.brainObjects(state,'Duy').map.linkSharing).toEqual({mode:'edit'});
    expect(state.linkSharing.token).toBe('private-credential');
  });
  it('preserves nested map JSON and exposes decision and memory records', () => {
    const state = { nodes: [{ id:'a', label:'Launch', inside:{nodes:[{id:'b',label:'Test'}]} }],
      calls:[{id:'yes',node:'b',status:'answered'},{id:'wait',node:'a',status:'open'}],
      log:[{action:'confirmed',text:'Use a small pilot',node:'a',who:'Duy'}],
      memory:[{id:'rule',kind:'instruction'},{id:'fact',box:'b',kind:'memory'}] };
    const before=JSON.stringify(state), got=ctx.brainObjects(state,'Duy');
    expect(got.map).toEqual(state);
    expect(got.map.nodes[0].inside.nodes[0]).toEqual({id:'b',label:'Test'});
    expect(got.decisions.calls).toEqual(state.calls);
    expect(got.decisions.log).toEqual(state.log);
    expect(got.memory.map(m=>m.id)).toEqual(['rule','fact']);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('uses the chosen map visibility and hides inaccessible or removed box objects', () => {
    const got=ctx.brainObjects({people:[{id:'Duy',sees:'public'}],
      nodes:[{id:'a',area:'public'},{id:'b',area:'private',inside:{nodes:[{id:'c',area:'public'}]}}],
      calls:[{node:'a',status:'confirmed'},{node:'b',status:'answered'},{node:'gone',status:'answered'}],
      memory:[{id:'all'},{id:'visible',box:'a'},{id:'hidden',box:'b'},{id:'gone',box:'gone'}]},'Duy');
    expect(got.map.nodes.map(n=>n.id)).toEqual(['a']);
    expect(got.decisions.calls.map(c=>c.node)).toEqual(['a']);
    expect(got.memory.map(m=>m.id)).toEqual(['all','visible']);
  });
});

describe('Context loading', () => {
  it('ignores an older map response after another map is chosen', async () => {
    const pending=[];
    const c=vm.createContext({fetch:()=>new Promise(resolve=>pending.push(resolve)),renderBrain(){},fitPane(){}});
    vm.runInContext(html.slice(html.indexOf('let brainMaps ='),html.indexOf('function renderBrain(')),c);
    const old=c.loadBrain({href:'/old/'}), latest=c.loadBrain({href:'/new/'});
    pending[2]({ok:true,json:async()=>({title:'New'})});
    pending[3]({ok:true,json:async()=>({description:'New overview'})}); await latest;
    pending[0]({ok:true,json:async()=>({title:'Old'})});
    pending[1]({ok:true,json:async()=>({description:'Old overview'})}); await old;
    expect(vm.runInContext('brainState.title',c)).toBe('New');
    expect(vm.runInContext('brainDescription.description',c)).toBe('New overview');
  });
  it('clears old content and shows an error when access is revoked', async () => {
    const c=vm.createContext({fetch:async()=>({ok:false}),renderBrain(){},fitPane(){}});
    vm.runInContext(html.slice(html.indexOf('let brainMaps ='),html.indexOf('function renderBrain(')),c);
    await c.loadBrain({href:'/removed/'});
    expect(vm.runInContext('brainState',c)).toBeNull();
    expect(vm.runInContext('brainDescription',c)).toBeNull();
    expect(vm.runInContext('brainError',c)).toContain('access has changed');
  });
});
