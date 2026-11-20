import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { mapData, mergeMap, signedLink } from './cloud-data.js';
import { cloudLive } from './cloud-live.js';
import { DATA } from './data-dir.js';

export function cloudConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(process.env.LIVING_MAP_CLOUD_CONFIG || path.join(DATA, 'cloud.json'), 'utf8'));
    const url = new URL(config.url);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const loopback = host === 'localhost' || host.endsWith('.localhost') || host.startsWith('127.') || host === '[::1]';
    const testServer = process.env.LIVING_MAP_CLOUD_TEST === '1' && ['localhost', '127.0.0.1'].includes(host) && url.protocol === 'http:';
    if (!testServer && (url.protocol !== 'https:' || loopback)) return null;
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
  if (!data.mindLayout) delete state.mindLayout;
  if (!data.numbering) delete state.numbering;
}
/** @typedef {{ idToken: string, needs?: string }} Google the Google ID token this Mac's owner signed in with (googleIdentity in google.js) */
/**
 * @param {{ home: string, read: () => MapState, write: (data: any) => void, notify: () => void,
 *   pointer?: (message:any) => void, config?: { url: string, publishKey: string, [more: string]: any } | null }} map
 */
export function cloudMirror({ home, read, write, notify, pointer = () => {}, config = cloudConfig() }) {
  // An explicitly cloud-enabled preview owns separate records, even when its map folder was copied from the everyday app.
  const records = process.env.LIVING_MAP_CLOUD_COPIES;
  const file = records ? path.join(records, crypto.createHash('sha256').update(path.resolve(home)).digest('hex') + '.json') : path.join(home, 'cloud.json');
  /** @type {any} what cloud.json holds for this map */
  let saved; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* not shared to the cloud yet */ }
  /** @type {Promise<void> | null} */
  let busy = null, error = '', closed = false, pending = Promise.resolve(), queued = 0;
  let stateEtag = '';
  /** @type {string[]} visitors currently viewing the cloud copy, kept only in memory */
  let here = [];
  // Keep deletion, publication and polling in order so an in-flight sync cannot restore deleted sharing.
  /** @param {() => Promise<any>} task */
  const exclusive = (task) => { queued++; const next = pending.then(task); pending = next.catch(() => { /* the caller gets the error from `next`; the queue goes on */ }); return next.finally(() => { queued--; }); };
  const persist = () => { if (closed) return; fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify(saved), { mode: 0o600 }); fs.renameSync(temp, file); };
  const address = () => config && saved?.published && saved.mode !== 'restricted' ? `${config?.url}/m/${saved.id}/?share=${signedLink(saved.id, saved.linkKey, config.publishKey)}` : null;
  // `access`: who the online copy belongs to and who it is shared with, as the cloud last said; none for a copy
  // published before Google sign-in, which anyone with its link may open until this Mac claims it
  const status = () => ({ configured: !!config, published: !!saved?.published, mode: saved?.mode, url: address(), busy: !!busy || queued > 0, error, access: saved?.access || null, here: saved?.published && saved.mode !== 'restricted' ? here : [] });
  /** @param {string} route @param {unknown} [data] @param {string} [etag] @param {boolean} [missingOK] @param {string} [idToken] */
  const request = async (route, data, etag, missingOK = false, idToken = '') => {
    if (!config) throw new Error('Cloud sharing is not set up on this Mac.');
    const r = await fetch(config.url + route, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.publishKey}`, 'x-map-owner': saved?.ownerKey || '', ...(etag ? { 'if-none-match': etag } : {}), ...(idToken ? { 'x-living-map-google-id-token': idToken } : {}) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(30000) });
    if (r.status === 304) return null;
    if (missingOK && r.status === 404) return {};
    const got = await r.json();
    if (!r.ok) throw Object.assign(new Error(got.error || 'Cloud sharing is unavailable. Your local changes are kept.'), r.status === 401 && idToken ? { needs: 'signin' } : {});
    if (route.endsWith('/api/state')) stateEtag = r.headers.get('etag') || '';
    if (got.access !== undefined && saved) saved.access = got.access;
    if (got.here !== undefined) here = Array.isArray(got.here) ? got.here.filter((/** @type {unknown} */ name) => typeof name === 'string') : [];
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
        const base = { ...saved.base };
        if (saved.legacyLayout) delete base.mindLayout;
        const sendChanges = () => request(`/m/${saved.id}/api/sync`, { base, data: sent, sharedLayout: true });
        let got;
        if (JSON.stringify(sent) === JSON.stringify(saved.base)) {
          const state = await request(`/m/${saved.id}/api/state`, undefined, stateEtag || undefined);
          if (!state) { error = ''; return; }
          got = { data: mapData(state), revision: state.cloudRevision, sharedLayout: state.sharedLayout };
          if (state.sharedLayout && saved.legacyLayout && sent.mindLayout && !got.data.mindLayout) {
            got = await sendChanges();
          }
        } else got = await sendChanges();
        if (closed) return;
        // During a rolling upgrade the old cloud omits layout from every response.
        if (!got.sharedLayout && sent.mindLayout && !got.data.mindLayout) got.data.mindLayout = sent.mindLayout;
        const merged = mergeMap(sent, mapData(read()), got.data);
        saved.legacyLayout = !got.sharedLayout && !!sent.mindLayout; saved.base = got.data; saved.revision = got.revision; persist();
        if (JSON.stringify(merged) !== JSON.stringify(mapData(read()))) write(merged);
        error = '';
      } catch (/** @type {any} */ e) { error = e.message; here = []; }
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
      const got = await request(`/m/${saved.id}/api/sharing`, { mode, linkKey, ...(mode !== 'restricted' ? { linkView: true, linkRole: mode } : {}) }, undefined, false, idToken);
      saved.mode = got.mode || mode; saved.linkKey = linkKey; persist(); notify(); return status();
    }
    if (mode === 'restricted') return status();
    const idToken = proof(google, true);
    saved ||= { id: crypto.randomBytes(16).toString('hex'), ownerKey: crypto.randomBytes(32).toString('hex'), linkKey: crypto.randomBytes(32).toString('hex') };
    const sent = mapData(read()); saved.base ||= sent; persist();
    const got = await request('/api/maps', { id: saved.id, ownerKey: saved.ownerKey, linkKey: saved.linkKey, mode, linkView: true, linkRole: mode, data: sent }, undefined, false, idToken);
    if (closed) return status();
    if (!got.sharedLayout && sent.mindLayout && !got.data.mindLayout) got.data.mindLayout = sent.mindLayout;
    const merged = mergeMap(sent, mapData(read()), got.data);
    saved = { ...saved, published: true, legacyLayout: !got.sharedLayout && !!sent.mindLayout, mode: got.mode || mode, base: got.data, revision: got.revision, access: got.access ?? null }; persist();
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
    const linkKey = saved.mode === 'restricted' && change.person?.role ? crypto.randomBytes(32).toString('hex') : saved.linkKey;
    const got = await request(`/m/${saved.id}/api/sharing`, { ...change, ...(saved.mode === 'restricted' && change.person?.role ? {mode:'view',linkView:false,linkKey} : {}) }, undefined, false, idToken);
    saved.linkKey = linkKey;
    saved.mode = got.mode || saved.mode; persist(); notify(); return status();
  }
  /** @param {Google} [google] */
  async function remove(google) {
    if (busy) await busy;
    if (!saved?.published) return status();
    try {
      // A lost response can leave the remote copy already deleted; retrying is safe.
      await request(`/m/${saved.id}/api/delete`, {}, undefined, true, proof(google, !!saved.access?.owner));
      saved = null; live.refresh(); persist(); error = ''; here = []; stateEtag = ''; notify();
      return status();
    } catch (/** @type {any} */ e) { error = e.message; notify(); throw e; }
  }
  // Coalesce edits made during a request and reconcile the final state once that request completes.
  let dirty = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let wake;
  function changed() {
    if (closed || !config || !saved?.published) return;
    dirty = true;
    if (!wake) wake = setTimeout(async () => {
      dirty = false;
      try { await pending; await busy; if (!closed) await sync(); }
      finally { wake = undefined; if (dirty) changed(); }
    }, 20);
  }
  const live = cloudLive(() => config && saved?.published && saved.mode !== 'restricted' ? {
    url: config.url + '/m/' + saved.id + '/api', headers: { authorization: 'Bearer ' + config.publishKey, 'x-map-owner': saved.ownerKey },
  } : null, changed, pointer);
  // Poll only already-published maps. Each exchange merges changes made while offline.
  const timer = setInterval(() => { void sync(); }, 5000); timer.unref();
  return { status, changed, watch: live.watch, move: live.move,
    /** @param {string} mode @param {Google} [google] */
    publish: (mode, google) => exclusive(() => publish(mode, google)).then((result) => { live.refresh(); return result; }),
    /** @param {any} change @param {Google} [google] */
    share: (change, google) => exclusive(() => share(change, google)),
    /** @param {Google} [google] */
    remove: (google) => exclusive(() => remove(google)), sync, close() { closed = true; clearInterval(timer); clearTimeout(wake); live.watch(false); } };
}
