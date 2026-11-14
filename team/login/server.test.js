import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';

import { afterAll, beforeAll, expect, it } from 'vitest';

// Where Living Map login may send a browser back to: a map on the person's own Mac, or an online copy whose
// origin RETURN_ORIGINS lists, and nowhere else. Only /start runs here, which goes no further than Google's
// address, so nothing calls Google.
/** @type {import('node:child_process').ChildProcess} */ let child;
let origin = '';
beforeAll(async () => {
  const reserve = http.createServer(); await new Promise((r) => reserve.listen(0, '127.0.0.1', /** @type {() => void} */ (r)));
  const port = /** @type {import('node:net').AddressInfo} */ (reserve.address()).port; await new Promise((r) => reserve.close(r));
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], { cwd: import.meta.dirname, stdio: 'ignore', env: { ...process.env, PORT: String(port), K_SERVICE: '',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', SEAL_KEY: crypto.randomBytes(32).toString('base64'),
    RETURN_ORIGINS: 'https://maps.example.com, http://plain.example.com, https://bad.example.com/path' } });
  for (let i = 0; ; i++) {
    try { if ((await fetch(origin)).ok) break; } catch { /* not listening yet */ }
    if (i > 100) throw new Error('The login service did not start');
    await new Promise((r) => setTimeout(r, 50));
  }
});
afterAll(() => { child?.kill(); });

const start = (/** @type {string} */ back) => fetch(`${origin}/start?${new URLSearchParams({ return: back, state: 's'.repeat(16), challenge: 'c'.repeat(43) })}`, { redirect: 'manual' });

it('sends a Mac\'s map and a listed online copy to Google, and refuses any other return address', async () => {
  for (const back of ['http://localhost:4323/auth/done', 'https://maps.example.com/auth/done']) {
    const r = await start(back);
    expect(r.status, back).toBe(302);
    expect(r.headers.get('location')).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?.*scope=openid\+email\+profile/);
  }
  for (const back of ['https://evil.example.com/auth/done', 'https://maps.example.com/elsewhere', 'https://maps.example.com.evil.example/auth/done',
    'http://plain.example.com/auth/done', 'https://bad.example.com/path/auth/done', 'http://localhost.evil.example/auth/done'])
    expect((await start(back)).status, back).toBe(400);
});
