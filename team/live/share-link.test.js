import fs from 'node:fs';
import vm from 'node:vm';

import { expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function shareAddress(){'), html.indexOf('async function setLinkRole('));
function harness(sharing = {}) {
  const copied = [], calls = [];
  const ctx = vm.createContext({ URL, CLOUD: false, CLOUD_STATUS: {configured:false}, cloudPublishing: false, cloudPublishConfirm:false, document:{querySelector:()=>({focus(){}})}, S: { people: [{ id: 'Duy', role: 'Admin' }], linkSharing: sharing }, ME: 'Duy', SIGNED_IN: 'Duy', LINK: '', location: { origin: 'http://localhost:4323', pathname: '/example/', search: '?as=Duy&chat=1' }, renderShare(){}, toast(){}, copyText: async (s) => { copied.push(s); return true; }, fetch: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return { ok: true, json: async () => ({ mode: 'view', token: 'test-token' }) }; } });
  vm.runInContext(source, ctx);
  return { ctx, copied, calls };
}
it('creates a view link on first copy and excludes unrelated page parameters', async () => {
  const h = harness(); await h.ctx.copyMapLink();
  expect(h.calls).toEqual([['api/sharing', { mode: 'view', publish: false }]]);
  expect(h.copied).toEqual(['http://localhost:4323/example/?share=test-token']);
});
it('copies an existing edit link without changing its permission', async () => {
  const h = harness({ mode: 'edit', token: 'edit-token' }); await h.ctx.copyMapLink();
  expect(h.calls).toEqual([]); expect(h.copied[0]).toContain('?share=edit-token');
});
it('does not copy a broken address if link creation fails', async () => {
  const h = harness(); h.ctx.fetch = async () => ({ ok: false }); await h.ctx.copyMapLink();
  expect(h.copied).toEqual([]);
});

it('publishes an existing local link and copies the cloud address', async () => {
  const h = harness({ mode: 'edit', token: 'old-local-token' });
  h.ctx.CLOUD_STATUS = { configured: true, published: false };
  h.ctx.fetch = async (url, options) => {
    h.calls.push([url, JSON.parse(options.body)]);
    return { ok: true, json: async () => ({ mode: 'edit', token: 'local-token', cloud: { configured: true, published: true, url: 'https://maps.example/m/sample/?share=cloud-token' } }) };
  };
  await h.ctx.copyMapLink();
  expect(h.calls).toEqual([]);expect(h.copied).toEqual([]);expect(h.ctx.cloudPublishConfirm).toBe(true);
  await h.ctx.copyMapLink(true);
  expect(h.calls).toEqual([['api/sharing', { mode: 'edit', publish: true }]]);
  expect(h.copied).toEqual(['https://maps.example/m/sample/?share=cloud-token']);
  expect(h.ctx.cloudPublishing).toBe(false);
});


it('cancelling first publication keeps the map local and copies nothing', async () => {
  const h = harness();h.ctx.CLOUD_STATUS={configured:true,published:false};
  vm.runInContext(html.slice(html.indexOf('function cancelCloudPublish(){'),html.indexOf('function renderShare(){')),h.ctx);
  await h.ctx.copyMapLink();h.ctx.cancelCloudPublish();
  expect(h.ctx.cloudPublishConfirm).toBe(false);expect(h.calls).toEqual([]);expect(h.copied).toEqual([]);
});
it('copies an already-published link without asking again', async () => {
  const h=harness({mode:'view',token:'local'});h.ctx.CLOUD_STATUS={configured:true,published:true,url:'https://maps.example/shared'};
  await h.ctx.copyMapLink();expect(h.ctx.cloudPublishConfirm).toBe(false);expect(h.calls).toEqual([]);expect(h.copied).toEqual(['https://maps.example/shared']);
});
it('checks unknown status before asking, and never uploads on a failed check', async () => {
  const h=harness();h.ctx.CLOUD_STATUS=null;h.ctx.fetch=async ()=>{throw new Error('offline');};
  await h.ctx.copyMapLink();expect(h.copied).toEqual([]);expect(h.ctx.cloudPublishing).toBe(false);
  h.ctx.fetch=async ()=>({ok:true,json:async()=>({configured:true,published:false})});
  await h.ctx.copyMapLink();expect(h.ctx.cloudPublishConfirm).toBe(true);expect(h.copied).toEqual([]);
});
it('keeps an upload failure local and asks again on retry', async () => {
  const h=harness();h.ctx.CLOUD_STATUS={configured:true,published:false};h.ctx.fetch=async()=>({ok:false,json:async()=>({error:'Upload failed'})});
  await h.ctx.copyMapLink(true);expect(h.copied).toEqual([]);expect(h.ctx.CLOUD_STATUS.published).toBe(false);
  await h.ctx.copyMapLink();expect(h.ctx.cloudPublishConfirm).toBe(true);
});
const statusContext=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function sharingLocation('),html.indexOf('function cancelCloudPublish(')),statusContext);
it('labels storage truthfully before upload, online, and with a revoked link',()=>{
  const label=(s,o)=>statusContext.sharingLocation(s,o).label;
  expect(label({configured:true,published:false})).toBe('Local only');
  expect(label(null)).toBe('Checking sharing status…');
  expect(label({published:false},{uploading:true})).toBe('Uploading to cloud…');
  expect(label({published:true,mode:'view',error:'Offline'})).toBe('Shared online');
  expect(label({published:true,mode:'restricted'})).toBe('In cloud · link off');
  expect(label(null,{cloud:true})).toBe('Shared online');
  expect(label(null,{file:true})).toBe('Downloaded file');
});
