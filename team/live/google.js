// Sign in with Google, through Living Map login (login/server.js, on Cloud Run). Anyone with a Google account
// gets in. The browser goes there, Google says who it is, and it comes back to /auth/done with a one-time code
// that only this server can trade (it keeps the secret the code was asked with) for the person. LIVING_MAP_LOGIN_URL points at another login service; empty turns Google off.
import crypto from 'node:crypto';

const LOGIN = (process.env.LIVING_MAP_LOGIN_URL ?? 'https://living-map-login-572969880390.us-west1.run.app').replace(/\/$/, '');
const TTL = 10 * 60_000;
const pending = new Map(); // state → { verifier, origin, next, at }
const token = (n) => crypto.randomBytes(n).toString('base64url');

export const googleOn = () => !!LOGIN;

// where to send the browser: origin is this map's own address (http://localhost:4322), next the page to go back to
export function googleStart(origin, next) {
  for (const [k, v] of pending) if (Date.now() - v.at > TTL) pending.delete(k);
  const state = token(16), verifier = token(32);
  pending.set(state, { verifier, next, at: Date.now() });
  return `${LOGIN}/start?${new URLSearchParams({ return: `${origin}/auth/done`, state,
    challenge: crypto.createHash('sha256').update(verifier).digest('base64url') })}`;
}

// what came back on /auth/done: the person and the page to go back to, or an Error in plain words
export async function googleFinish(params) {
  const s = pending.get(params.get('state') || '');
  pending.delete(params.get('state') || '');
  if (!s || Date.now() - s.at > TTL) throw new Error('That sign-in took too long or was already used. Try again.');
  if (params.get('error')) throw new Error(params.get('error'));
  const r = await fetch(`${LOGIN}/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: params.get('code') || '', verifier: s.verifier }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !d.name) throw new Error(d.error || 'The sign-in service did not answer. Try again.');
  const name = String(d.name).replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) || String(d.email || '').split('@')[0] || 'Someone';
  return { email: d.email, name, next: s.next };
}

// a name and password kept at Living Map login, for someone with no Google account: the name to sign in as, or null
export async function passwordCheck(name, password) {
  if (!LOGIN) return null;
  const r = await fetch(`${LOGIN}/password`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const d = r?.ok ? await r.json().catch(() => ({})) : {};
  return typeof d.name === 'string' && /^[\w .-]{1,40}$/.test(d.name) ? d.name : null;
}
