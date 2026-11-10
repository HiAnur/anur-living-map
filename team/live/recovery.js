// Recovery links prove control of a previously verified mailbox. Only hashes are stored;
// a password change consumes every outstanding link and signs out existing browsers.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DATA } from './data-dir.js';

/** @param {unknown} value */
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
/** @param {unknown} value */
export const validEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
/** @param {Sqlite} db @param {(name: string, password: string) => void} setPassword @param {() => number} [now] */
export function recoveryStore(db, setPassword, now = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_emails (name TEXT PRIMARY KEY, email TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_tokens (hash TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_limits (key TEXT PRIMARY KEY, at INTEGER NOT NULL, count INTEGER NOT NULL);`);
  /** @param {string} name */
  const clear = (name) => db.prepare('DELETE FROM recovery_tokens WHERE name = ?').run(name);
  return {
    clear,
    /** @param {string} name */
    email: (name) => db.prepare('SELECT email FROM recovery_emails WHERE name = ?').get(name)?.email,
    /** @param {string} key @param {number} [limit] @param {number} [window] */
    allow(key, limit = 5, window = 3600000) {
      db.prepare('DELETE FROM recovery_limits WHERE at <= ?').run(now() - 3600000);
      const k = hash(key), row = db.prepare('SELECT at, count FROM recovery_limits WHERE key = ?').get(k);
      if (row && now() - row.at < window && row.count >= limit) return false;
      db.prepare('INSERT OR REPLACE INTO recovery_limits VALUES (?, ?, ?)').run(k, row && now() - row.at < window ? row.at : now(), row && now() - row.at < window ? row.count + 1 : 1);
      return true;
    },
    /** @param {string} name @param {string} email @param {string} kind */
    issue(name, email, kind) {
      db.prepare('DELETE FROM recovery_tokens WHERE expires <= ? OR (name = ? AND kind = ?)').run(now(), name, kind);
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO recovery_tokens VALUES (?, ?, ?, ?, ?)').run(hash(token), name, email, kind, now() + 15 * 60000);
      return token;
    },
    /** @param {string} token */
    revoke(token) { db.prepare('DELETE FROM recovery_tokens WHERE hash = ?').run(hash(token)); },
    /** @param {unknown} token @param {string} kind @param {unknown} [password] */
    use(token, kind, password) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
      if (kind === 'reset' && (typeof password !== 'string' || password.length < 8 || password.length > 1024)) return false;
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT * FROM recovery_tokens WHERE hash = ? AND kind = ? AND expires > ?').get(hash(token), kind, now());
        if (!row || !db.prepare('SELECT 1 FROM users WHERE name = ?').get(row.name)) { db.exec('ROLLBACK'); return false; }
        if (kind === 'verify') {
          db.prepare('INSERT OR REPLACE INTO recovery_emails VALUES (?, ?)').run(row.name, row.email);
          clear(row.name);
        } else if (kind === 'reset' && this.email(row.name) === row.email) {
          setPassword(row.name, /** @type {string} */ (password));
          clear(row.name);
        } else { db.exec('ROLLBACK'); return false; }
        db.exec('COMMIT'); return true;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

// Kept outside the checkout so updates cannot overwrite the sender's credentials.
export function mailConfig() {
  /** @type {{ key?: string, from?: string }} */
  let config = {};
  try { config = JSON.parse(fs.readFileSync(process.env.LIVING_MAP_MAIL_CONFIG || path.join(DATA, 'mail.json'), 'utf8')); } catch { /* no mail file: the environment may still configure mail */ }
  return { key: process.env.RESEND_API_KEY || config.key, from: process.env.LIVING_MAP_MAIL_FROM || config.from };
}
/** @param {string} to @param {string} link @param {boolean} verify */
export async function sendRecoveryMail(to, link, verify, /** @type {any} */ config = mailConfig()) {
  if (!config.key || !config.from) throw new Error('Email recovery is not set up on this Mac yet.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: config.from, to: [to], subject: verify ? 'Verify your Living Map recovery email' : 'Reset your Living Map password',
      text: `${verify ? 'Verify your recovery email' : 'Choose a new password'} by opening this link on the Mac running Living Map:\n\n${link}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.` }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('The email could not be sent. Please try again later.');
}

/** @param {any} req @param {any} res @param {any} options */
export async function handleRecovery(req, res, { users, recovery, port, send = sendRecoveryMail, configured }) {
  const route = new URL(req.url, 'http://localhost').pathname;
  if (!['/api/recovery/email', '/api/recovery/forgot', '/api/recovery/verify', '/api/recovery/reset'].includes(route)) return false;
  /** @param {number} code @param {unknown} data */
  const reply = (code, data) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
  // These browser endpoints never accept another site's requests or a spoofed reset-link host.
  const host = req.headers.host || '', origin = `http://${host}`;
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host) || host.split(':')[1] !== String(port) || req.headers.origin !== origin) return reply(403, { error: 'Open this page on the Mac running Living Map.' });
  if (req.method !== 'POST') return reply(405, { error: 'Use the recovery form.' });
  if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'Use the recovery form.' });
  let data;
  try { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 8192) return reply(413, { error: 'That request is too long.' }); } data = JSON.parse(raw); if (!data || typeof data !== 'object') throw new Error(); }
  catch { return reply(400, { error: 'Check the form and try again.' }); }
  if (!recovery.allow(`requests:${req.socket.remoteAddress}`, 60)) return reply(429, { error: 'Too many attempts. Try again in an hour.' });
  try {
    if (route.endsWith('/verify')) return recovery.use(data.token, 'verify') ? reply(200, { message: 'Your recovery email is verified.' }) : reply(400, { error: 'That link has expired or was already used. Request a new email.' });
    if (route.endsWith('/reset')) return recovery.use(data.token, 'reset', data.password) ? reply(200, { message: 'Your password has been changed. Sign in with your new password.' }) : reply(400, { error: 'Use at least 8 characters. If the link has expired or was already used, request a new one.' });
    if (configured === undefined) { const config = mailConfig(); configured = !!(config.key && config.from); }
    if (!configured) return reply(503, { error: 'Email recovery is not set up on this Mac yet.' });
    const name = users.person(data.name), generic = 'If this account has a verified recovery email, a reset link is on its way. Check your inbox and spam folder.';
    const key = `mail:${String(data.name || '').trim().toLowerCase()}`;
    if (!recovery.allow(key, 3)) return reply(429, { error: 'Too many email requests. Try again in an hour.' });
    let email, kind;
    if (route.endsWith('/email')) {
      if (typeof data.password !== 'string' || data.password.length > 1024 || !name || !users.check(name, data.password)) return reply(401, { error: 'That username and current password are not right.' });
      email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      if (!validEmail(email)) return reply(400, { error: 'Enter a valid email address.' });
      kind = 'verify';
    } else {
      email = name && users.has(name) && recovery.email(name); kind = 'reset';
      if (!email) return reply(200, { message: generic });
    }
    const token = recovery.issue(name, email, kind), link = `${origin}/login#${kind}=${token}`;
    // A reset request always returns before delivery, so response timing does not reveal an account.
    if (kind === 'reset') { void send(email, link, false).catch(() => recovery.revoke(token)); return reply(200, { message: generic }); }
    try { await send(email, link, true); } catch (e) { recovery.revoke(token); throw e; }
    return reply(200, { message: kind === 'verify' ? 'Check your email to verify this recovery address. Open the link on this Mac.' : generic });
  } catch { return reply(503, { error: 'The email could not be sent. Please try again later.' }); }
}
