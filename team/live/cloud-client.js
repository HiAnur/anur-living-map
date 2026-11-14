import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { mapData, mergeMap, signedLink } from './cloud-data.js';
import { DATA } from './data-dir.js';

export function cloudConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(process.env.LIVING_MAP_CLOUD_CONFIG || path.join(DATA, 'cloud.json'), 'utf8'));
    const url = new URL(config.url);
    if (url.protocol !== 'https:' && !(process.env.LIVING_MAP_CLOUD_TEST === '1' && ['localhost','127.0.0.1'].includes(url.hostname))) return null;
    if (!/^[a-f0-9]{64}$/.test(config.publishKey || '')) return null;
    return { ...config, url: url.origin };
  } catch { return null; }
}
// Public graph fields replace their previous values; local-only box metadata stays local.
/** @param {MapState} state @param {any} data what mapData passed */
export function installCloudData(state, data) {
  /** @type {(old: any[], fresh: any[]) => any[]} */
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
/** @typedef {{ idToken: string, needs?: string }} Google the Google ID token this Mac's owner signed in with (googleIdentity in google.js) */
/**
 * @param {{ home: string, read: () => MapState, write: (data: any) => void, notify: () => void,
 *   config?: { url: string, publishKey: string, [more: string]: any } | null }} map
 */
export function cloudMirror({ home, read, write, notify, config = cloudConfig() }) {
  const file = path.join(home, 'cloud.json');
  /** @type {any} what cloud.json holds for this map */
  let saved; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not shared to the cloud yet */ }
  /** @type {Promise<void> | null} */
  let busy = null, error = '', closed = false, pending = Promise.resolve(), queued = 0;
  // Keep deletion, publication and polling in order so an in-flight sync cannot restore deleted sharing.
  /** @param {() => Promise<any>} task */
  const exclusive = (task) => { queued++; const next = pending.then(task); pending = next.catch(() => { /* the caller gets the error from `next`; the queue goes on */ }); return next.finally(() => { queued--; }); };
  const persist = () => { if (closed) return; fs.mkdirSync(home, { recursive: true }); const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(temp, file); };
  const address = () => config && saved?.published && saved.mode !== 'restricted' ? `${config?.url}/m/${saved.id}/?share=${signedLink(saved.id, saved.linkKey, config.publishKey)}` : null;
  // `access`: who the online copy belongs to and who it is shared with, as the cloud last said; none for a copy
  // published before Google sign-in, which anyone with its link may open until this Mac claims it
  const status = () => ({ configured: !!config, published: !!saved?.published, mode: saved?.mode, url: address(), busy: !!busy || queued > 0, error, access: saved?.access || null });
  /** @param {string} route @param {unknown} [data] @param {string} [etag] @param {boolean} [missingOK] @param {string} [idToken] */
  const request = async (route, data, etag, missingOK = false, idToken = '') => {
    if (!config) throw new Error('Cloud sharing is not set up on this Mac.');
    const r = await fetch(config.url + route, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.publishKey}`, 'x-map-owner': saved?.ownerKey || '', ...(etag ? { 'if-none-match': etag } : {}), ...(idToken ? { 'x-google-id-token': idToken } : {}) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(30000) });
    if (r.status === 304) return null;
    if (missingOK && r.status === 404) return {};
    const got = await r.json();
    if (!r.ok) throw Object.assign(new Error(got.error || 'Cloud sharing is unavailable. Your local changes are kept.'), r.status === 401 && idToken ? { needs: 'signin' } : {});
    if (got.access !== undefined && saved) saved.access = got.access;
    return got;
  };
  // A copy with an owner, and every new one, changes only with a fresh Google ID token from this Mac's sign-in.
  /** @param {Google | undefined} google @param {boolean} required */
  const proof = (google, required) => {
    if (google?.idToken || !required) return google?.idToken || '';
    throw Object.assign(new Error(google?.needs === 'update' ? 'The sign-in service must be updated before you can share online. Ask whoever runs it to deploy the latest version.' : 'Sign in with Google to share this map online.'), { needs: google?.needs || 'signin' });
  };
  async function sync() {
    if (!saved?.published || !config || closed) return;
    if (queued) return pending;
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
        if (closed) return;
        const merged = mergeMap(sent, mapData(read()), got.data);
        saved.base = got.data; saved.revision = got.revision; persist();
        if (JSON.stringify(merged) !== JSON.stringify(mapData(read()))) write(merged);
        error = '';
      } catch (/** @type {any} */ e) { error = e.message; }
      finally { busy = null; notify(); }
    })();
    return busy;
  }
  /** @param {string} mode @param {Google} [google] */
  async function publish(mode, google) {
    if (closed) throw new Error('This local map is closed.');
    if (!['view','edit','restricted'].includes(mode)) throw new Error('Choose view or edit.');
    if (busy) await busy;
    if (saved?.published) {
      // Permission changes must remain possible even when map edits conflict. A copy from before Google sign-in
      // is claimed by the first change made while signed in.
      const idToken = proof(google, !!saved.access?.owner);
      const linkKey = saved.mode === 'restricted' ? crypto.randomBytes(32).toString('hex') : saved.linkKey;
      const got = await request(`/m/${saved.id}/api/sharing`, { mode, linkKey }, undefined, false, idToken);
      saved.mode = got.mode || mode; saved.linkKey = linkKey; persist(); notify(); return status();
    }
    if (mode === 'restricted') return status();
    const idToken = proof(google, true);
    saved ||= { id: crypto.randomBytes(16).toString('hex'), ownerKey: crypto.randomBytes(32).toString('hex'), linkKey: crypto.randomBytes(32).toString('hex') };
    const sent = mapData(read()); saved.base ||= sent; persist();
    const got = await request('/api/maps', { id: saved.id, ownerKey: saved.ownerKey, linkKey: saved.linkKey, mode, data: sent }, undefined, false, idToken);
    if (closed) return status();
    const merged = mergeMap(sent, mapData(read()), got.data);
    saved = { ...saved, published: true, mode: got.mode || mode, base: got.data, revision: got.revision, access: got.access ?? null }; persist();
    if (JSON.stringify(merged) !== JSON.stringify(mapData(read()))) write(merged);
    error = ''; notify(); return status();
  }
  // who may open the online copy: one person's access by address ({ email, role }, role null to remove), or
  // whether anyone with the link can view it; the cloud checks each and answers with the whole list
  /** @param {{ person?: { email: string, role: string | null }, linkView?: boolean }} change @param {Google} [google] */
  async function share(change, google) {
    if (busy) await busy;
    if (!saved?.published) throw new Error('Publish this map online first.');
    const idToken = proof(google, true);
    const got = await request(`/m/${saved.id}/api/sharing`, change, undefined, false, idToken);
    saved.mode = got.mode || saved.mode; persist(); notify(); return status();
  }
  /** @param {Google} [google] */
  async function remove(google) {
    if (busy) await busy;
    if (!saved?.published) return status();
    try {
      // A lost response can leave the remote copy already deleted; retrying is safe.
      await request(`/m/${saved.id}/api/delete`, {}, undefined, true, proof(google, !!saved.access?.owner));
      saved = null; persist(); error = ''; notify();
      return status();
    } catch (/** @type {any} */ e) { error = e.message; notify(); throw e; }
  }
  // Poll only already-published maps. Each exchange merges changes made while offline.
  const timer = setInterval(() => { void sync(); }, 5000); timer.unref();
  return { status,
    /** @param {string} mode @param {Google} [google] */
    publish: (mode, google) => exclusive(() => publish(mode, google)),
    /** @param {any} change @param {Google} [google] */
    share: (change, google) => exclusive(() => share(change, google)),
    /** @param {Google} [google] */
    remove: (google) => exclusive(() => remove(google)), sync, close() { closed = true; clearInterval(timer); } };
}
