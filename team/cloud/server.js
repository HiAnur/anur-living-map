import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { openMap } from '../live/server.js';
import { PAGE_MODULES, inlineModules } from '../live/page-modules.js';
import { LINK_EDITS } from '../live/sharing.js';
import { mapData, mergeMap, viewData, signedLink } from '../live/cloud-data.js';
import { accessOf, applyAccess, cookie, gatePage, notePage, sealer, SESSION_DAYS, visitorRole } from './access.js';
import { idTokenChecker } from './google-id.js';
import { FirestoreStore } from './store.js';

const LOGIN = 'https://living-map-login-572969880390.us-west1.run.app';
// who has a copy open: names seen polling it in the last 20 seconds, kept in memory only, since the service runs
// one instance and a write per poll would cost more than presence is worth
const HERE_FOR = 20_000;

const DIR = path.resolve(import.meta.dirname, '../live');
const hash = (/** @type {any} */ s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const equal = (/** @type {any} */ a, /** @type {any} */ b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (/** @type {any} */ status, /** @type {any} */ message) => Object.assign(new Error(message), { status });
/** @param {any} req */
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Send JSON.');
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 6 * 1024 * 1024) throw fail(413, 'This map is too large.'); chunks.push(chunk); }
  try { return JSON.parse(/** @type {any} */ (Buffer.concat(chunks))); } catch { throw fail(400, 'Invalid JSON.'); }
}
/**
 * @param {{ store: any, publishKey: string, publicUrl: string, googleClientId?: string, loginUrl?: string,
 *   checkIdToken?: (token: unknown) => Promise<{ email: string, name: string }>, exchange?: typeof fetch }} options
 * `googleClientId`: the login service's OAuth client, the audience of its ID tokens; `checkIdToken` and `exchange`
 * stand in for Google's keys and the login service in tests
 */
