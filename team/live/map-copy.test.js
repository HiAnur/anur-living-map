import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { expect, it, vi } from 'vitest';

import { chats } from './agent.js';
import { copyMap } from './map-copy.js';
import { mapList } from './map-list.js';
import { mapsRoutes } from './maps-routes.js';
import { openMap } from './server.js';

it('duplicates a named or project map independently, persists its content and gives repeated copies distinct names', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-copy-'));
  const project = path.join(home, 'project');
  const original = { title: 'Launch plan', renamed: 'Launch plan', desc: 'Our next launch', start: 'launch', numbering: true,
    nodes: [{ id: 'launch', label: 'Launch plan', x: 20, y: 30, inside: { nodes: [{ id: 'detail', label: 'Details', x: 2, y: 3 }], edges: [] } }], edges: [],
    calls: [{ id: 'question', node: 'launch', status: 'open', text: 'When?' }], memory: [{ id: 'note', text: 'Keep the free trial' }],
    admins: ['Duy'], people: [], linkSharing: { mode: 'edit', token: 'original-secret' }, linked: [], threads: {} };
  for (const folder of [path.join(home, 'maps', 'launch'), path.join(project, '.living-map')]) {
    fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify(original));
  }
  const deps = { DIR: home, MAPS: path.join(home, 'maps'), PROJECT: project, PROJECTS: path.join(home, 'projects.json'), mapName: path.basename };
  let maps = mapList({ ...deps, openMap });
  const route = mapsRoutes({ ...deps, maps });
  const request = async (name, who = 'Duy', origin = 'http://localhost:4399') => {
    const req = Object.assign(Readable.from([JSON.stringify({ name })]), { method: 'POST', headers: {host:'localhost:4399',origin,'content-type':'application/json'} });
    let result;
    await route(req, {}, new URL('http://localhost:4399/api/maps/duplicate'), who, (status, body) => { result = {status, body}; return true; });
    return /** @type {any} */ (result);
  };
  const close = () => { for (const [, map] of maps.everyMap()) map.close(); };
  const follow = vi.spyOn(chats, 'follow');
  try {
    expect((await request('launch', '')).status).toBe(401);
    expect((await request('launch', 'Duy', 'https://elsewhere.example')).status).toBe(403);
    expect((await request('../launch')).status).toBe(404);
    expect((await request('missing')).status).toBe(404);
    expect((await request('launch', 'Other')).status).toBe(403);
    const first = await request('launch');
    expect(first).toEqual({status:200,body:{name:'launch-copy',href:'/launch-copy/'}});
    const copied = maps.mapCalled(first.body.name).snapshot();
    expect(copied).toMatchObject({title:'Launch plan (copy)',renamed:'Launch plan (copy)',desc:original.desc,start:original.start,numbering:true,nodes:original.nodes,calls:original.calls,memory:original.memory,admins:['Duy'],linked:[],linkSharing:{mode:'restricted'}});
    expect(copied.linkSharing.token).toBeUndefined();
    expect((await request('launch')).body.name).toBe('launch-copy-2');
    expect(maps.mapCalled('launch-copy-2').snapshot().title).toBe('Launch plan (copy 2)');
    const projectCopy = await request('project');
    expect(projectCopy.body.name).toBe('project-copy');
    expect(maps.mapCalled('project-copy').snapshot().title).toBe('Launch plan (copy 3)');
    expect(maps.mapCalled(first.body.name).editShared({type:'renamebox',id:'launch',label:'Only the copy',by:'Duy'}).ok).toBe(true);
    expect(maps.mapCalled(first.body.name).snapshot().nodes[0].label).toBe('Only the copy');
    expect(maps.mapCalled('launch').snapshot().nodes[0].label).toBe('Launch plan');
    expect(maps.projects.get('project').snapshot().nodes[0].label).toBe('Launch plan');
    expect(JSON.parse(fs.readFileSync(path.join(home,'maps','launch','state.json'),'utf8')).nodes).toEqual(original.nodes);
    expect(follow).not.toHaveBeenCalled();
    close(); maps = mapList({ ...deps, openMap });
    expect(maps.mapCalled('launch-copy').snapshot().title).toBe('Launch plan (copy)');
    expect(maps.mapCalled('launch-copy').snapshot().nodes).toMatchObject(original.nodes);
  } finally { follow.mockRestore(); close(); fs.rmSync(home,{recursive:true,force:true}); }
});

it('copies system facts and nested content without live chats, sharing credentials or Action execution sessions', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-system-copy-'));
  const source = path.join(home, 'source'), dir = path.join(home, 'copy');
  fs.mkdirSync(source);
  const files = ['system-facts.json','system-drawn.json','system-report.json','system-folders.json'];
  for (const file of [...files,'cloud.json','system-pending.json','outbox.md']) fs.writeFileSync(path.join(source,file),'{}');
  const action = {id:'old-revision',stage:'running',brief:{goal:'Ship it'},session:'original-session',auto:true,autoPrepare:true,progress:'Running',completion:{status:'completed'}};
  const state = { title:'System',nodes:[{id:'repo',label:'Repo',inside:{nodes:[{id:'task',label:'Task',action}],edges:[]}}],edges:[],
    drawing:{status:'running',progress:[{stage:'reading'}]}, linked:[{session:'live'}], starting:{by:'Duy'}, threads:{'@Duy':[{text:'Hello'}]}, meeting:{status:'recording'},redraw:{count:1},linkSharing:{mode:'edit',token:'secret'} };
  try {
    copyMap({state,title:'System (copy)',who:'Duy',source,dir});
    const copy = JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));
    expect(fs.readdirSync(dir).sort()).toEqual([...files,'state.json'].sort());
    expect(copy).toMatchObject({title:'System (copy)',admins:['Duy'],linked:[],threads:{},drawing:{status:'stopped'},linkSharing:{mode:'restricted'}});
    for (const key of ['starting','meeting','redraw']) expect(copy[key]).toBeUndefined();
    const a = copy.nodes[0].inside.nodes[0].action;
    expect(a).toMatchObject({stage:'ready',brief:action.brief});
    for (const key of ['session','auto','autoPrepare','progress','completion']) expect(a[key]).toBeUndefined();
    expect(a.id).not.toBe(action.id);
    expect(state.nodes[0].inside.nodes[0].action).toEqual(action);
    expect(state.drawing.status).toBe('running');
    expect(state.linked).toEqual([{session:'live'}]);
  } finally { fs.rmSync(home,{recursive:true,force:true}); }
});
