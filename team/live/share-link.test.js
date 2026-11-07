import fs from 'node:fs';
import vm from 'node:vm';

import { expect, it } from 'vitest';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function shareAddress(){'), html.indexOf('async function setLinkRole('));
function harness(sharing = {}) {
  const copied = [], calls = [];
  const ctx = vm.createContext({ URL, CLOUD: false, CLOUD_STATUS: null, cloudPublishing: false, S: { people: [{ id: 'Duy', role: 'Admin' }], linkSharing: sharing }, ME: 'Duy', SIGNED_IN: 'Duy', LINK: '', location: { origin: 'http://localhost:4323', pathname: '/example/', search: '?as=Duy&chat=1' }, renderShare(){}, toast(){}, copyText: async (s) => { copied.push(s); return true; }, fetch: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return { ok: true, json: async () => ({ mode: 'view', token: 'test-token' }) }; } });
  vm.runInContext(source, ctx);
  return { ctx, copied, calls };
}
it('creates a view link on first copy and excludes unrelated page parameters', async () => {
  const h = harness(); await h.ctx.copyMapLink();
  expect(h.calls).toEqual([['api/sharing', { mode: 'view', publish: true }]]);
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
  expect(h.calls).toEqual([['api/sharing', { mode: 'edit', publish: true }]]);
  expect(h.copied).toEqual(['https://maps.example/m/sample/?share=cloud-token']);
  expect(h.ctx.cloudPublishing).toBe(false);
});
