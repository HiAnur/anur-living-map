import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRecovery, recoveryStore, sendRecoveryMail } from './recovery.js';

const cleanup = [];
afterEach(async () => { vi.unstubAllGlobals(); while (cleanup.length) await cleanup.pop()(); });
function fixture() {
  const db = new DatabaseSync(':memory:'); cleanup.push(() => db.close());
  db.exec("CREATE TABLE users (name TEXT PRIMARY KEY); INSERT INTO users VALUES ('Tester'); CREATE TABLE sessions (name TEXT); INSERT INTO sessions VALUES ('Tester');");
  let password = 'old-password', time = Date.now();
  const recovery = recoveryStore(db, (name, value) => { password = value; db.prepare('DELETE FROM sessions WHERE name = ?').run(name); }, () => time);
  const users = { person: (name) => name?.toLowerCase() === 'tester' ? 'Tester' : null, has: (name) => !!db.prepare('SELECT 1 FROM users WHERE name = ?').get(name), check: (name, value) => name === 'Tester' && value === password ? name : null };
  return { db, recovery, users, later: () => { time += 16 * 60000; } };
}
async function api({ failMail = false, configured = true } = {}) {
  const f = fixture(), mail = [];
  const server = http.createServer((req, res) => handleRecovery(req, res, { ...f, port: /** @type {import('node:net').AddressInfo} */ (server.address()).port, configured, send: async (...args) => { if (failMail) throw new Error('offline'); mail.push(args); } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', /** @type {() => void} */ (resolve)));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const post = async (action, data, headers = {}) => {
    const r = await fetch(`${origin}/api/recovery/${action}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  };
  return { ...f, mail, post, token: () => new URLSearchParams(new URL(mail.at(-1)[1]).hash.slice(1)).values().next().value };
}
describe('email password recovery', () => {
  it('verifies a mailbox, resets once, and signs out old browsers', async () => {
    const f = await api();
    expect((await f.post('email', { name: 'Tester', password: 'old-password', email: 'tester@example.com' })).status).toBe(200);
    const verify = f.token();
    expect(f.recovery.email('Tester')).toBeUndefined();
    expect(JSON.stringify(f.db.prepare('SELECT * FROM recovery_tokens').all())).not.toContain(verify);
    expect((await f.post('verify', { token: verify })).status).toBe(200);
    expect((await f.post('verify', { token: verify })).status).toBe(400);
    expect(f.recovery.email('Tester')).toBe('tester@example.com');
    expect((await f.post('forgot', { name: 'Tester' })).status).toBe(200);
    const reset = f.token();
    expect((await f.post('reset', { token: reset, password: 'short' })).status).toBe(400);
    expect((await f.post('reset', { token: reset, password: 'new-password' })).status).toBe(200);
    expect(f.users.check('Tester', 'old-password')).toBeNull();
    expect(f.users.check('Tester', 'new-password')).toBe('Tester');
    expect(f.db.prepare('SELECT * FROM sessions').all()).toEqual([]);
    expect((await f.post('reset', { token: reset, password: 'another-password' })).status).toBe(400);
  });
  it('does not enroll an address without the current password or send to unknown accounts', async () => {
    const f = await api();
    expect((await f.post('email', { name: 'Tester', password: 'wrong', email: 'attacker@example.com' })).status).toBe(401);
    const unknown = await f.post('forgot', { name: 'Missing' });
    const unverified = await f.post('forgot', { name: 'Tester' });
    expect(unknown).toEqual(unverified); expect(f.mail).toEqual([]);
  });
  it('rejects expired links, wrong purpose and replaced verification links', () => {
    const f = fixture();
    const old = f.recovery.issue('Tester', 'tester@example.com', 'verify');
    const current = f.recovery.issue('Tester', 'tester@example.com', 'verify');
    expect(f.recovery.use(old, 'verify')).toBe(false);
    expect(f.recovery.use(current, 'reset', 'new-password')).toBe(false);
    f.later(); expect(f.recovery.use(current, 'verify')).toBe(false);
  });
  it('invalidates reset links when the recovery address changes', () => {
    const f = fixture();
    f.recovery.use(f.recovery.issue('Tester', 'first@example.com', 'verify'), 'verify');
    const reset = f.recovery.issue('Tester', 'first@example.com', 'reset');
    f.recovery.use(f.recovery.issue('Tester', 'second@example.com', 'verify'), 'verify');
    expect(f.recovery.use(reset, 'reset', 'new-password')).toBe(false);
  });
  it('blocks foreign origins and limits email requests', async () => {
    const f = await api();
    expect((await f.post('forgot', { name: 'Tester' }, { origin: 'https://other.example' })).status).toBe(403);
    for (let i = 0; i < 3; i++) expect((await f.post('forgot', { name: 'Tester' })).status).toBe(200);
    expect((await f.post('forgot', { name: 'Tester' })).status).toBe(429);
  });
  it('reports unavailable delivery and revokes links after delivery failure', async () => {
    const f = await api({ failMail: true });
    expect((await f.post('email', { name: 'Tester', password: 'old-password', email: 'tester@example.com' })).status).toBe(503);
    expect(f.db.prepare('SELECT * FROM recovery_tokens').all()).toEqual([]);
    const g = await api({ configured: false });
    expect((await g.post('forgot', { name: 'Tester' })).status).toBe(503);
  });
  it('sends the recovery link through the configured sender and surfaces delivery failures', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
    await sendRecoveryMail('tester@example.com', 'http://localhost:4323/login#verify=example', true, { key: 'test-key', from: 'Living Map <no-reply@example.com>' });
    const [url, request] = fetch.mock.calls[0], payload = JSON.parse(request.body);
    expect(url).toBe('https://api.resend.com/emails');
    expect(payload.from).toBe('Living Map <no-reply@example.com>');
    expect(payload.to).toEqual(['tester@example.com']);
    expect(payload.text).toContain('http://localhost:4323/login#verify=example');
    fetch.mockResolvedValue({ ok: false });
    await expect(sendRecoveryMail('tester@example.com', 'link', false, { key: 'test-key', from: 'sender@example.com' })).rejects.toThrow('could not be sent');
  });
  it('requires a configured sender before sending email', async () => {
    await expect(sendRecoveryMail('tester@example.com', 'http://localhost:4323/login#reset=test', false, {})).rejects.toThrow('not set up');
  });
});
