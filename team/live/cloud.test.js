import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sealer } from '../cloud/access.js';
import { fakeGoogle } from '../cloud/google-id.harness.js';
import { createCloudServer } from '../cloud/server.js';
import { mapData, mergeMap, signedLink } from './cloud-data.js';
import { cloudMirror, installCloudData } from './cloud-client.js';

const base = () => ({ title: 'Sample map', desc: '', nodes: [{ id: 'a', label: 'Parent', x: 0, y: 0 }, { id: 'b', label: 'Child', x: 200, y: 0 }], edges: [{ from: 'a', to: 'b' }], comments: [] });
const publisher = '1'.repeat(64), owner = '2'.repeat(64), link = '3'.repeat(64), id = '4'.repeat(32), visitor = '5'.repeat(32);
// the owner's Google sign-in, and a teammate signed in on the cloud whom the owner lists by address
const google = fakeGoogle(), ownerToken = google.token('owner@example.com'), GOOGLE = { idToken: ownerToken };
const teammate = sealer(publisher).seal('session', { email: 'teammate@example.com', name: 'Teammate' });
class MemoryStore {
  records = new Map();
  async get(id) { return structuredClone(this.records.get(id) || null); }
  async put(id, value, version) {
    if ((this.records.get(id)?.version || null) !== version) throw Object.assign(new Error('Conflict'), { status: 409 });
    const record = { value: structuredClone(value), version: String(Number(version) + 1) }; this.records.set(id, record); return structuredClone(record);
  }
  async delete(id) { this.records.delete(id); }
}
const servers = [], mirrors = [], homes = [];
afterEach(() => { for (const m of mirrors.splice(0)) m.close(); for (const h of homes.splice(0)) fs.rmSync(h, { recursive: true, force: true }); });
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise((r) => s.close(r)); } });
async function start(store = new MemoryStore()) {
  const server = createCloudServer({ store, publishKey: publisher, publicUrl: 'http://localhost:4498', checkIdToken: google.check });
  servers.push(server); await new Promise((r) => server.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const call = (route, data, auth = false, origin = 'http://localhost:4498') => fetch(url + route, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin, ...(auth ? { authorization: `Bearer ${publisher}`, 'x-map-owner': owner, 'x-google-id-token': ownerToken } : { cookie: `lm_cloud_guest=${visitor}; lm_cloud_session=${teammate}` }) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  // published, with the teammate listed as `mode`: the link alone opens nothing
  const publish = async (mode = 'view') => {
    const r = await call('/api/maps', { id, data: base(), ownerKey: owner, linkKey: link, mode }, true); expect(r.status).toBe(201);
    expect((await call(`/m/${id}/api/sharing`, { person: { email: 'teammate@example.com', role: mode } }, true)).status).toBe(200);
  };
  const route = (suffix) => `/m/${id}/${suffix}?share=${signedLink(id, link, publisher)}`;
  return { call, publish, route, store, url };
}
describe('cloud map boundary', () => {
  it('uploads only the map and strips local metadata recursively', () => {
    const data = base(); data.linked = [{ file: '/private/chat' }]; data.threads = { private: ['secret'] }; data.nodes[0].file = '/private/repo'; data.nodes[0].session = 'private';
    data.nodes[0].inside = { nodes: [{ id: 'inside', label: 'Inside', x: 0, y: 0, file: '/secret' }], edges: [] };
    const clean = JSON.stringify(mapData(data)); expect(clean).not.toMatch(/private|secret|session|threads/);
  });
  it('publishes notes with placeholders and round-trips special text through sync', async () => {
    const { call, route } = await start();
    const data = base();
    data.nodes[0].desc = '- maps/<name>/state.json holds each map\n- Budget < $100 & size > 2';
    data.nodes[0].sub = 'A < B & C > D';
    data.nodes[0].label = 'Plan <draft>';
    data.edges[0].label = '<request>';
    data.nodes[0].inside = { nodes: [{id:'nested',label:'Nested <topic>',desc:'List<T>',x:0,y:0}],edges:[] };
    expect((await call('/api/maps', {id,data,ownerKey:owner,linkKey:link,mode:'edit'},true)).status).toBe(201);
    expect((await call(`/m/${id}/api/sharing`, { person: { email: 'teammate@example.com', role: 'view' } }, true)).status).toBe(200);
    const shared = await (await call(route('api/state'))).json();
    expect(shared.nodes).toEqual(mapData(data).nodes); expect(shared.edges).toEqual(data.edges);
    const local = structuredClone(data); local.nodes[1].label = 'Changed <locally>';
    const result = await call(route('api/sync'), {base:data,data:local},true);
    expect(result.status).toBe(200); expect((await result.json()).data.nodes).toEqual(mapData(local).nodes);
    const restored = base(); installCloudData(restored, mapData(local));
    expect(restored.nodes).toEqual(mapData(local).nodes);
    expect(() => mapData({...base(),nodes:[{...base().nodes[0],kind:'\" onclick=bad'}]})).toThrow('style');
  });
  it('preserves local metadata when cloud presentation changes', () => {
    const local = base(); local.nodes[0].file = '/private/file'; local.threads = { mine: ['private'] };
    const remote = base(); remote.nodes[0].label = 'Changed'; installCloudData(local, remote);
    expect(local.nodes[0]).toMatchObject({ label: 'Changed', file: '/private/file' }); expect(local.threads.mine).toEqual(['private']);
  });
  it('merges independent changes but rejects overlapping edits and dangling lines', () => {
    const original = base(), local = base(), remote = base(); local.nodes[0].label = 'Local'; remote.nodes[1].label = 'Remote';
    expect(mergeMap(original, local, remote).nodes.map((n) => n.label)).toEqual(['Local','Remote']);
    remote.nodes[0].label = 'Conflict'; expect(() => mergeMap(original, local, remote)).toThrow('both places');
    expect(() => mapData({ ...base(), nodes: [] })).toThrow('endpoint');
  });
  it('requires publisher credentials, blocks missing links and protects view links', async () => {
    const { call, publish, route } = await start();
    expect((await call('/api/maps', { data: base() })).status).toBe(401);
    await publish();
    expect((await call(`/m/${id}/api/state`)).status).toBe(403);
    expect((await call(route('api/state'))).status).toBe(200);
    expect((await call(route('api/act'), { type: 'renamebox', id: 'a', label: 'No', revision: 1 })).status).toBe(403);
    expect((await call(route('api/outbox'))).status).toBe(404);
    expect((await call(route('api/act'), { type: 'ask', text: 'run Claude', revision: 1 })).status).toBe(403);
  });
  it('persists edits and undo across server instances and rejects stale edits', async () => {
    const first = await start(); await first.publish('edit');
    const edit = { type: 'renamebox', id: 'a', label: 'Changed', revision: 1 };
    expect((await first.call(first.route('api/act'), edit)).status).toBe(200);
    expect((await first.call(first.route('api/act'), edit)).status).toBe(409);
    const second = await start(first.store);
    const snapshot = await (await second.call(second.route('api/state'))).json(); expect(snapshot.nodes[0].label).toBe('Changed');
    expect((await second.call(second.route('api/act'), { type: 'undo', revision: 2 })).status).toBe(200);
    expect((await (await first.call(first.route('api/state'))).json()).nodes[0].label).toBe('Parent');
  });
  it('blocks cross-origin edits and preserves text without treating it as markup', async () => {
    const { call, publish, route } = await start(); await publish('edit');
    expect((await call(route('api/act'), { type:'renamebox',id:'a',label:'Bad',revision:1 },false,'https://evil.test')).status).toBe(403);
    expect((await call(route('api/act'), { type:'renamebox',id:'a',label:'<img src=x onerror=alert(1)>',revision:1 })).status).toBe(200);
    expect((await call(route('api/act'), { type:'comment',node:'a',text:'2 < 3 and 4 > 1',x:0,y:0,revision:2 })).status).toBe(200);
    const data = await (await call(route('api/state'))).json(); expect(data.comments[0].msgs[0].text).toBe('2 < 3 and 4 > 1');
    expect(data.nodes[0].label).toBe('<img src=x onerror=alert(1)>');
    const page = await call(route('')); expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
  it('revokes links and merges offline changes without overwriting remote changes', async () => {
    const { call, publish, route } = await start(); await publish('edit');
    await call(route('api/act'), { type:'renamebox',id:'a',label:'Cloud',revision:1 });
    const local = base(); local.nodes[1].label = 'Offline';
    const result = await call(route('api/sync'), { base:base(), data:local },true); expect(result.status).toBe(200);
    expect((await result.json()).data.nodes.map((n)=>n.label)).toEqual(['Cloud','Offline']);
    expect((await call(route('api/sharing'), { mode:'restricted' },true)).status).toBe(200);
    expect((await call(route('api/state'))).status).toBe(403);
  });
});

it('syncs a published local map, survives restart, and revokes even with a conflict', async () => {
  const app = await start();
  fs.mkdirSync('cache', { recursive: true });
  const home = fs.mkdtempSync(path.resolve('cache/cloud-mirror-')); homes.push(home);
  const local = base(); local.threads = { mine: ['private'] }; local.nodes[0].file = '/private/file';
  const options = { home, read: () => local, write: (data) => installCloudData(local, data), notify(){}, config: { url: app.url, publishKey: publisher } };
  let mirror = cloudMirror(options); mirrors.push(mirror);
  await mirror.publish('edit', GOOGLE); await mirror.share({ person: { email: 'teammate@example.com', role: 'edit' } }, GOOGLE);
  const saved = JSON.parse(/** @type {any} */ (fs.readFileSync(path.join(home, 'cloud.json'))));
  const route = (p) => `/m/${saved.id}/${p}?share=${signedLink(saved.id, saved.linkKey, publisher)}`;
  expect((await app.call(route('api/act'), { type:'renamebox', id:'a', label:'Cloud', revision:1 })).status).toBe(200);
  local.nodes[1].label = 'Local';
  await mirror.sync();
  expect(local.nodes.map(n=>n.label)).toEqual(['Cloud','Local']); expect(local.threads.mine).toEqual(['private']); expect(local.nodes[0].file).toBe('/private/file');
  mirror.close();
  mirror = cloudMirror(options); mirrors.push(mirror);
  const state = await (await app.call(route('api/state'))).json();
  await app.call(route('api/act'), {type:'renamebox',id:'a',label:'Cloud again',revision:state.cloudRevision});
  local.nodes[0].label = 'Local conflict';
  await mirror.sync(); expect(mirror.status().error).toContain('both places'); expect(local.nodes[0].label).toBe('Local conflict');
  await mirror.publish('restricted', GOOGLE); expect((await app.call(route('api/state'))).status).toBe(403);
  const old = saved.linkKey; await mirror.publish('view', GOOGLE);
  const next = JSON.parse(/** @type {any} */ (fs.readFileSync(path.join(home, 'cloud.json')))); expect(next.linkKey).not.toBe(old);
  expect((await app.call(route('api/state'))).status).toBe(403);
});

it('deletes after an in-flight publish, keeps the local map, and republishes with a new link', async () => {
  const app=await start();const home=fs.mkdtempSync(path.resolve('cache/cloud-delete-'));homes.push(home);
  const local=base();local.threads={mine:['private']};const before=structuredClone(local);
  const options={home,read:()=>local,write:data=>installCloudData(local,data),notify(){},config:{url:app.url,publishKey:publisher}};
  let mirror=cloudMirror(options);mirrors.push(mirror);
  const publishing=mirror.publish('edit',GOOGLE);const deleting=mirror.remove(GOOGLE);
  /** @type {any} */ const published=await publishing;await deleting;
  expect(local).toEqual(before);expect(mirror.status()).toMatchObject({published:false,url:null});expect(app.store.records.size).toBe(0);
  mirror.close();mirror=cloudMirror(options);mirrors.push(mirror);await mirror.sync();expect(app.store.records.size).toBe(0);
  /** @type {any} */ const next=await mirror.publish('view',GOOGLE);expect(next.url).not.toBe(published.url);
  expect((await fetch(published.url.replace('http://localhost:4498',app.url))).status).toBe(404);
  expect(local).toEqual(before);
});
it('preserves sharing on deletion failure and safely retries a lost deletion response', async () => {
  const app=await start();const home=fs.mkdtempSync(path.resolve('cache/cloud-delete-'));homes.push(home);
  const local=base();const mirror=cloudMirror({home,read:()=>local,write:data=>installCloudData(local,data),notify(){},config:{url:app.url,publishKey:publisher}});mirrors.push(mirror);
  await mirror.publish('view',GOOGLE);const saved=JSON.parse(/** @type {any} */ (fs.readFileSync(path.join(home,'cloud.json'))));
  const route=`/m/${saved.id}/api/delete?share=${signedLink(saved.id,saved.linkKey,publisher)}`;
  expect((await app.call(route,{})).status).toBe(403);
  app.store.delete=async()=>{throw Object.assign(new Error('Offline'),{status:503});};
  await expect(mirror.remove(GOOGLE)).rejects.toThrow();expect(mirror.status().published).toBe(true);expect(app.store.records.size).toBe(1);
  app.store.delete=async(id)=>{app.store.records.delete(id);throw Object.assign(new Error('Response lost'),{status:503});};
  await expect(mirror.remove(GOOGLE)).rejects.toThrow();expect(mirror.status().published).toBe(true);
  await mirror.remove(GOOGLE);expect(mirror.status()).toMatchObject({published:false,url:null,error:''});expect(local).toEqual(base());
});

it('does not recreate archived local files when a pending cloud response arrives', async () => {
  const store = new MemoryStore(), app = await start(store);
  const root = fs.mkdtempSync(path.resolve('cache/cloud-close-')); homes.push(root);
  const home = path.join(root, 'map'); fs.mkdirSync(home);
  let local = base(), writes = 0;
  const mirror = cloudMirror({ home, read: () => local, write: (next) => { writes++; local = next; }, notify() {}, config: { url: app.url, publishKey: publisher } }); mirrors.push(mirror);
  await mirror.publish('edit', GOOGLE);
  /** @type {any} */ let release, entered; const arrived = new Promise((r) => { entered = r; }), gate = new Promise((r) => { release = r; });
  const get = store.get.bind(store); store.get = async (id) => { entered(); await gate; return get(id); };
  local.nodes[0].label = 'Local change';
  const syncing = mirror.sync(); await arrived;
  mirror.close(); fs.renameSync(home, path.join(root, 'archived'));
  release(); await syncing;
  expect(fs.existsSync(home)).toBe(false); expect(writes).toBe(0);
  expect(fs.existsSync(path.join(root, 'archived/cloud.json'))).toBe(true);
});

it('asks for Google before publishing or changing access, and keeps the list the cloud answers with', async () => {
  const app = await start(); const home = fs.mkdtempSync(path.resolve('cache/cloud-google-')); homes.push(home);
  const local = base();
  const mirror = cloudMirror({ home, read: () => local, write: (data) => installCloudData(local, data), notify() {}, config: { url: app.url, publishKey: publisher } }); mirrors.push(mirror);
  await expect(mirror.publish('view')).rejects.toMatchObject({ needs: 'signin' });
  await expect(mirror.publish('view', { idToken: '', needs: 'update' })).rejects.toThrow('must be updated');
  expect(app.store.records.size).toBe(0);
  const published = await mirror.publish('view', GOOGLE);
  expect(published).toMatchObject({ published: true, access: { owner: { email: 'owner@example.com' }, people: {}, linkView: false } });
  await expect(mirror.share({ linkView: true })).rejects.toMatchObject({ needs: 'signin' });
  // a token the cloud no longer takes sends you back through Google
  await expect(mirror.share({ linkView: true }, { idToken: google.token('owner@example.com', { exp: 1 }) })).rejects.toMatchObject({ needs: 'signin' });
  const shared = await mirror.share({ person: { email: 'teammate@example.com', role: 'edit' }, linkView: true }, GOOGLE);
  expect(shared.access).toEqual({ owner: { email: 'owner@example.com', name: 'Owner' }, people: { 'teammate@example.com': 'edit' }, linkView: true });
  expect(JSON.parse(/** @type {any} */ (fs.readFileSync(path.join(home, 'cloud.json')))).access.people).toEqual({ 'teammate@example.com': 'edit' });
  await expect(mirror.remove()).rejects.toMatchObject({ needs: 'signin' });
  expect((await mirror.remove(GOOGLE)).published).toBe(false);
});
