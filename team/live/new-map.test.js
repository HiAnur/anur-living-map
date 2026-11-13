import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { expect, it, vi } from 'vitest';

import { chats } from './agent.js';
import { mapList } from './map-list.js';
import { mapsRoutes } from './maps-routes.js';
import { openMap } from './server.js';

it('creates distinct blank maps without Claude, keeps them after reopening, and allows manual topics', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-new-'));
  const launch = vi.spyOn(chats, 'openNew').mockImplementation(() => {});
  const deps = { DIR: home, PROJECT: '', PROJECTS: path.join(home, 'projects.json'), mapName: path.basename };
  const maps = mapList({ ...deps, openMap });
  const routes = mapsRoutes({ ...deps, maps });
  const request = async (data, who = 'Duy') => {
    const req = Object.assign(Readable.from([JSON.stringify(data)]), { method: 'POST', headers: {} });
    let result;
    await routes(req, {}, new URL('http://localhost/api/newmap'), who, (status, body) => { result = {status, body}; return true; });
    return /** @type {any} */ (result);
  };
  try {
    expect((await request({ blank: true }, '')).status).toBe(401);
    expect((await request({})).status).toBe(400);
    expect((await request({ blank: 'true' })).status).toBe(400);
    expect(maps.everyMap()).toEqual([]);
    // A registered code folder may already own this address without a directory in maps/.
    maps.projects.set('untitled-map', { summary: () => ({title:'Existing project'}) });
    const first = await request({ blank: true });
    expect(first).toEqual({ status:200, body:{name:'untitled-map-2',href:'/untitled-map-2/'} });
    const second = await request({ blank: true });
    expect(second.body.name).toBe('untitled-map-3');
    expect(launch).not.toHaveBeenCalled();
    const map = maps.mapCalled(first.body.name);
    expect(map.snapshot()).toMatchObject({ title:'Untitled map', renamed:'Untitled map', nodes:[], edges:[], threads:{} });
    expect(map.snapshot().starting).toBeUndefined();
    expect(map.snapshot().linked || []).toEqual([]);
    const folder = path.join(home, 'maps', first.body.name);
    const saved = JSON.parse(fs.readFileSync(path.join(folder, 'state.json'), 'utf8'));
    expect(saved.nodes).toEqual([]);
    map.close(); maps.named.delete(first.body.name);
    const reopened = maps.mapCalled(first.body.name);
    expect(reopened.snapshot().title).toBe('Untitled map');
    const result = reopened.editShared({ type:'add', label:'Launch plan', x:0, y:0, view:'system', by:'Duy' });
    expect(result.ok).toBe(true);
    expect(reopened.snapshot().nodes).toEqual([expect.objectContaining({label:'Launch plan'})]);
    expect(maps.mapCalled(second.body.name).snapshot().nodes).toEqual([]);
    expect(launch).not.toHaveBeenCalled();
    // a blank map may build on a system map: its chats then read that map as background
    fs.mkdirSync(path.join(home, 'maps', 'shop-system'), { recursive: true });
    fs.writeFileSync(path.join(home, 'maps', 'shop-system', 'state.json'), JSON.stringify({ title: 'Shop system', nodes: [], edges: [], drawing: { status: 'done', at: 1, repos: 3 } }));
    expect((await request({ blank: true, buildsOn: second.body.name })).status).toBe(400);
    expect((await request({ blank: true, buildsOn: 'nowhere' })).status).toBe(400);
    const work = await request({ blank: true, buildsOn: 'shop-system' });
    expect(maps.mapCalled(work.body.name).snapshot()).toMatchObject({ buildsOn: { name: 'shop-system', title: 'Shop system' }, contextMapIds: ['shop-system'] });
  } finally {
    maps.main?.close(); for (const map of maps.named.values()) map.close();
    launch.mockRestore(); fs.rmSync(home, {recursive:true,force:true});
  }
});

it('links the chat a click opened even when the server restarted before the chat appeared', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'living-map-opened-'));
  const transcript = path.join(home, 'chat-1234abcd.jsonl');
  fs.writeFileSync(transcript, '{}\n');
  const find = vi.spyOn(chats, 'findNewChat').mockImplementation(() => transcript);
  const isChat = vi.spyOn(chats, 'isChat').mockImplementation(() => true);
  const follow = vi.spyOn(chats, 'follow').mockImplementation(() => /** @type {any} */ ({ stop() {}, msgs: () => [], model: () => '', status: () => '' }));
  const at = Date.now() - 20 * 60e3;
  const map = openMap({ name: 'sprint', home, initialState: { title: 'Sprint', nodes: [], edges: [], threads: {}, starting: { prompt: 'build it', by: 'Duy', at } } });
  try {
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ since: at - 2000, holding: 'map:sprint' }));
    expect(map.snapshot().starting).toBeUndefined();
    expect(map.snapshot().linked[0]).toMatchObject({ session: 'chat-1234abcd', owner: 'Duy' });
  } finally {
    map.close(); find.mockRestore(); isChat.mockRestore(); follow.mockRestore(); fs.rmSync(home, { recursive: true, force: true });
  }
});
