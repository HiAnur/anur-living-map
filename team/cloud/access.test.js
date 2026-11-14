import crypto from 'node:crypto';
import http from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { signedLink } from '../live/cloud-data.js';
import { MAX_PEOPLE, sealer } from './access.js';
import { idTokenChecker } from './google-id.js';
import { AUDIENCE, fakeGoogle } from './google-id.harness.js';
import { createCloudServer } from './server.js';

// The online copy shared by email: who may publish, who may open it, and what each may do there. Google is a
// fake key set throughout; nothing here calls Google or the login service.
const PUBLISH = 'a'.repeat(64), OWNER_KEY = 'b'.repeat(64), LINK = 'c'.repeat(64), ID = 'd'.repeat(32), ORIGIN = 'http://localhost:4497';
const google = fakeGoogle();
const OWNER = 'owner@example.com';
const sessionFor = (/** @type {string} */ email, name = email.split('@')[0]) => sealer(PUBLISH).seal('session', { email, name });
const map = () => ({ title: 'Launch plan', desc: '', nodes: [{ id: 'a', label: 'Pricing', x: 0, y: 0 }, { id: 'b', label: 'Audience', x: 200, y: 0 }], edges: [{ from: 'a', to: 'b' }], comments: [] });

class MemoryStore {
  /** @type {Map<string, { value: any, version: string }>} */ records = new Map();
  /** @param {string} id */
  async get(id) { return structuredClone(this.records.get(id) || null); }
  /** @param {string} id @param {any} value @param {string | null} version */
  async put(id, value, version) {
    if ((this.records.get(id)?.version || null) !== version) throw Object.assign(new Error('Conflict'), { status: 409 });
    const record = { value: structuredClone(value), version: String(Number(version) + 1) }; this.records.set(id, record); return structuredClone(record);
  }
  /** @param {string} id */
  async delete(id) { this.records.delete(id); }
}

/** @type {http.Server[]} */ const servers = [];
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise((r) => s.close(r)); } });

