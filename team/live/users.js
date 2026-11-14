// Who you are on this Mac. The server answers only on this Mac, so one person uses it: every page here acts as
// them, an Admin of every map. Their name is the one kept in users.db in the team map's data folder (data-dir.js)
// when there is one, else the Mac account's full name, else its username. Signing in with Google is optional: it
// names you when you have no name kept yet, and adds your Google email and picture. users.db stays as earlier
// installs left it; the passwords and sign-ins kept there are only read, for the name and Google account they
// hold. SQLite is built into Node: nothing to install.
//
//   node users.js list           who you are on this Mac, and the Google account signed in
//   node users.js owner <name>   change the name you go by here

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DATA } from './data-dir.js';

const FILE = process.env.LIVING_MAP_USERS || path.join(DATA, 'users.db');

fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(FILE);
fs.chmodSync(FILE, 0o600);
db.exec(`CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, set_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pictures (name TEXT PRIMARY KEY, url TEXT NOT NULL);`);
if (!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'email')) db.exec('ALTER TABLE sessions ADD COLUMN email TEXT');

/** @param {string} key @returns {string | null} */
const setting = (key) => { const row = /** @type {any} */ (db.prepare('SELECT value FROM settings WHERE key = ?').get(key)); return row ? String(row.value) : null; };
/** @param {string} key @param {string} value */
const setSetting = (key, value) => { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); };
/** @returns {string[]} every account an earlier install made, oldest first */
const accounts = () => db.prepare('SELECT name FROM users ORDER BY rowid').all().map((r) => String(r.name));

// An install from before owners were kept has accounts and no owner: the demo story's Admin who has a password
// owns it, else whoever made the first account, so whoever ran it keeps their name and their maps.
if (!setting('owner') && accounts().length) {
  /** @type {string[]} */ let admins = [];
  try { admins = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'seed.json'), 'utf8')).people.filter((/** @type {any} */ p) => p.role === 'Admin').map((/** @type {any} */ p) => String(p.id)); }
  catch { /* no story beside this file: the first account owns the install */ }
  setSetting('owner', accounts().find((a) => admins.includes(a)) || accounts()[0]);
}

// Names the map itself speaks as, and so no person may take.
const TAKEN = new Set(['claude', 'guest', 'you']);
/** @param {unknown} name */
const tidyName = (name) => String(name || '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/^[^\p{L}\p{N}]+/u, '').trim().replace(/\s+/g, ' ').slice(0, 40).trim();
/**
 * Why a name cannot be yours, or '' when it can: 1 to 40 letters, digits, spaces, dots, dashes or underscores,
 * starting with a letter or digit. Those are safe wherever the map writes a name.
 * @param {string} name
 */
const nameProblem = (name) => {
  if (!name) return 'Type your name.';
  if (name.length > 40) return 'Use a name of 40 characters or fewer.';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) return 'Use letters, digits, spaces, dots and dashes in a name.';
  if (TAKEN.has(name.toLowerCase())) return `${name} is a name the map uses itself. Choose another.`;
  return '';
};

// The Mac account's full name (`id -F`), else its username, asked once.
let /** @type {string | null} */ macName = null;
const macPerson = () => {
  if (macName !== null) return macName;
  let full = '';
  if (process.platform === 'darwin') {
    try { full = execFileSync('id', ['-F'], { encoding: 'utf8', timeout: 2000 }); } catch { /* no full name: the username stands */ }
  }
  let user = '';
  try { user = os.userInfo().username; } catch { /* no account name either: the last fallback below stands */ }
  const name = [full, user].map(tidyName).find((n) => n && !nameProblem(n)) || 'Me';
  macName = name;
  return name;
};

// What an install signed in through Google before this kept: the owner's address, else the latest sign-in with one.
const earlierEmail = () => setting('owner_email') || /** @type {any} */ (db.prepare('SELECT email FROM sessions WHERE name = ? AND email IS NOT NULL ORDER BY at DESC').get(setting('owner') || ''))?.email || '';

export const users = {
  /** @returns {string | null} the name kept for you on this Mac, if any */
  owner: () => setting('owner'),
  /** @returns {string} who you are on this Mac */
  me: () => setting('owner') || macPerson(),
  nameProblem,
  /** Change the name you go by here. @param {unknown} name @returns {{ name: string } | { error: string }} */
  rename(name) {
    const want = String(name || '').trim().replace(/\s+/g, ' '), wrong = nameProblem(want);
    if (wrong) return { error: wrong };
    setSetting('owner', want);
    return { name: want };
  },
  // whether this name signed in on an earlier install, with a password or through Google
  /** @param {string} who */
  known: (who) => !!db.prepare('SELECT 1 FROM users WHERE name = ?').get(who) || !!db.prepare('SELECT 1 FROM sessions WHERE name = ?').get(who),
  /** @returns {string} the Google email you signed in with, or '' */
  googleEmail: () => setting('google_email') ?? earlierEmail(),
  /**
   * Signing in with Google: your email and picture, and your name too while none is kept for you.
   * @param {{ name: string, email?: unknown, picture?: unknown }} got
   */
  signInGoogle(got) {
    if (!setting('owner')) { const name = tidyName(got.name); if (name && !nameProblem(name)) setSetting('owner', name); }
    setSetting('google_email', typeof got.email === 'string' ? got.email.slice(0, 254) : '');
    setSetting('google_picture', typeof got.picture === 'string' ? got.picture : '');
  },
  // signing out of Google forgets the email and picture; you stay who you are
  signOutGoogle: () => { setSetting('google_email', ''); setSetting('google_picture', ''); },
  /** @param {string} name @returns {string} the address of your Google picture, or '' for anyone else */
  pictureOf(name) {
    if (!name || name !== users.me()) return '';
    return setting('google_picture') ?? /** @type {any} */ (db.prepare('SELECT url FROM pictures WHERE name = ?').get(name))?.url ?? '';
  },
};

const USAGE = 'node users.js list | owner <name>';

/**
 * `node users.js …`. Prints what it did; the answer is the exit code.
 * @param {string[]} args @returns {number}
 */
export function cli(args) {
  const [cmd, ...rest] = args;
  if (cmd === 'list') {
    const email = users.googleEmail();
    console.log(`${users.me()}  (you, on this Mac)${email ? `  (Google: ${email})` : ''}`);
    return 0;
  }
  if (cmd === 'owner' && rest.length) {
    const got = users.rename(rest.join(' '));
    console.log('error' in got ? got.error : `You go by ${got.name} on this Mac now.`);
    return 'error' in got ? 1 : 0;
  }
  console.log(USAGE);
  return cmd ? 1 : 0;
}

// Run directly. import.meta.main is newer than the Node 22 the package allows, so the path decides.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename) process.exitCode = cli(process.argv.slice(2));
