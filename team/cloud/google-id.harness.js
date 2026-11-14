// A stand-in for Google's signing keys, shared by the cloud's tests: a key set the checker is handed in place of
// Google's, and ID tokens signed with it. Never calls Google. Not a test itself, and not shipped (prepare.mjs
// leaves *.harness.js out).
import crypto from 'node:crypto';

import { idTokenChecker } from './google-id.js';

export const AUDIENCE = 'test-client.apps.googleusercontent.com';

export function fakeGoogle() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  let fetched = 0;
  const keys = async () => { fetched++; return { keys: [/** @type {JsonWebKey} */ (jwk)] }; };
  /**
   * An ID token for `email`, as Google signs one; `claims` overrides any claim, `key` signs with another key.
   * @param {string} email @param {Record<string, unknown>} [claims] @param {crypto.KeyObject} [key]
   */
  const token = (email, claims = {}, key = privateKey) => {
    const now = Math.floor(Date.now() / 1000);
    const part = (/** @type {object} */ o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = part({ alg: 'RS256', kid: 'test-key', typ: 'JWT' });
    const body = part({ iss: 'https://accounts.google.com', aud: AUDIENCE, sub: crypto.createHash('sha256').update(email).digest('hex').slice(0, 21),
      email, email_verified: true, name: email.split('@')[0].replace(/^./, (c) => c.toUpperCase()), iat: now, exp: now + 3600, ...claims });
    return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
  };
  return { keys, token, check: idTokenChecker({ audience: AUDIENCE, keys }), get fetched() { return fetched; } };
}
