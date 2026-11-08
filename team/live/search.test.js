import fs from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function searchBoxes('), html.indexOf('let searchOpen =')), ctx);
const state = {nodes:[
  {id:'root',label:'Launch',sub:'First small test',desc:'Invite cafés in Hanoi',inside:{nodes:[{id:'nested',label:'Interview',sub:'Learn from partners'}],edges:[]}},
  {id:'child',label:'Partners',sub:'Local rules and money',desc:'Ask about food licences'},
  {id:'private',label:'Private partners',sub:'Hidden description',private:true}
],edges:[{from:'root',to:'child'}]};
const search = (q, additions={nodes:[],edges:[]}) => ctx.searchBoxes(state, additions, q, n=>!n.private);
describe('map search',()=>{
  it('matches names, descriptions and notes, with name matches first',()=>{
    expect(search('partners').map(r=>r.id)).toEqual(['child','nested']);
    expect(search('money')[0]).toMatchObject({id:'child',snippet:'Local rules and money',location:'Launch'});
    expect(search('licences')[0].snippet).toBe('Ask about food licences');
  });
  it('finds folded and nested boxes without depending on the rendered scope',()=>{
    expect(search('interview')[0]).toMatchObject({id:'nested',container:'root',location:'Launch'});
    expect(search('local')[0].container).toBe('system');
  });
  it('ignores accents and case, and allows words across fields',()=>{
    expect(search('  CAFE   LAUNCH ').map(r=>r.id)).toEqual(['root']);
    expect(search('')[0]).toBeUndefined();
    expect(search('unknown')).toEqual([]);
  });
  it('excludes inaccessible boxes and their contents',()=>{
    expect(search('hidden')).toEqual([]);
    expect(search('private')).toEqual([]);
  });
  it('includes proposed boxes with context and does not mutate the map',()=>{
    const before=JSON.stringify(state);
    expect(search('founder',{nodes:[{id:'new',label:'Founder',sub:'Decision maker'}],edges:[{from:'root',to:'new'}]})[0]).toMatchObject({id:'new',location:'Launch'});
    expect(JSON.stringify(state)).toBe(before);
  });
});
