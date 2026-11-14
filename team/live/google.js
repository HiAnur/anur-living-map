// Sign in with Google, through Living Map login (login/server.js, on Cloud Run). Anyone with a Google account
// gets in. The browser goes there, Google says who it is, and it comes back to /auth/done with a one-time code
// that only this server can trade (it keeps the secret the code was asked with) for the person. LIVING_MAP_LOGIN_URL points at another login service; empty turns Google off.
import crypto from 'node:crypto';

const LOGIN = (process.env.LIVING_MAP_LOGIN_URL ?? 'https://living-map-login-572969880390.us-west1.run.app').replace(/\/$/, '');
const TTL = 10 * 60_000;
// a Google picture is kept and drawn only as an address on Google's own picture host
export const PICTURE = /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\/[\w\-./=~%]{1,300}$/;
const pending = new Map(); // state → { verifier, origin, next, at }
/** @param {number} n */
const token = (n) => crypto.randomBytes(n).toString('base64url');

export const googleOn = () => !!LOGIN;

// where to send the browser: origin is this map's own address (http://localhost:4322), next the page to go back to
/** @param {string} origin @param {string} next */
export function googleStart(origin, next) {
  for (const [k, v] of pending) if (Date.now() - v.at > TTL) pending.delete(k);
  const state = token(16), verifier = token(32);
  pending.set(state, { verifier, next, at: Date.now() });
  return `${LOGIN}/start?${new URLSearchParams({ return: `${origin}/auth/done`, state,
    challenge: crypto.createHash('sha256').update(verifier).digest('base64url') })}`;
}

// what came back on /auth/done: the person (listed: named by the login's list, so one of the map's people may be
// seated; else only Google's name for them), their Google picture's address if the login gave one, and the page
// to go back to, or an Error in plain words
/** @param {URLSearchParams} params */
export async function googleFinish(params) {
  const s = pending.get(params.get('state') || '');
  pending.delete(params.get('state') || '');
  if (!s || Date.now() - s.at > TTL) throw new Error('That sign-in took too long or was already used. Try again.');
  if (params.get('error')) throw new Error(/** @type {string} */ (params.get('error')));
  const r = await fetch(`${LOGIN}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: params.get('code') || '', verifier: s.verifier }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !d.name) throw new Error(d.error || 'The sign-in service did not answer. Try again.');
  const name = String(d.name).replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) || String(d.email || '').split('@')[0] || 'Someone';
  const idToken = JWT.test(d.id_token || '') ? String(d.id_token) : '';
  const email = String(d.email || '').toLowerCase();
  if (email) signedIn.set(email, { name, idToken, expires: idToken ? expiryOf(idToken) : 0, at: Date.now() });
  return { email: d.email, name, listed: d.listed === true, picture: PICTURE.test(d.picture) ? String(d.picture) : '', idToken, next: s.next };
}

// Google's ID token from each address's latest sign-in, kept in memory only. Publishing a map online sends it to
// the cloud as proof of whose copy it is; it lasts about an hour, after which Share sends you through Google again.
// A login service from before ID tokens sends none: `update` says so, rather than asking you to sign in again.
const JWT = /^[\w-]{10,2000}\.[\w-]{10,4000}\.[\w-]{10,1000}$/;
/** @type {Map<string, { name: string, idToken: string, expires: number, at: number }>} */
const signedIn = new Map();
/** @param {string} token @returns {number} when it expires, from its own claims (the cloud checks its signature) */
function expiryOf(token) {
  try { return Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp) * 1000 || 0; } catch { return 0; }
}
/**
 * The Google identity this Mac can show the cloud for `email`, or for the latest Google sign-in when no address is
 * given: its address, name and an ID token with at least two minutes left ('' once stale), and `needs`: 'signin'
 * when you must sign in with Google (again), 'update' when the login service sends no ID token.
 * @param {string} [email]
 * @returns {{ email: string, name: string, idToken: string, needs: '' | 'signin' | 'update' }}
 */
export function googleIdentity(email = '') {
  const key = String(email).toLowerCase() || [...signedIn].sort((a, b) => b[1].at - a[1].at)[0]?.[0] || '';
  const got = signedIn.get(key);
  if (!got) return { email: key, name: '', idToken: '', needs: 'signin' };
  const fresh = got.idToken && got.expires - Date.now() > 2 * 60_000 ? got.idToken : '';
  return { email: key, name: got.name, idToken: fresh, needs: fresh ? '' : got.idToken ? 'signin' : 'update' };
}

// a name and password kept at Living Map login, for someone with no Google account: the name to sign in as, or null
/** @param {string} name @param {string} password */
export async function passwordCheck(name, password) {
  if (!LOGIN) return null;
  const r = await fetch(`${LOGIN}/password`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const d = r?.ok ? await r.json().catch(() => ({})) : {};
  return typeof d.name === 'string' && /^[\w .-]{1,40}$/.test(d.name) ? d.name : null;
}
