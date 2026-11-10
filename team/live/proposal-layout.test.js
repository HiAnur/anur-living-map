import { describe, expect, it } from 'vitest';

import { appendProposed } from './proposal-layout.js';

const fixture = (direction = 1) => ({
  nodes: [
    {id:'root',label:'Root',x:0,y:0},
    {id:'categories',label:'Categories',x:240*direction,y:0},
    {id:'pm',label:'PM',x:475*direction,y:-50},
    {id:'engineer',label:'Software Engineer',x:475*direction,y:50},
    {id:'pm-child',label:'Existing task',x:710*direction,y:-50},
    {id:'smb',label:'SMB',x:240*direction,y:200},
    {id:'company',label:'Company',x:475*direction,y:200},
    {id:'other',label:'Other side',x:-240*direction,y:0},
  ],
  edges:[['root','categories'],['categories','pm'],['categories','engineer'],['pm','pm-child'],['root','smb'],['smb','company'],['root','other']].map(([from,to])=>({from,to})),
});
describe('appending proposed topics',()=>{
  it.each([1,-1])('appends in existing columns and makes room below whole branches on side %s',direction=>{
    const {nodes,edges}=fixture(direction), before=structuredClone(nodes);
    const fresh=[{id:'founder',label:'Founder'},{id:'pm-new',label:'PM work'},{id:'engineer-new',label:'Engineer work'}];
    const links=[{from:'categories',to:'founder'},{from:'pm',to:'pm-new'},{from:'engineer',to:'engineer-new'}];
    const moves=appendProposed(nodes,edges,fresh,links);
    expect(nodes).toEqual(before);
    expect(fresh[0].x).toBe(475*direction);expect(fresh[1].x).toBe(710*direction);expect(fresh[2].x).toBe(710*direction);
    const all=nodes.map(n=>({...n,...moves.find(m=>m.id===n.id)})).concat(/** @type {any} */ (fresh)), /** @type {(id: string) => any} */ get=id=>all.find(n=>n.id===id);
    expect(get('pm-new').y).toBeGreaterThan(get('pm-child').y);
    expect(get('engineer').y).toBeGreaterThan(get('pm-new').y);
    expect(get('founder').y).toBeGreaterThan(get('engineer-new').y);
    expect(get('smb').y).toBeGreaterThan(get('founder').y);
    expect(get('company').y-get('smb').y).toBe(0);
    expect(moves.some(n=>['root','categories','other'].includes(n.id))).toBe(false);
  });
  it('handles proposed parents before their children regardless of response order',()=>{
    const {nodes,edges}=fixture(), fresh=[{id:'detail',label:'Detail'},{id:'new',label:'New branch'}];
    appendProposed(nodes,edges,fresh,[{from:'new',to:'detail'},{from:'categories',to:'new'}]);
    expect(fresh.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y))).toBe(true);
    expect(fresh[0].x).toBeGreaterThan(fresh[1].x);expect(fresh[0].y).toBe(fresh[1].y);
  });
  it('reserves height for wrapped titles and descriptions and produces a stable preview',()=>{
    const {nodes,edges}=fixture();
    const fresh=[{id:'long',label:'A long proposed topic title that needs multiple lines to explain the scope',sub:'The detailed description of what this particular topic should cover in the planning process.'},{id:'next',label:'Next'}];
    const links=fresh.map(n=>({from:'categories',to:n.id}));
    const moves=appendProposed(nodes,edges,fresh,links), first=structuredClone(fresh);
    expect(fresh[1].y-fresh[0].y).toBeGreaterThan(100);
    expect(appendProposed(nodes,edges,fresh,links)).toEqual(moves);expect(fresh).toEqual(first);
  });
  it('does not follow cycles or reposition unrelated existing boxes',()=>{
    const {nodes,edges}=fixture();edges.push({from:'pm',to:'categories'});
    const fresh=[{id:'new',label:'New'}];
    const moves=appendProposed(nodes,edges,fresh,[{from:'pm',to:'new'}]);
    expect(Number.isFinite(fresh[0].y)).toBe(true);expect(moves.some(n=>n.id==='other')).toBe(false);
  });
});