export function createCloudServer({ store, publishKey, publicUrl, googleClientId = '', loginUrl = LOGIN, checkIdToken, exchange = fetch }) {
  if (!publishKey || publishKey.length < 40) throw new Error('A strong publisher key is required.');
  const origin = new URL(publicUrl).origin;
  const checkId = checkIdToken || idTokenChecker({ audience: googleClientId });
  const cookies = sealer(publishKey);
  /** @type {Map<string, Map<string, { name: string, at: number }>>} */
  const here = new Map();
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8'), read = (/** @type {string} */ f) => fs.readFileSync(path.join(DIR, f), 'utf8');
  // Share as a file opens with no server, so the page's modules are written into it
  const fileHtml = inlineModules(html, read);
  const scriptHashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  // the names of who has copy `id` open now, after marking `who` as here
  /** @param {string} id @param {{ email: string, name: string } | null} who */
  const present = (id, who) => {
    const now = Date.now(), seen = here.get(id) || new Map();
    if (who) seen.set(who.email, { name: who.name, at: now });
    for (const [k, s] of seen) if (now - s.at > HERE_FOR) seen.delete(k);
    if (seen.size) here.set(id, seen); else here.delete(id);
    return [...new Set([...seen.values()].map((s) => s.name))].sort();
  };
  return http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', `default-src 'none'; script-src 'self' ${scriptHashes}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    const json = (/** @type {any} */ code, /** @type {any} */ value) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    const htmlPage = (/** @type {number} */ code, /** @type {string} */ text) => res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }).end(text);
    const publisher = equal(req.headers.authorization || '', `Bearer ${publishKey}`);
    // the Google account the owner's Mac acts for, proved by an ID token it got through the login service
    const google = () => checkId(req.headers['x-google-id-token']);
    // the visitor's own Google sign-in on this cloud, or null
    const session = /** @type {{ email: string, name: string } | null} */ (cookies.open('session', cookie(req, 'lm_cloud_session'), SESSION_DAYS * 86_400_000));
    try {
      const url = new URL(/** @type {string} */ (req.url), origin);
      if (url.pathname === '/health' && req.method === 'GET') return json(200, { ok: true });
      if (url.pathname === '/' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Living Map</title><h1>Living Map</h1><p>Open a shared map link to view or edit a map.</p>');
      // Sign in with Google through the login service, back to a map's own link. What the sign-in carries between
      // steps (its state, the verifier and the page to go back to) is a signed cookie, so any instance can finish it.
      if (url.pathname === '/auth/google' && req.method === 'GET') {
        const next = url.searchParams.get('next') || '';
        if (!/^\/m\/[a-f0-9]{32}\/(\?share=[a-f0-9]{64}\.[a-f0-9]{64})?$/.test(next)) throw fail(400, 'Open the map link again to sign in.');
        const state = crypto.randomBytes(16).toString('base64url'), verifier = crypto.randomBytes(32).toString('base64url');
        res.setHeader('set-cookie', `lm_cloud_flow=${cookies.seal('flow', { state, verifier, next })}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`);
        return res.writeHead(302, { location: `${loginUrl}/start?${new URLSearchParams({ return: `${origin}/auth/done`, state, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') })}` }).end();
      }
      if (url.pathname === '/auth/done' && req.method === 'GET') {
        const flow = cookies.open('flow', cookie(req, 'lm_cloud_flow'), 600_000);
        const done = 'lm_cloud_flow=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0';
        res.setHeader('set-cookie', done);
        if (!flow || flow.state !== url.searchParams.get('state')) return htmlPage(400, notePage('That sign-in took too long', 'Open the map link again and sign in.'));
        if (url.searchParams.get('error')) return htmlPage(400, notePage('Not signed in', String(url.searchParams.get('error')).slice(0, 200)));
        const r = await exchange(`${loginUrl}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: url.searchParams.get('code') || '', verifier: flow.verifier }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
        const d = r ? await r.json().catch(() => ({})) : {};
        if (!r?.ok) return htmlPage(502, notePage('Not signed in', String(d.error || 'The sign-in service did not answer. Open the map link again.').slice(0, 200)));
        if (!d.id_token) return htmlPage(502, notePage('Sign-in needs an update', 'The sign-in service must be updated before this map can check who you are.'));
        let who; try { who = await checkId(d.id_token); } catch (/** @type {any} */ e) { return htmlPage(e.status || 401, notePage('Not signed in', e.message)); }
        res.setHeader('set-cookie', [done, `lm_cloud_session=${cookies.seal('session', who)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}`]);
        return res.writeHead(302, { location: flow.next }).end();
      }
      if (url.pathname === '/api/maps' && req.method === 'POST') {
        if (!publisher) throw fail(401, 'Publishing requires this Mac\'s sharing key.');
        const a = await body(req), data = mapData(a.data), id = a.id;
        if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(a.ownerKey || '') || !/^[a-f0-9]{64}$/.test(a.linkKey || '') || !['view','edit'].includes(a.mode)) throw fail(400, 'Invalid sharing settings.');
        // an online copy belongs to the Google account that published it
        const who = await google();
        const existing = await store.get(id);
        if (existing) {
          const v = existing.value;
          if (!equal(v.ownerHash, hash(a.ownerKey))) throw fail(403, 'This map belongs to someone else.');
          if (v.owner && v.owner.email !== who.email) throw fail(403, 'This online copy belongs to another Google account. Sign in with that account to change it.');
          if (!v.owner) { Object.assign(v, { owner: who, people: {}, linkView: false }); await store.put(id, v, existing.version); }
          return json(200, { data: v.data, revision: v.revision, mode: v.mode, access: accessOf(v) });
        }
        const value = { data, ownerHash: hash(a.ownerKey), linkHash: hash(a.linkKey), mode: 'view', owner: who, people: {}, linkView: false, undo: [], revision: 1 };
        await store.put(id, value, null);
        return json(201, { data, revision: 1, mode: value.mode, access: accessOf(value) });
      }
      const match = url.pathname.match(/^\/m\/([a-f0-9]{32})(\/.*)?$/);
      if (!match) throw fail(404, 'Map not found.');
      const [, id, p = ''] = match;
      // the page's own modules are its code, the same for every map: they load before the link check, since the
      // browser's imports never carry the link's key
      if (PAGE_MODULES.includes(p.slice(1)) && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(read(p.slice(1)));
      const suppliedLink = url.searchParams.get('share') || '';
      const linkKey = suppliedLink.split('.')[0];
      // Reject invented links before a billable database read.
      if (!publisher && (!/^[a-f0-9]{64}$/.test(linkKey) || !equal(suppliedLink, signedLink(id, linkKey, publishKey)))) throw fail(403, 'This link is not available.');
      const record = await store.get(id);
      if (!record) throw fail(404, 'This shared map is no longer available.');
      const v = record.value;
      // the owner's Mac, which publishes and syncs with the copy's private owner key
      const mac = publisher && equal(v.ownerHash, hash(req.headers['x-map-owner'] || ''));
      const linked = equal(v.linkHash, hash(linkKey));
      const role = mac ? 'edit' : linked ? visitorRole(v, session?.email || '').role : null;
      if (!role) {
        if (!linked || v.mode === 'restricted' || !v.owner) throw fail(403, 'This link is no longer available. Ask the owner for a new link.');
        // a copy shared by email: the visitor signs in, or asks its owner; nothing of the map is sent either way
        const signIn = `/auth/google?next=${encodeURIComponent(`/m/${id}/?share=${suppliedLink}`)}`;
        if (req.method === 'GET' && (p === '' || p === '/')) return htmlPage(session ? 403 : 401, gatePage({ ownerName: v.owner.name, signedInAs: session?.email || '', signIn }));
        throw session ? fail(403, `Ask ${v.owner.name || 'the owner'} for access.`) : fail(401, 'Sign in with Google to open this map.');
      }
      // a signed-in visitor on a copy shared by email acts under their Google name
      const named = !mac && v.owner && session ? session : null;
      if (!p && req.method === 'GET') return res.writeHead(302, { location: `/m/${id}/${url.search}` }).end();
      if (p === '/' && req.method === 'GET') {
        const guest = (req.headers.cookie || '').match(/(?:^|;\s*)lm_cloud_guest=([a-f0-9]{32})(?:;|$)/)?.[1] || crypto.randomBytes(16).toString('hex');
        res.setHeader('set-cookie', `lm_cloud_guest=${guest}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
        const metas = ['<meta name="lm-cloud" content="1">', `<meta name="lm-access" content="${role}">`, '<meta name="lm-shared" content="1">',
          named ? `<meta name="lm-user" content="${named.name}">` : '',
          // someone viewing through the link alone may have been invited to edit: Share offers them a sign-in
          v.owner && !named ? `<meta name="lm-cloud-signin" content="/auth/google?next=${encodeURIComponent(`/m/${id}/?share=${suppliedLink}`)}">` : ''];
        return htmlPage(200, html.replace('</head>', `${metas.join('')}</head>`));
      }
      if (p === '/editing.js' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(path.join(DIR, 'editing.js')));
      if (p === '/api/state' && req.method === 'GET') {
        if (mac) {
          const etag = `"${v.revision}"`; res.setHeader('etag', etag);
          if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();
          return json(200, { ...viewData(v.data, v.mode), cloudRevision: v.revision, access: accessOf(v) });
        }
        const names = v.owner ? present(id, named) : [];
        const etag = `"${v.revision}.${role}.${hash(names.join('\n')).slice(0, 12)}"`; res.setHeader('etag', etag);
        if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();
        // who is here stands in for the map's people, the only people a visitor is sent
        return json(200, { ...viewData(v.data, role), ...(v.owner ? { people: names.map((n) => ({ id: n })), here: names } : {}), cloudRevision: v.revision });
      }
      if (p === '/api/version' && req.method === 'GET') return json(200, { latest: true, version: 'cloud' });
      if (p === '/api/history' && req.method === 'GET') return json(200, []);
      if (p === '/api/file' && req.method === 'GET') {
        const data = JSON.stringify(viewData(v.data, role)).replace(/</g, '\\u003c');
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': 'attachment; filename="shared-map.html"' }).end(fileHtml.replace('</head>', `<meta name="lm-file" content="saved"><script id="lm-data" type="application/json">${data}</script></head>`));
      }
      if (req.method !== 'POST') throw fail(404, 'Not found.');
      if (!mac && req.headers.origin !== origin) throw fail(403, 'Open this map to edit it.');
      const a = await body(req);
      if (p === '/api/sync' && mac) {
        const local = mapData(a.data), base = mapData(a.base);
        const merged = mergeMap(base, local, v.data);
        if (JSON.stringify(merged) !== JSON.stringify(v.data)) {
          v.data = merged; v.revision++; await store.put(id, v, record.version);
        }
        return json(200, { data: v.data, revision: v.revision, access: accessOf(v) });
      }
      // Who may open the copy. Once it has an owner, only that Google account changes it; a copy from before
      // Google sign-in is claimed by the first change made while signed in, and until then keeps its link modes.
      if (p === '/api/sharing' && mac) {
        if (v.owner || req.headers['x-google-id-token']) {
          const who = await google();
          if (v.owner && v.owner.email !== who.email) throw fail(403, 'This online copy belongs to another Google account. Sign in with that account to change it.');
          if (!v.owner) Object.assign(v, { owner: who, people: {}, linkView: false, ...(v.mode === 'restricted' ? {} : { mode: 'view' }) });
          else v.owner.name = who.name;
        } else if (a.person !== undefined || a.linkView !== undefined) throw fail(401, 'Sign in with Google to choose who can open this map.');
        if (a.mode !== undefined) {
          if (!['view','edit','restricted'].includes(a.mode)) throw fail(400, 'Choose view, edit, or restricted.');
          if (a.mode !== 'restricted') { if (!/^[a-f0-9]{64}$/.test(a.linkKey || '')) throw fail(400, 'Invalid link.'); v.linkHash = hash(a.linkKey); }
          // on a copy with an owner, the link only leads to the map: what each person may do comes from the list
          v.mode = v.owner && a.mode !== 'restricted' ? 'view' : a.mode;
        }
        if (v.owner) { const wrong = applyAccess(v, a); if (wrong) throw fail(400, wrong); }
        // the map itself is unchanged, so its revision stays: a visitor's page sees a new role by its own etag
        await store.put(id, v, record.version);
        return json(200, { mode: v.mode, access: accessOf(v) });
      }
      if (p === '/api/delete' && mac) {
        if (v.owner && (await google()).email !== v.owner.email) throw fail(403, 'This online copy belongs to another Google account. Sign in with that account to delete it.');
        await store.delete(id, record.version); here.delete(id); return json(200, {});
      }
      if (p !== '/api/act' || role !== 'edit' || !LINK_EDITS.has(a.type)) throw fail(403, 'This link does not allow that change.');
      if (a.type === 'cursor') return json(200, {});
      if (a.revision !== v.revision) throw fail(409, 'The map changed elsewhere. Your view is refreshing; please try again.');
      // Every browser has its own undo history; names supplied in a request cannot impersonate someone.
      const guest = (req.headers.cookie || '').match(/(?:^|;\s*)lm_cloud_guest=([a-f0-9]{32})(?:;|$)/)?.[1];
      if (!guest && !mac && !named) throw fail(401, 'Open the shared map first.');
      const by = mac ? 'Owner' : named ? named.name : `Guest ${/** @type {string} */ (guest).slice(0, 6)}`;
      const engine = openMap({ home: '/tmp/living-map-memory', memory: true, initialState: viewData(v.data, v.mode), undoState: v.undo });
      try {
        const result = engine.editShared({ ...a, by });
        if (!result.ok) throw fail(400, result.error || 'That change could not be saved.');
        v.data = mapData(engine.snapshot());
        v.undo = engine.undoSnapshot().slice(-20).map(([person, history]) => [person, { undo: history.undo.slice(-20), redo: history.redo.slice(-20) }]);
        v.revision++; await store.put(id, v, record.version);
        return json(200, { ...(result.id ? { id: result.id } : {}), revision: v.revision });
      } finally { engine.close(); }
    } catch (/** @type {any} */ e) {
      // Request URLs carry bearer links and headers ID tokens, so neither is logged, nor are request bodies.
      if (!res.headersSent) json(e.status || 400, { error: e.status ? e.message : 'This map contains unsupported data. No changes were saved.' });
      else res.end();
    }
  });
}
if (import.meta.main) {
  const server = createCloudServer({ store: new FirestoreStore(process.env.PROJECT), publishKey: /** @type {string} */ (process.env.PUBLISH_KEY), publicUrl: /** @type {string} */ (process.env.PUBLIC_URL),
    googleClientId: process.env.GOOGLE_CLIENT_ID || '', loginUrl: (process.env.LOGIN_URL || LOGIN).replace(/\/$/, '') });
  server.listen(Number(process.env.PORT || 8080), process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1');
}
