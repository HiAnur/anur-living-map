// Sign in with Google. Google says which address you are; users.db says which person on the map that address is
// (node users.js google <name> <address>). The OAuth client is LIVING_MAP_GOOGLE_CLIENT_ID and _SECRET, a
// "Web application" client whose redirect URIs list <the map's address>/auth/google/callback for every address
// the map is opened at (http://localhost:4322, https://map.example.com). The flow is Google's own for a web
// server, with PKCE: /auth/google → Google → /auth/google/callback → the same session cookie a password gives.
import crypto from 'node:crypto';

const ID = process.env.LIVING_MAP_GOOGLE_CLIENT_ID || '', SECRET = process.env.LIVING_MAP_GOOGLE_CLIENT_SECRET || '';
const TTL = 10 * 60_000;
const pending = new Map(); // state → { verifier, origin, next, at }
const token = (n) => crypto.randomBytes(n).toString('base64url');

export const googleOn = () => !!(ID && SECRET);

// the address to send the browser to at Google; origin is where the map was opened, next the page to go back to
export function googleStart(origin, next) {
  for (const [k, v] of pending) if (Date.now() - v.at > TTL) pending.delete(k);
  const state = token(16), verifier = token(32);
  pending.set(state, { verifier, origin, next, at: Date.now() });
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: ID, redirect_uri: `${origin}/auth/google/callback`, response_type: 'code', scope: 'openid email',
    state, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    prompt: 'select_account',
  })}`;
}

// Google's answer on /auth/google/callback: the verified address and the page to go back to, or an Error in plain words
export async function googleFinish(params) {
  const s = pending.get(params.get('state') || '');
  pending.delete(params.get('state') || '');
  if (!s || Date.now() - s.at > TTL) throw new Error('That sign-in took too long or was already used. Try again.');
  if (params.get('error')) throw new Error(params.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google said: ${params.get('error')}.`);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: params.get('code') || '', code_verifier: s.verifier, grant_type: 'authorization_code',
      client_id: ID, client_secret: SECRET, redirect_uri: `${s.origin}/auth/google/callback` }),
  }).catch(() => null);
  const body = r ? await r.json().catch(() => ({})) : {};
  if (!r?.ok || !body.id_token) throw new Error('Google did not confirm the sign-in. Try again.');
  // Straight from Google's token address over TLS, so TLS stands in for the signature check
  // (OpenID Connect Core 3.1.3.7); audience, issuer and expiry are still checked.
  const c = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString('utf8'));
  if (c.aud !== ID || !['accounts.google.com', 'https://accounts.google.com'].includes(c.iss) || c.exp * 1000 < Date.now())
    throw new Error('Google did not confirm the sign-in. Try again.');
  if (!(c.email_verified === true || c.email_verified === 'true')) throw new Error('Google has not verified that address.');
  return { email: String(c.email).toLowerCase(), next: s.next };
}
