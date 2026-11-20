import { describe, expect, it } from 'vitest';

import { openTestMap, send } from './map.harness.js';
import { mapData } from './cloud-data.js';
import { emailPeople, todosForEmail } from './page-share.js';

const initial = () => ({ title: 'Design', start: 'start',
  people: [{ id: 'Sam', sees: 'web' }],
  nodes: [
    { id: 'start', label: 'Design', x: 0, y: 0 },
    { id: 'flag', label: 'Flag', area: 'web', x: 250, y: 0, design: { flag: 'red' } },
    { id: 'progress', label: 'Progress', area: 'web', x: 250, y: 100, design: { progress: '0' } },
    { id: 'align', label: 'Alignment', area: 'api', x: 250, y: 200, design: { align: 'top' } },
  ], edges: [],
});

describe('designing a selection', () => {
  it('keeps all priority levels through export, clearing and undo without changing other markers', async () => {
    const {map,close} = openTestMap(initial());
    try {
      for (const value of ['one-thing','high','medium','low']) {
        expect((await send(map,'Duy',{type:'designbox',ids:['flag','progress'],field:'priority',value})).status).toBe(200);
        const exported = mapData(map.snapshot());
        expect(exported.nodes[1].design).toEqual({flag:'red',priority:value});
        expect(exported.nodes[2].design).toEqual({progress:'0',priority:value});
      }
      expect((await send(map,'Duy',{type:'designbox',id:'flag',field:'priority',value:'urgent'})).status).toBe(400);
      expect((await send(map,'Duy',{type:'designbox',ids:['flag','progress'],field:'priority',value:''})).status).toBe(200);
      expect(map.snapshot().nodes[1].design).toEqual({flag:'red'});
      expect((await send(map,'Duy',{type:'undo'})).status).toBe(200);
      expect(map.snapshot().nodes[1].design).toEqual({flag:'red',priority:'low'});
    } finally { close(); }
  });
  it('assigns shared email identities, preserves them in exports, and lists nested personal to-dos', async () => {
    const assignmentPeople = emailPeople({owner:{email:'duy@example.com',name:'Duy'},people:{'sam@example.com':'edit'}});
    const state = /** @type {any} */ (initial());
    state.nodes[1].inside = {nodes:[{id:'nested',label:'Nested task',x:0,y:0,design:{person:'sam@example.com'}}],edges:[]};
    const {map,close} = openTestMap({...state,assignmentPeople});
    try {
      expect((await send(map,'Duy',{type:'designbox',ids:['flag','progress'],field:'person',value:'sam@example.com'})).status).toBe(200);
      const exported = mapData(map.snapshot());
      expect(exported.nodes[1].design).toEqual({flag:'red',person:'sam@example.com'});
      expect(todosForEmail(exported,'sam@example.com').map((t) => t.id)).toEqual(['flag','nested','progress']);
      expect(todosForEmail(exported,'duy@example.com')).toEqual([]);
      expect((await send(map,'Duy',{type:'designbox',id:'flag',field:'progress',value:'100'})).status).toBe(200);
      expect(todosForEmail(map.snapshot(),'sam@example.com').at(-1)).toMatchObject({id:'flag',done:true});
      for (const value of ['unknown@example.com','sam','sam@example.com"><script>']) {
        expect((await send(map,'Duy',{type:'designbox',id:'flag',field:'person',value})).status).toBe(400);
      }
      expect((await send(map,'Duy',{type:'designbox',id:'flag',field:'person',value:''})).status).toBe(200);
      expect(map.snapshot().nodes[1].design).toEqual({flag:'red',progress:'100'});
    } finally { close(); }
  });
  it('changes only the chosen field on every selected box and undoes it together', async () => {
    const { map, close } = openTestMap(initial());
    try {
      const before = map.snapshot().nodes.map((n) => n.design);
      expect((await send(map, 'Duy', { type: 'designbox', ids: ['flag', 'progress', 'align'], field: 'flag', value: 'green' })).status).toBe(200);
      expect(map.snapshot().nodes.map((n) => n.design)).toEqual([
        undefined, { flag: 'green' }, { flag: 'green', progress: '0' }, { flag: 'green', align: 'top' },
      ]);
      expect((await send(map, 'Duy', { type: 'undo' })).status).toBe(200);
      expect(map.snapshot().nodes.map((n) => n.design)).toEqual(before);
      expect((await send(map, 'Duy', { type: 'redo' })).status).toBe(200);
      expect((await send(map, 'Duy', { type: 'designbox', ids: ['flag', 'progress', 'align'], field: 'flag', value: '' })).status).toBe(200);
      expect(map.snapshot().nodes.map((n) => n.design)).toEqual([
        undefined, undefined, { progress: '0' }, { align: 'top' },
      ]);
      expect((await send(map, 'Duy', { type: 'designbox', id: 'align', field: 'align', value: 'center' })).status).toBe(200);
      expect(map.snapshot().nodes[3].design).toBeUndefined();
    } finally { close(); }
  });

  it('refuses the whole change if any box is missing, inaccessible, or the request is invalid', async () => {
    const { map, close } = openTestMap(initial());
    try {
      const before = map.snapshot().nodes;
      for (const change of [
        { ids: ['flag', 'align'] }, { ids: ['flag', 'missing'] }, { ids: [] },
        { ids: ['flag'], value: 'invalid' }, { ids: ['flag'], field: 'format' }, {},
      ]) {
        expect((await send(map, 'Sam', { type: 'designbox', field: 'flag', value: 'green', ...change })).status).toBe(400);
        expect(map.snapshot().nodes).toEqual(before);
      }
    } finally { close(); }
  });
});