/** @param {{ store?: MemoryStore, exchange?: any }} [o] */
async function cloud({ store = new MemoryStore(), exchange } = {}) {
  const server = createCloudServer({ store, publishKey: PUBLISH, publicUrl: ORIGIN, checkIdToken: google.check, loginUrl: 'https://login.example', exchange });
  servers.push(server); await new Promise((r) => server.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  const url = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const share = signedLink(ID, LINK, PUBLISH);
  /** The owner's Mac: its sharing key and owner key, with the Google ID token it holds (`token`; '' for none). */
  const mac = (/** @type {string} */ route, /** @type {any} */ data, token = google.token(OWNER)) => fetch(url + route, { method: data ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${PUBLISH}`, 'x-map-owner': OWNER_KEY, ...(token ? { 'x-google-id-token': token } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  /** A browser on the link: signed in on the cloud as `email`, or not at all. */
  const visit = (/** @type {string} */ route, /** @type {{ email?: string, data?: any, cookie?: string }} */ { email, data, cookie } = {}) => fetch(`${url}/m/${ID}/${route}${route.includes('?') ? '&' : '?'}share=${share}`, {
    method: data ? 'POST' : 'GET', redirect: 'manual',
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: cookie ?? [`lm_cloud_guest=${'e'.repeat(32)}`, email ? `lm_cloud_session=${sessionFor(email)}` : ''].filter(Boolean).join('; ') }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const publish = (token = google.token(OWNER)) => mac('/api/maps', { id: ID, ownerKey: OWNER_KEY, linkKey: LINK, mode: 'view', data: map() }, token);
  const access = (/** @type {any} */ change, token = google.token(OWNER)) => mac(`/m/${ID}/api/sharing`, change, token);
  const revision = async (/** @type {string} */ email) => (await (await visit('api/state', { email })).json()).cloudRevision;
  return { url, store, mac, visit, publish, access, revision, share };
}

describe('publishing', () => {
  it('is refused without a valid Google ID token', async () => {
    const c = await cloud();
    // a Mac from before Google sign-in sends no token, and is told to update
    const old = await c.publish('');
    expect(old.status).toBe(401); expect((await old.json()).error).toContain('Update Living Map on this Mac');
    expect((await c.publish('not.a.token')).status).toBe(401);
    // signed by a key that is not Google's
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect((await c.publish(google.token(OWNER, {}, other))).status).toBe(401);
    expect(c.store.records.size).toBe(0);
  });
  it('is refused for a token meant for another app, an unverified address, or one that expired', async () => {
    const c = await cloud();
    expect((await c.publish(google.token(OWNER, { aud: 'another-client.apps.googleusercontent.com' }))).status).toBe(401);
    expect((await c.publish(google.token(OWNER, { iss: 'https://evil.example' }))).status).toBe(401);
    const unverified = await c.publish(google.token(OWNER, { email_verified: false }));
    expect(unverified.status).toBe(401); expect((await unverified.json()).error).toContain('not verified');
    expect((await c.publish(google.token(OWNER, { exp: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401);
    expect(c.store.records.size).toBe(0);
  });
  it('records the Google account that published as the owner, with nobody else listed', async () => {
    const c = await cloud();
    const r = await c.publish(google.token('Owner@Example.com', { name: 'Ana <b>' }));
    expect(r.status).toBe(201);
    expect((await r.json()).access).toEqual({ owner: { email: OWNER, name: 'Ana b' }, people: {}, linkView: false });
    expect(c.store.records.get(ID)?.value).toMatchObject({ owner: { email: OWNER }, people: {}, linkView: false });
    // publishing again as another account is refused
    expect((await c.publish(google.token('someone@example.com'))).status).toBe(403);
  });
  it('still needs this Mac\'s sharing key', async () => {
    const c = await cloud();
    const r = await fetch(`${c.url}/api/maps`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-google-id-token': google.token(OWNER) }, body: JSON.stringify({ id: ID }) });
    expect(r.status).toBe(401);
  });
});

describe('access by email', () => {
  it('lets only the owner, from their Mac and signed in as themselves, change who has access', async () => {
    const c = await cloud(); await c.publish();
    expect((await c.access({ person: { email: 'teammate@example.com', role: 'edit' } }, google.token('someone@example.com'))).status).toBe(403);
    expect((await c.access({ person: { email: 'teammate@example.com', role: 'edit' } }, '')).status).toBe(401);
    // a listed editor, from the page, cannot invite or change sharing
    expect((await c.access({ person: { email: 'teammate@example.com', role: 'edit' } })).status).toBe(200);
    expect((await c.visit('api/sharing', { email: 'teammate@example.com', data: { person: { email: 'friend@example.com', role: 'edit' } } })).status).toBe(403);
    expect((await c.visit('api/delete', { email: 'teammate@example.com', data: {} })).status).toBe(403);
    expect(c.store.records.get(ID)?.value.people).toEqual({ 'teammate@example.com': 'edit' });
    // deleting needs the owner's account too
    expect((await c.mac(`/m/${ID}/api/delete`, {}, google.token('someone@example.com'))).status).toBe(403);
    expect((await c.mac(`/m/${ID}/api/delete`, {})).status).toBe(200);
    expect(c.store.records.size).toBe(0);
  });
  it('checks each address: lowercased, whole, not the owner\'s, and up to the cap', async () => {
    const c = await cloud(); await c.publish();
    for (const email of ['nobody', 'a@b', 'x@y.z<script>', '', 'a'.repeat(250) + '@example.com']) expect((await c.access({ person: { email, role: 'view' } })).status, email).toBe(400);
    expect((await c.access({ person: { email: OWNER, role: 'view' } })).status).toBe(400);
    expect((await c.access({ person: { email: 'x@example.com', role: 'admin' } })).status).toBe(400);
    expect((await c.access({ linkView: 'yes' })).status).toBe(400);
    const r = await c.access({ person: { email: '  Teammate@Example.COM ', role: 'view' } });
    expect((await r.json()).access.people).toEqual({ 'teammate@example.com': 'view' });
    const store = /** @type {any} */ (c.store.records.get(ID));
    for (let i = 0; i < MAX_PEOPLE - 1; i++) store.value.people[`p${i}@example.com`] = 'view';
    expect((await c.access({ person: { email: 'one-too-many@example.com', role: 'view' } })).status).toBe(400);
    // changing or removing someone already listed is still allowed at the cap
    expect((await c.access({ person: { email: 'p0@example.com', role: 'edit' } })).status).toBe(200);
    expect((await c.access({ person: { email: 'p0@example.com', role: null } })).status).toBe(200);
  });
  it('lets a listed viewer read but not write', async () => {
    const c = await cloud(); await c.publish();
    await c.access({ person: { email: 'viewer@example.com', role: 'view' } });
    const page = await c.visit('', { email: 'viewer@example.com' });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<meta name="lm-access" content="view">'); expect(html).toContain('<meta name="lm-user" content="viewer">');
    const state = await (await c.visit('api/state', { email: 'viewer@example.com' })).json();
    expect(state.nodes.map((/** @type {any} */ n) => n.label)).toEqual(['Pricing', 'Audience']);
    expect((await c.visit('api/act', { email: 'viewer@example.com', data: { type: 'renamebox', id: 'a', label: 'No', revision: state.cloudRevision } })).status).toBe(403);
  });
  it('lets a listed editor write, under their Google name', async () => {
    const c = await cloud(); await c.publish();
    await c.access({ person: { email: 'teammate@example.com', role: 'edit' } });
    const as = { email: 'teammate@example.com' };
    expect((await c.visit('api/act', { ...as, data: { type: 'renamebox', id: 'a', label: 'Plans', revision: await c.revision(as.email) } })).status).toBe(200);
    expect((await c.visit('api/act', { ...as, data: { type: 'comment', node: 'a', text: 'Looks right', x: 0, y: 0, revision: await c.revision(as.email) } })).status).toBe(200);
    const v = /** @type {any} */ (c.store.records.get(ID)).value;
    expect(v.data.nodes[0].label).toBe('Plans');
    expect(v.data.comments[0].msgs[0].who).toBe('teammate');
    expect(v.undo.map((/** @type {any} */ [who]) => who)).toEqual(['teammate']);
    // an editor removed from the list loses access at once
    await c.access({ person: { email: 'teammate@example.com', role: null } });
    expect((await c.visit('api/state', as)).status).toBe(403);
  });
  it('shows an unlisted visitor how to get in, and nothing of the map', async () => {
    const c = await cloud(); await c.publish(google.token(OWNER, { name: 'Ana' }));
    const out = await c.visit('');
    expect(out.status).toBe(401);
    const signIn = await out.text();
    expect(signIn).toContain('Sign in with Google'); expect(signIn).not.toContain('Pricing');
    expect(signIn).toContain(`href="/auth/google?next=${encodeURIComponent(`/m/${ID}/?share=${c.share}`)}"`);
    const asked = await c.visit('', { email: 'stranger@example.com' });
    expect(asked.status).toBe(403);
    const ask = await asked.text();
    expect(ask).toContain('Ask Ana for access'); expect(ask).not.toContain('Pricing'); expect(ask).not.toContain(OWNER);
    for (const route of ['api/state', 'api/file']) {
      const r = await c.visit(route, { email: 'stranger@example.com' });
      expect(r.status).toBe(403); const text = await r.text();
      expect(text).toContain('Ask Ana for access'); expect(text).not.toContain('Pricing');
    }
    expect((await c.visit('api/state')).status).toBe(401);
    // a forwarded link alone, with no sign-in, gets nobody in
    expect((await c.visit('api/act', { data: { type: 'renamebox', id: 'a', label: 'No', revision: 1 } })).status).toBe(401);
  });
  it('lets anyone with the link view once the owner turns that on, but editing still needs a listed address', async () => {
    const c = await cloud(); await c.publish();
    expect((await c.visit('api/state')).status).toBe(401);
    expect((await (await c.access({ linkView: true })).json()).access.linkView).toBe(true);
    const page = await (await c.visit('')).text();
    expect(page).toContain('<meta name="lm-access" content="view">');
    // someone viewing through the link may sign in, in case they were invited to edit
    expect(page).toContain('<meta name="lm-cloud-signin"');
    const state = await c.visit('api/state');
    expect(state.status).toBe(200);
    expect((await c.visit('api/act', { data: { type: 'renamebox', id: 'a', label: 'No', revision: (await state.json()).cloudRevision } })).status).toBe(403);
    await c.access({ linkView: false });
    expect((await c.visit('api/state')).status).toBe(401);
  });
  it('keeps everyone out once the link is turned off, listed or not', async () => {
    const c = await cloud(); await c.publish();
    await c.access({ person: { email: 'teammate@example.com', role: 'edit' }, linkView: true });
    expect((await c.access({ mode: 'restricted' })).status).toBe(200);
    expect((await c.visit('api/state', { email: 'teammate@example.com' })).status).toBe(403);
    expect((await c.visit('api/state')).status).toBe(403);
    // a new link brings the list back; the old link stays dead
    expect((await c.access({ mode: 'view', linkKey: 'f'.repeat(64) })).status).toBe(200);
    expect((await c.visit('api/state', { email: 'teammate@example.com' })).status).toBe(403);
  });
  it('sends visitors who is here by name, never the people list or anyone\'s address', async () => {
    const c = await cloud(); await c.publish(google.token(OWNER, { name: 'Ana' }));
    await c.access({ person: { email: 'teammate@example.com', role: 'edit' } });
    await c.access({ person: { email: 'viewer@example.com', role: 'view' } });
    await c.visit('api/state', { email: 'viewer@example.com' });
    const r = await c.visit('api/state', { email: 'teammate@example.com' });
    const text = await r.text(), state = JSON.parse(text);
    expect(state.here).toEqual(['teammate', 'viewer']);
    expect(state.people).toEqual([{ id: 'teammate' }, { id: 'viewer' }]);
    expect(text).not.toContain('@example.com');
    // the owner's Mac is told the list
    expect((await (await c.mac(`/m/${ID}/api/state`, undefined)).json()).access.people).toEqual({ 'teammate@example.com': 'edit', 'viewer@example.com': 'view' });
  });
  it('tells a visitor\'s page about a new role through its own etag', async () => {
    const c = await cloud(); await c.publish();
    await c.access({ person: { email: 'teammate@example.com', role: 'view' } });
    const first = await c.visit('api/state', { email: 'teammate@example.com' });
    const etag = /** @type {string} */ (first.headers.get('etag'));
    const again = await fetch(`${c.url}/m/${ID}/api/state?share=${c.share}`, { headers: { 'if-none-match': etag, cookie: `lm_cloud_session=${sessionFor('teammate@example.com')}` } });
    expect(again.status).toBe(304);
    await c.access({ person: { email: 'teammate@example.com', role: 'edit' } });
    const after = await fetch(`${c.url}/m/${ID}/api/state?share=${c.share}`, { headers: { 'if-none-match': etag, cookie: `lm_cloud_session=${sessionFor('teammate@example.com')}` } });
    expect(after.status).toBe(200); expect((await after.json()).linkSharing.mode).toBe('edit');
  });
  it('ignores a session cookie this cloud did not sign', async () => {
    const c = await cloud(); await c.publish();
    await c.access({ person: { email: 'teammate@example.com', role: 'edit' } });
    const forged = sealer('f'.repeat(64)).seal('session', { email: 'teammate@example.com', name: 'Teammate' });
    expect((await c.visit('api/state', { cookie: `lm_cloud_session=${forged}` })).status).toBe(401);
  });
});

describe('a copy published before Google sign-in', () => {
  /** @param {MemoryStore} store @param {string} mode */
  const legacy = async (store, mode) => store.put(ID, { data: map(), ownerHash: crypto.createHash('sha256').update(OWNER_KEY).digest('hex'), linkHash: crypto.createHash('sha256').update(LINK).digest('hex'), mode, undo: [], revision: 1 }, null);
  it('keeps working as its link says until its Mac claims it while signed in to Google', async () => {
    const store = new MemoryStore(); await legacy(store, 'edit');
    const c = await cloud({ store });
    expect((await c.visit('api/state')).status).toBe(200);
    expect((await c.visit('api/act', { data: { type: 'renamebox', id: 'a', label: 'Guest edit', revision: 1 } })).status).toBe(200);
    expect(store.records.get(ID)?.value.data.nodes[0].label).toBe('Guest edit');
    // without Google, the Mac changes its link as before, but cannot list people
    expect((await c.access({ mode: 'view', linkKey: LINK }, '')).status).toBe(200);
    expect((await c.visit('api/state')).status).toBe(200);
    expect((await c.access({ person: { email: 'teammate@example.com', role: 'edit' } }, '')).status).toBe(401);
    expect(store.records.get(ID)?.value.owner).toBeUndefined();
    // the first change made while signed in claims it: from then on, the link alone opens nothing
    const claimed = await c.access({});
    expect(claimed.status).toBe(200); expect((await claimed.json()).access.owner.email).toBe(OWNER);
    expect((await c.visit('api/state')).status).toBe(401);
    expect((await c.access({}, google.token('someone@example.com'))).status).toBe(403);
  });
});

describe('signing in on the cloud', () => {
  it('goes through the login service and comes back to the map with a session', async () => {
    /** @type {any[]} */ const asked = [];
    const exchange = async (/** @type {string} */ url, /** @type {any} */ init) => { asked.push([url, JSON.parse(init.body)]); return new Response(JSON.stringify({ email: 'teammate@example.com', name: 'Teammate', id_token: google.token('teammate@example.com', { name: 'Teammate' }) })); };
    const c = await cloud({ exchange }); await c.publish();
    await c.access({ person: { email: 'teammate@example.com', role: 'edit' } });
    const next = `/m/${ID}/?share=${c.share}`;
    const start = await fetch(`${c.url}/auth/google?next=${encodeURIComponent(next)}`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const to = new URL(/** @type {string} */ (start.headers.get('location')));
    expect(to.origin + to.pathname).toBe('https://login.example/start');
    expect(to.searchParams.get('return')).toBe(`${ORIGIN}/auth/done`);
    // the map's link never goes to the login service
    expect(to.href).not.toContain(LINK);
    const flow = /** @type {string} */ (start.headers.get('set-cookie')).split(';')[0];
    expect(start.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const done = await fetch(`${c.url}/auth/done?code=one-time&state=${to.searchParams.get('state')}`, { redirect: 'manual', headers: { cookie: flow } });
    expect(done.status).toBe(302); expect(done.headers.get('location')).toBe(next);
    expect(asked[0][0]).toBe('https://login.example/exchange'); expect(asked[0][1].code).toBe('one-time');
    // the verifier sent matches the challenge the login service was given
    expect(crypto.createHash('sha256').update(asked[0][1].verifier).digest('base64url')).toBe(to.searchParams.get('challenge'));
    const session = done.headers.getSetCookie().find((s) => s.startsWith('lm_cloud_session='));
    expect(session).toMatch(/HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=/);
    const page = await c.visit('', { cookie: /** @type {string} */ (session).split(';')[0] });
    expect(page.status).toBe(200); expect(await page.text()).toContain('<meta name="lm-access" content="edit">');
  });
  it('refuses a sign-in it did not start, a stale login service, and a page to go back to that is not a map', async () => {
    const old = async () => new Response(JSON.stringify({ email: 'teammate@example.com', name: 'Teammate' }));
    const c = await cloud({ exchange: old });
    expect((await fetch(`${c.url}/auth/google?next=${encodeURIComponent('https://evil.example/')}`, { redirect: 'manual' })).status).toBe(400);
    expect((await fetch(`${c.url}/auth/done?code=x&state=forged`, { redirect: 'manual' })).status).toBe(400);
    const start = await fetch(`${c.url}/auth/google?next=${encodeURIComponent(`/m/${ID}/`)}`, { redirect: 'manual' });
    const state = new URL(/** @type {string} */ (start.headers.get('location'))).searchParams.get('state');
    const done = await fetch(`${c.url}/auth/done?code=x&state=${state}`, { redirect: 'manual', headers: { cookie: /** @type {string} */ (start.headers.get('set-cookie')).split(';')[0] } });
    expect(done.status).toBe(502); expect(await done.text()).toContain('must be updated');
  });
});

describe('Google ID tokens', () => {
  it('fetches Google\'s keys once, and again at most once a minute for a key it does not know', async () => {
    const g = fakeGoogle();
    let t = Date.now();
    const check = idTokenChecker({ audience: AUDIENCE, keys: g.keys, now: () => t });
    await check(g.token(OWNER)); await check(g.token(OWNER));
    expect(g.fetched).toBe(1);
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'unknown' })).toString('base64url');
    const [, body, sig] = g.token(OWNER).split('.');
    await expect(check(`${head}.${body}.${sig}`)).rejects.toThrow('Sign in with Google again');
    await expect(check(`${head}.${body}.${sig}`)).rejects.toThrow();
    expect(g.fetched).toBe(1);
    t += 61_000;
    await expect(check(`${head}.${body}.${sig}`)).rejects.toThrow();
    expect(g.fetched).toBe(2);
  });
  it('refuses an unsigned token', async () => {
    const g = fakeGoogle();
    const head = Buffer.from(JSON.stringify({ alg: 'none', kid: 'test-key' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: 'accounts.google.com', aud: AUDIENCE, email: OWNER, email_verified: true, exp: 9e9, iat: 1 })).toString('base64url');
    await expect(g.check(`${head}.${body}.`)).rejects.toThrow();
    await expect(g.check(`${head}.${body}.abc`)).rejects.toThrow();
  });
});
