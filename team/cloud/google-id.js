// Who a Google ID token says someone is, checked against Google's public keys: no secret is needed, so the cloud
// holds none for it. The token must be signed by Google (RS256), meant for the login service's client, unexpired,
// and for an address Google has verified. Anything else is refused.
import crypto from 'node:crypto';

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const SKEW = 60_000;

/** Google's key set and how long it may be kept, from its cache header. */
async function googleKeys() {
  const r = await fetch(CERTS, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('Google keys unavailable');
  const age = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') || '')?.[1] || 3600);
  return { ...(await r.json()), maxAge: Math.min(age, 86_400) * 1000 };
}

/** @param {string} s */
const part = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
// a name as the map shows it: letters, digits and a few marks, at most 40 characters
/** @param {unknown} s */
export const plainName = (s) => String(s || '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40);

/**
 * A checker for ID tokens meant for `audience`. `keys` stands in for Google's key set in tests; `now` for the clock.
 * @param {{ audience: string, keys?: () => Promise<{ keys: JsonWebKey[], maxAge?: number }>, now?: () => number }} options
 * @returns {(token: unknown) => Promise<{ email: string, name: string }>} the verified address (lowercase) and name
 */
export function idTokenChecker({ audience, keys = googleKeys, now = Date.now }) {
  /** @type {{ byKid: Map<string, crypto.KeyObject>, until: number } | null} */
  let cache = null, lastFetch = 0;
  /** @param {string} kid */
  const keyFor = async (kid) => {
    // a key Google rotated in is fetched at most once a minute, so a stream of made-up key ids costs nothing
    if (!cache || cache.until < now() || (!cache.byKid.has(kid) && now() - lastFetch > 60_000)) {
      lastFetch = now();
      const set = await keys();
      const byKid = new Map();
      for (const k of set.keys || []) if (k.kty === 'RSA' && typeof /** @type {any} */ (k).kid === 'string') byKid.set(/** @type {any} */ (k).kid, crypto.createPublicKey({ key: /** @type {any} */ (k), format: 'jwk' }));
      cache = { byKid, until: now() + (set.maxAge ?? 3_600_000) };
    }
    return cache.byKid.get(kid);
  };
  return async (token) => {
    const refuse = () => Object.assign(new Error('Google did not confirm who you are. Sign in with Google again.'), { status: 401 });
    if (!audience) throw Object.assign(new Error('Google sign-in is not set up on this cloud.'), { status: 503 });
    if (typeof token !== 'string' || token.length > 4096) throw refuse();
    const [head, body, sig, extra] = token.split('.');
    if (!head || !body || !sig || extra !== undefined) throw refuse();
    /** @type {any} */ let h, c;
    try { h = part(head); c = part(body); } catch { throw refuse(); }
    if (h?.alg !== 'RS256' || typeof h.kid !== 'string') throw refuse();
    let key;
    try { key = await keyFor(h.kid); } catch { throw Object.assign(new Error('Google could not be reached to check your sign-in. Try again.'), { status: 503 }); }
    if (!key || !crypto.verify('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(sig, 'base64url'))) throw refuse();
    if (!ISSUERS.includes(c.iss) || c.aud !== audience || !(c.exp * 1000 > now() - SKEW) || !(c.iat * 1000 < now() + SKEW)) throw refuse();
    if (!(c.email_verified === true || c.email_verified === 'true')) throw Object.assign(new Error('Google has not verified that address.'), { status: 401 });
    const email = String(c.email || '').toLowerCase();
    if (!validEmail(email)) throw refuse();
    return { email, name: plainName(c.name) || email.split('@')[0] };
  };
}

// an address as the people list keeps it: already lowercase, one @, a dot in its domain, nothing that could
// break a page or a header
/** @param {unknown} s */
export const validEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(s);
