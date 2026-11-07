import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { mapData, mergeMap, signedLink } from './cloud-data.js';

export function cloudConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(process.env.LIVING_MAP_CLOUD_CONFIG || path.join(os.homedir(), '.living-map-2/cloud.json'), 'utf8'));
    const url = new URL(config.url);
    if (url.protocol !== 'https:' && !(process.env.LIVING_MAP_CLOUD_TEST === '1' && ['localhost','127.0.0.1'].includes(url.hostname))) return null;
    if (!/^[a-f0-9]{64}$/.test(config.publishKey || '')) return null;
    return { ...config, url: url.origin };
  } catch { return null; }
}
// Public graph fields replace their previous values; local-only box metadata stays local.
export function installCloudData(state, data) {
  const nodes = (old, fresh) => fresh.map((n) => {
    const prior = old.find((p) => p.id === n.id), out = { ...prior };
    if (prior) for (const key of Object.keys(mapData({ nodes: [prior], edges: [] }).nodes[0])) delete out[key];
    Object.assign(out, n);
    if (n.inside) out.inside = { ...prior?.inside, ...n.inside, nodes: nodes(prior?.inside?.nodes || [], n.inside.nodes) };
    return out;
  });
  const graph = nodes(state.nodes, data.nodes);
  Object.assign(state, data, { nodes: graph });
  if (!data.start) delete state.start;
}
export function cloudMirror({ home, read, write, notify, config = cloudConfig() }) {
  const file = path.join(home, 'cloud.json');
  let saved; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let busy = null, error = '', closed = false;
  const persist = () => { fs.mkdirSync(home, { recursive: true }); const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(temp, file); };
  const address = () => saved?.published && saved.mode !== 'restricted' ? `${config?.url}/m/${saved.id}/?share=${signedLink(saved.id, saved.linkKey, config.publishKey)}` : null;
  const status = () => ({ configured: !!config, published: !!saved?.published, mode: saved?.mode, url: address(), busy: !!busy, error });
  const request = async (route, data, etag) => {
    if (!config) throw new Error('Cloud sharing is not set up on this Mac.');
    const r = await fetch(config.url + route, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.publishKey}`, 'x-map-owner': saved?.ownerKey || '', ...(etag ? { 'if-none-match': etag } : {}) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(30000) });
    if (r.status === 304) return null;
    const got = await r.json();
    if (!r.ok) throw new Error(got.error || 'Cloud sharing is unavailable. Your local changes are kept.');
    return got;
  };
  async function sync() {
    if (!saved?.published || !config || closed) return;
    if (busy) return busy;
    busy = (async () => {
      try {
        const sent = mapData(read());
        let got;
        if (JSON.stringify(sent) === JSON.stringify(saved.base)) {
          const state = await request(`/m/${saved.id}/api/state`, undefined, saved.revision ? `"${saved.revision}"` : undefined);
          if (!state) { error = ''; return; }
          got = { data: mapData(state), revision: state.cloudRevision };
        } else got = await request(`/m/${saved.id}/api/sync`, { base: saved.base, data: sent });
        const merged = mergeMap(sent, mapData(read()), got.data);
        saved.base = got.data; saved.revision = got.revision; persist();
        if (JSON.stringify(merged) !== JSON.stringify(mapData(read()))) write(merged);
        error = '';
      } catch (e) { error = e.message; }
      finally { busy = null; notify(); }
    })();
    return busy;
  }
  async function publish(mode) {
    if (!['view','edit','restricted'].includes(mode)) throw new Error('Choose view or edit.');
    if (busy) await busy;
    if (saved?.published) {
      // Permission changes must remain possible even when map edits conflict.
      const linkKey = saved.mode === 'restricted' ? crypto.randomBytes(32).toString('hex') : saved.linkKey;
      await request(`/m/${saved.id}/api/sharing`, { mode, linkKey });
      saved.mode = mode; saved.linkKey = linkKey; persist(); notify(); return status();
    }
    if (mode === 'restricted') return status();
    saved ||= { id: crypto.randomBytes(16).toString('hex'), ownerKey: crypto.randomBytes(32).toString('hex'), linkKey: crypto.randomBytes(32).toString('hex') };
    const sent = mapData(read()); saved.base ||= sent; persist();
    const got = await request('/api/maps', { id: saved.id, ownerKey: saved.ownerKey, linkKey: saved.linkKey, mode, data: sent });
    const merged = mergeMap(sent, mapData(read()), got.data);
    saved = { ...saved, published: true, mode, base: got.data, revision: got.revision }; persist();
    if (JSON.stringify(merged) !== JSON.stringify(mapData(read()))) write(merged);
    error = ''; notify(); return status();
  }
  // Poll only already-published maps. Each exchange merges changes made while offline.
  const timer = setInterval(() => { void sync(); }, 5000); timer.unref();
  return { status, publish, sync, close() { closed = true; clearInterval(timer); } };
}
