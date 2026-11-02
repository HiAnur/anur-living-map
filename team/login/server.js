// Living Map login: Google sign-in for every map running on anyone's Mac. Anyone with a Google account gets in.
// The map stays on each Mac; only signing in happens here, on Cloud Run in the GCP project living-map-login.
// A map sends the browser here, Google says which address it is and what the person is called, the list
// (Firestore, collection "people", one document per address) may give that address a name of its own, and the
// browser goes back to the map on localhost with a one-time code. The map trades the code here, with the secret it started with, for the person.
//
//   GET  /start?return=http://localhost:4322/auth/done&state=S&challenge=C    → Google
//   GET  /auth/google/callback                                              → <return>?code=…&state=S
//   POST /exchange {code, verifier}                                          → {email, name}
//   POST /password {name, password}                                          → {name}, a sign-in with no Google account
//
// The list, from any Mac signed in to gcloud with access to the project:
//   node login/server.js add <email> <name>        that Google address signs in as that name, not its Google name
//   node login/server.js password <name>           a name and password for someone with no Google account
//                                                  (the password is read from stdin and kept scrambled, scrypt)
//   node login/server.js remove <email or name> | list
//
// Env on Cloud Run: PUBLIC_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SEAL_KEY (32 random bytes, base64).
// Nothing is kept in memory between requests: what a sign-in carries from step to step is sealed with SEAL_KEY
// (AES-256-GCM), so any instance can finish it. No packages: Firestore is called over its REST API.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';

const PROJECT = process.env.PROJECT || 'living-map-login';
const PORT = Number(process.env.PORT || 4760);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ID = process.env.GOOGLE_CLIENT_ID || '', SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const KEY = process.env.SEAL_KEY ? Buffer.from(process.env.SEAL_KEY, 'base64') : null;

// ── the list, in Firestore ──
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
async function accessToken() {
  if (!process.env.K_SERVICE) return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  return (await r.json()).access_token;
}
async function fs(method, path, body) {
  const r = await fetch(`${DOCS}${path}`, { method, headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore ${method} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const doc = (email) => `/people/${encodeURIComponent(email)}`, pw = (name) => `/passwords/${encodeURIComponent(name)}`;
const nameOf = async (email) => (await fs('GET', doc(email)))?.fields?.name?.stringValue || null;
const scramble = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');
// the name a password signs in as, or null
async function passwordOf(name, password) {
  const f = (await fs('GET', pw(String(name || '').trim().toLowerCase())))?.fields;
  if (!f) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(scramble(password, f.salt.stringValue), 'hex'), Buffer.from(f.hash.stringValue, 'hex'));
  return ok ? f.name.stringValue : null;
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd) {
  const email = String(a1 || '').trim().toLowerCase();
  if (cmd === 'list') {
    const rows = ((await fs('GET', '/people?pageSize=300'))?.documents || []).map((d) => `${decodeURIComponent(d.name.split('/').pop())}  as ${d.fields.name.stringValue}`);
    console.log(rows.length ? `Google:\n${rows.sort().join('\n')}` : 'No Google address is on the list yet.');
    const pws = ((await fs('GET', '/passwords?pageSize=300'))?.documents || []).map((d) => `${d.fields.name.stringValue}  (set ${d.fields.set_at.timestampValue.slice(0, 10)})`);
    if (pws.length) console.log(`\nPassword:\n${pws.sort().join('\n')}`);
  } else if (cmd === 'password' && /^[\w.-]{1,40}$/.test(a1 || '')) {
    let password = ''; for await (const c of process.stdin) password += c;
    password = password.replace(/\r?\n$/, '');
    if (password.length < 8) { console.log('Use at least 8 characters. Nothing changed.'); process.exit(1); }
    const salt = crypto.randomBytes(16).toString('hex');
    await fs('PATCH', pw(a1.toLowerCase()), { fields: { name: { stringValue: a1 }, salt: { stringValue: salt }, hash: { stringValue: scramble(password, salt) },
      set_at: { timestampValue: new Date().toISOString() } } });
    console.log(`${a1} can sign in with that password now.`);
  } else if (cmd === 'add' && /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(email) && /^[\w .-]{1,40}$/.test(a2 || '')) {
    await fs('PATCH', doc(email), { fields: { name: { stringValue: a2 }, added_at: { timestampValue: new Date().toISOString() } } });
    console.log(`${email} can sign in as ${a2} now.`);
  } else if (cmd === 'remove' && email) {
    const at = email.includes('@') ? doc(email) : pw(email);
    const had = await fs('GET', at); if (had) await fs('DELETE', at);
    console.log(had ? `${a1} is off the list.` : `${a1} was not on the list.`);
  } else { console.log('node login/server.js add <email> <name> | password <name> | remove <email or name> | list'); process.exit(1); }
  process.exit(0);
}

// ── sealing what a sign-in carries between steps ──
const TTL = 10 * 60_000, CODE_TTL = 2 * 60_000;
const token = (n) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('base64url');
function seal(kind, obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ ...obj, kind, at: Date.now() })), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
function unseal(kind, s, ttl) {
  try {
    const b = Buffer.from(String(s), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const o = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    return o.kind === kind && Date.now() - o.at < ttl ? o : null;
  } catch { return null; }
}

// ── the web side ──
// only a map on the person's own Mac may be sent back to
const BACK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/auth\/done$/;
const go = (res, to) => res.writeHead(302, { location: to, 'cache-control': 'no-store' }).end();
const back = (res, f, q) => go(res, `${f.back}?${new URLSearchParams({ ...q, state: f.state })}`);
const text = (res, code, s) => res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }).end(s);
const json = (res, code, d) => res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(d));
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 8192) req.destroy(); }); req.on('end', () => ok(s)); });

