import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { openMap } from '../live/server.js';
import { LINK_EDITS } from '../live/sharing.js';
import { mapData, mergeMap, viewData, signedLink } from '../live/cloud-data.js';
import { FirestoreStore } from './store.js';

const DIR = path.resolve(import.meta.dirname, '../live');
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (status, message) => Object.assign(new Error(message), { status });
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Send JSON.');
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 6 * 1024 * 1024) throw fail(413, 'This map is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks)); } catch { throw fail(400, 'Invalid JSON.'); }
}
export function createCloudServer({ store, publishKey, publicUrl }) {
  if (!publishKey || publishKey.length < 40) throw new Error('A strong publisher key is required.');
  const origin = new URL(publicUrl).origin;
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const scriptHashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  return http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', `default-src 'none'; script-src 'self' ${scriptHashes}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    const json = (code, value) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    const publisher = equal(req.headers.authorization || '', `Bearer ${publishKey}`);
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/health' && req.method === 'GET') return json(200, { ok: true });
      if (url.pathname === '/' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Living Map</title><h1>Living Map</h1><p>Open a shared map link to view or edit a map.</p>');
      if (url.pathname === '/api/maps' && req.method === 'POST') {
        if (!publisher) throw fail(401, 'Publishing requires this Mac\'s sharing key.');
        const a = await body(req), data = mapData(a.data), id = a.id;
        if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(a.ownerKey || '') || !/^[a-f0-9]{64}$/.test(a.linkKey || '') || !['view','edit'].includes(a.mode)) throw fail(400, 'Invalid sharing settings.');
        const value = { data, ownerHash: hash(a.ownerKey), linkHash: hash(a.linkKey), mode: a.mode, undo: [], revision: 1 };
        const existing = await store.get(id);
        if (existing) {
          if (!equal(existing.value.ownerHash, hash(a.ownerKey))) throw fail(403, 'This map belongs to someone else.');
          return json(200, { data: existing.value.data, revision: existing.value.revision });
        }
        await store.put(id, value, null);
        return json(201, { data, revision: 1 });
      }
      const match = url.pathname.match(/^\/m\/([a-f0-9]{32})(\/.*)?$/);
      if (!match) throw fail(404, 'Map not found.');
      const [, id, p = ''] = match;
      const suppliedLink = url.searchParams.get('share') || '';
      const linkKey = suppliedLink.split('.')[0];
      // Reject invented links before a billable database read.
      if (!publisher && (!/^[a-f0-9]{64}$/.test(linkKey) || !equal(suppliedLink, signedLink(id, linkKey, publishKey)))) throw fail(403, 'This link is not available.');
      const record = await store.get(id);
      if (!record) throw fail(404, 'This shared map is no longer available.');
      const v = record.value;
      const owner = publisher && equal(v.ownerHash, hash(req.headers['x-map-owner'] || ''));
      const link = equal(v.linkHash, hash(linkKey)) && ['view','edit'].includes(v.mode);
      if (!owner && !link) throw fail(403, 'This link is no longer available. Ask the owner for a new link.');
      const role = owner ? 'edit' : v.mode;
      if (!p && req.method === 'GET') return res.writeHead(302, { location: `/m/${id}/${url.search}` }).end();
      if (p === '/' && req.method === 'GET') {
        const visitor = (req.headers.cookie || '').match(/(?:^|;\s*)lm_cloud_guest=([a-f0-9]{32})(?:;|$)/)?.[1] || crypto.randomBytes(16).toString('hex');
        res.setHeader('set-cookie', `lm_cloud_guest=${visitor}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html.replace('</head>', `<meta name="lm-cloud" content="1"><meta name="lm-access" content="${role}"><meta name="lm-shared" content="1"></head>`));
      }
      if (p === '/editing.js' && req.method === 'GET') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(fs.readFileSync(path.join(DIR, 'editing.js')));
      if (p === '/api/state' && req.method === 'GET') {
        const etag = `"${v.revision}"`; res.setHeader('etag', etag);
        if (req.headers['if-none-match'] === etag) return res.writeHead(304).end();
        return json(200, { ...viewData(v.data, v.mode), cloudRevision: v.revision });
      }
      if (p === '/api/version' && req.method === 'GET') return json(200, { latest: true, version: 'cloud' });
      if (p === '/api/history' && req.method === 'GET') return json(200, []);
      if (p === '/api/file' && req.method === 'GET') {
        const data = JSON.stringify(viewData(v.data, v.mode)).replace(/</g, '\\u003c');
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-disposition': 'attachment; filename="shared-map.html"' }).end(html.replace('</head>', `<meta name="lm-file" content="saved"><script id="lm-data" type="application/json">${data}</script></head>`));
      }
      if (req.method !== 'POST') throw fail(404, 'Not found.');
      if (!owner && req.headers.origin !== origin) throw fail(403, 'Open this map to edit it.');
      const a = await body(req);
      if (p === '/api/sync' && owner) {
        const local = mapData(a.data), base = mapData(a.base);
        const merged = mergeMap(base, local, v.data);
        if (JSON.stringify(merged) !== JSON.stringify(v.data)) {
          v.data = merged; v.revision++; await store.put(id, v, record.version);
        }
        return json(200, { data: v.data, revision: v.revision });
      }
      if (p === '/api/sharing' && owner) {
        if (!['view','edit','restricted'].includes(a.mode)) throw fail(400, 'Choose view, edit, or restricted.');
        if (a.mode !== 'restricted') { if (!/^[a-f0-9]{64}$/.test(a.linkKey || '')) throw fail(400, 'Invalid link.'); v.linkHash = hash(a.linkKey); }
        v.mode = a.mode; v.revision++; await store.put(id, v, record.version);
        return json(200, { mode: v.mode });
      }
      if (p === '/api/delete' && owner) { await store.delete(id, record.version); return json(200, {}); }
      if (p !== '/api/act' || role !== 'edit' || !LINK_EDITS.has(a.type)) throw fail(403, 'This link does not allow that change.');
      if (a.type === 'cursor') return json(200, {});
      if (a.revision !== v.revision) throw fail(409, 'The map changed elsewhere. Your view is refreshing; please try again.');
      // Every browser has its own undo history; names supplied in a request cannot impersonate someone.
      const visitor = (req.headers.cookie || '').match(/(?:^|;\s*)lm_cloud_guest=([a-f0-9]{32})(?:;|$)/)?.[1];
      if (!visitor && !owner) throw fail(401, 'Open the shared map first.');
      const by = owner ? 'Owner' : `Guest ${visitor.slice(0, 6)}`;
      const engine = openMap({ home: '/tmp/living-map-memory', memory: true, initialState: viewData(v.data, v.mode), undoState: v.undo });
      try {
        const result = engine.editShared({ ...a, by });
        if (!result.ok) throw fail(400, result.error || 'That change could not be saved.');
        v.data = mapData(engine.snapshot());
        v.undo = engine.undoSnapshot().slice(-20).map(([person, history]) => [person, { undo: history.undo.slice(-20), redo: history.redo.slice(-20) }]);
        v.revision++; await store.put(id, v, record.version);
        return json(200, { ...(result.id ? { id: result.id } : {}), revision: v.revision });
      } finally { engine.close(); }
    } catch (e) {
      // Request URLs contain bearer links, so do not log them or request bodies.
      if (!res.headersSent) json(e.status || 400, { error: e.status ? e.message : 'This map contains unsupported data. No changes were saved.' });
      else res.end();
    }
  });
}
if (import.meta.main) {
  const server = createCloudServer({ store: new FirestoreStore(process.env.PROJECT), publishKey: process.env.PUBLISH_KEY, publicUrl: process.env.PUBLIC_URL });
  server.listen(Number(process.env.PORT || 8080), process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1');
}
