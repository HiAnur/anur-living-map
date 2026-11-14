import fs from 'node:fs';
import vm from 'node:vm';

import { expect, it } from 'vitest';

import { inviteEmail, onlineAccess, sharingLocation } from './page-share.js';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function shareAddress(){'), html.indexOf('async function setLinkRole('));
function harness(sharing = {}) {
  const copied = [], calls = [];
  const ctx = vm.createContext({ URL, CLOUD: false, CLOUD_STATUS: {configured:false}, cloudPublishing: false, cloudPublishConfirm:false, cloudDeleting:false, cloudDeleteConfirm:false, linkSaving:false, FILE:false, document:{querySelector:()=>({focus(){}})}, S: { people: [{ id: 'Duy', role: 'Admin' }], linkSharing: sharing }, ME: 'Duy', SIGNED_IN: 'Duy', LINK: '', location: { origin: 'http://localhost:4323', pathname: '/example/', search: '?as=Duy&chat=1' }, renderShare(){}, toast(){}, copyText: async (s) => { copied.push(s); return true; }, fetch: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return { ok: true, json: async () => ({ mode: 'view', token: 'test-token' }) }; } });
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
const statusContext={ sharingLocation };
it('labels storage truthfully before upload, online, and with a revoked link',()=>{
  const label=(s,o)=>statusContext.sharingLocation(s,o).label;
  expect(label({configured:true,published:false})).toBe('Only this Mac can open this link');
  expect(label(null)).toBe('Checking sharing status…');
  expect(label({published:false},{uploading:true})).toBe('Uploading to cloud…');
  expect(label({published:true,mode:'view',error:'Offline'})).toBe('Shared online');
  expect(label({published:true,mode:'restricted'})).toBe('In cloud · link off');
  expect(label(null,{cloud:true})).toBe('Shared online');
  expect(label(null,{file:true})).toBe('Downloaded file');
});
it('says plainly who can open a map kept on this Mac, and offers Publish online only where it can happen',()=>{
  const where=(s,o)=>sharingLocation(s,o);
  expect(where({configured:false,published:false},{owner:true})).toMatchObject({publish:false,detail:'This map runs on this Mac, so its link opens only here. To share it with someone else, send it as a file.'});
  expect(where({configured:true,published:false},{owner:true})).toMatchObject({publish:true});
  expect(where({configured:true,published:false},{owner:true}).detail).toContain('publish it online');
  expect(where({configured:true,published:false})).toMatchObject({publish:false});
  expect(where({configured:true,published:false}).detail).toContain('ask an owner to publish it online');
});

it('confirms online deletion, can cancel, and keeps failures retryable', async () => {
  const h=harness({mode:'edit',token:'local'}); h.ctx.CLOUD_STATUS={configured:true,published:true,url:'https://maps.example/shared'};
  await h.ctx.deleteOnlineCopy(); expect(h.ctx.cloudDeleteConfirm).toBe(true); expect(h.calls).toEqual([]);
  h.ctx.cancelCloudDelete(); expect(h.ctx.cloudDeleteConfirm).toBe(false); expect(h.calls).toEqual([]);
  await h.ctx.deleteOnlineCopy(true); expect(h.calls).toEqual([]);
  await h.ctx.deleteOnlineCopy();
  h.ctx.fetch=async()=>({ok:false,json:async()=>({error:'Offline'})});
  await h.ctx.deleteOnlineCopy(true); expect(h.ctx.CLOUD_STATUS.published).toBe(true); expect(h.ctx.cloudDeleting).toBe(false); expect(h.ctx.cloudDeleteConfirm).toBe(true);
  h.ctx.fetch=async(url,options)=>{h.calls.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({mode:'restricted',cloud:{configured:true,published:false,url:null}})};};
  await h.ctx.deleteOnlineCopy(true); expect(h.calls).toEqual([['api/cloud/delete',{confirm:true}]]); expect(h.ctx.CLOUD_STATUS.published).toBe(false); expect(h.ctx.S.linkSharing.mode).toBe('restricted');
  await h.ctx.copyMapLink(); expect(h.ctx.cloudPublishConfirm).toBe(true); expect(h.copied).toEqual([]);
});
it('does not offer deletion to guests or allow sharing during deletion', async () => {
  const h=harness();h.ctx.CLOUD_STATUS={published:true};h.ctx.CLOUD=true;
  await h.ctx.deleteOnlineCopy();expect(h.calls).toEqual([]);expect(h.ctx.cloudDeleteConfirm).toBe(false);
  h.ctx.CLOUD=false;h.ctx.cloudDeleting=true;await h.ctx.copyMapLink();await h.ctx.deleteOnlineCopy();expect(h.calls).toEqual([]);
});

it('lists the online copy\'s people for its owner, and says what an old link allows', () => {
  expect(onlineAccess({ published: false })).toBe(null);
  expect(onlineAccess({ published: true, mode: 'edit', access: null })).toEqual({ old: true, mode: 'edit' });
  const access = { owner: { email: 'ana@example.com', name: 'Ana' }, people: { 'zed@example.com': 'view', 'bo@example.com': 'edit', 'odd@example.com': 'admin' }, linkView: true };
  expect(onlineAccess({ published: true, mode: 'view', access })).toEqual({ old: false, owner: access.owner, linkView: true, linkOn: true,
    people: [{ email: 'bo@example.com', role: 'edit' }, { email: 'zed@example.com', role: 'view' }] });
  expect(onlineAccess({ published: true, mode: 'restricted', access })?.linkOn).toBe(false);
  expect(sharingLocation({ published: true, mode: 'view', access: { ...access, linkView: false } }).detail).toBe('Only the people you add can open its link, even when this Mac is off.');
  expect(sharingLocation({ published: true, mode: 'view', access }).detail).toContain('Anyone with the link can view it');
});
it('takes a whole address, lowercased, and nothing that is not one', () => {
  expect(inviteEmail('  Bo@Example.COM ')).toBe('bo@example.com');
  for (const typed of ['', 'bo', 'bo@example', 'bo@@example.com', 'b o@example.com', '<b>@example.com', 'bo@example..com', `${'a'.repeat(250)}@example.com`]) expect(inviteEmail(typed), typed).toBe('');
});
it('offers Google sign-in when publishing is refused for want of it', async () => {
  const h = harness(); h.ctx.CLOUD_STATUS = { configured: true, published: false, google: { ready: true } };
  h.ctx.fetch = async () => ({ ok: false, json: async () => ({ error: 'Sign in with Google to share this map online.', needs: 'signin' }) });
  await h.ctx.copyMapLink(true);
  expect(h.copied).toEqual([]); expect(h.ctx.CLOUD_STATUS.google).toEqual({ ready: false, needs: 'signin' });
});