async function google(code, verifier) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, code_verifier: verifier, grant_type: 'authorization_code', client_id: ID, client_secret: SECRET,
      redirect_uri: `${PUBLIC_URL}/auth/google/callback` }),
  }).catch(() => null);
  const b = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !b.id_token) throw new Error(`Google did not confirm the sign-in (${b.error || r?.status || 'no answer'}).`);
  // Straight from Google's token address over TLS, so TLS stands in for the signature check
  // (OpenID Connect Core 3.1.3.7); audience, issuer, expiry and a verified address are still checked.
  const c = JSON.parse(Buffer.from(b.id_token.split('.')[1], 'base64url').toString('utf8'));
  if (c.aud !== ID || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss) || c.exp * 1000 < Date.now())
    throw new Error('Google did not confirm the sign-in.');
  if (!(c.email_verified === true || c.email_verified === 'true')) throw new Error('Google has not verified that address.');
  return { email: String(c.email).toLowerCase(), name: String(c.name || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL), q = url.searchParams;
  if (url.pathname === '/start' && req.method === 'GET') {
    const f = { back: q.get('return') || '', state: q.get('state') || '', challenge: q.get('challenge') || '' };
    if (!BACK.test(f.back) || !/^[\w-]{16,100}$/.test(f.state) || !/^[\w-]{43}$/.test(f.challenge)) return text(res, 400, 'This sign-in link is not from a Living Map.');
    if (!ID || !SECRET || !KEY) return text(res, 503, 'Google sign-in is not set up here yet.');
    f.verifier = token(32);
    return go(res, `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: ID, redirect_uri: `${PUBLIC_URL}/auth/google/callback`, response_type: 'code', scope: 'openid email profile',
      state: seal('flow', f), code_challenge: sha(f.verifier), code_challenge_method: 'S256', prompt: 'select_account' })}`);
  }
  if (url.pathname === '/auth/google/callback' && req.method === 'GET') {
    const f = KEY && unseal('flow', q.get('state'), TTL);
    if (!f) return text(res, 400, 'That sign-in took too long. Go back to the map and sign in again.');
    if (q.get('error')) return back(res, f, { error: q.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google said: ${q.get('error')}.` });
    // the name the list gives this address, else the name Google has for the person, else the address's first part
    let email, name;
    try { const g = await google(q.get('code') || '', f.verifier); email = g.email; name = (await nameOf(email)) || g.name || email.split('@')[0]; } catch (e) { console.error(e.message); return back(res, f, { error: e.message.startsWith('Firestore') ? 'The sign-in list could not be read. Try again.' : e.message }); }
    console.log(`signed in ${email} as ${name}`);
    return back(res, f, { code: seal('code', { email, name, challenge: f.challenge }) });
  }
  if (url.pathname === '/exchange' && req.method === 'POST') {
    let a = {}; try { a = JSON.parse(await body(req)); } catch {}
    const c = KEY && unseal('code', a.code, CODE_TTL);
    if (!c || sha(a.verifier || '') !== c.challenge) return json(res, 400, { error: 'That sign-in code is not good. Sign in again.' });
    return json(res, 200, { email: c.email, name: c.name });
  }
  if (url.pathname === '/password' && req.method === 'POST') {
    let a = {}, name = null; try { a = JSON.parse(await body(req)); } catch {}
    try { name = await passwordOf(a.name, a.password); } catch (e) { console.error(e.message); return json(res, 503, { error: 'The sign-in list could not be read. Try again.' }); }
    if (!name) { await new Promise((ok) => setTimeout(ok, 400)); return json(res, 401, { error: 'That name and password are not right.' }); }
    console.log(`signed in ${name} with a password`);
    return json(res, 200, { name });
  }
  if (url.pathname === '/' && req.method === 'GET') return text(res, 200, 'Living Map sign-in. Open your map and choose Sign in with Google.');
  text(res, 404, 'not here');
}).listen(PORT, process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1', () => console.log(`Living Map login on ${PUBLIC_URL}`));
