// Who may sign in to the team map: a person from the map's people (seed.json) and a password, kept
// scrambled with scrypt in one SQLite file outside the repo, users.db in the team map's data folder (data-dir.js). A person chooses
// their password the first time they sign in; later they can recover it through a verified email. Signing in gives
// the browser a cookie; the session behind it is kept in the same file, so a server restart keeps you in.
// Both scrypt and SQLite are built into Node: nothing to install.
//
//   node users.js set <name>      set or change that person's password (asks for it twice)
//   node users.js list            who has a password
//   node users.js remove <name>   take their password away and sign them out

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

import { recoveryStore } from './recovery.js';
import { DATA } from './data-dir.js';

const FILE = process.env.LIVING_MAP_USERS || path.join(DATA, 'users.db');
const DAYS = 30;
/** @type {string[]} */
const PEOPLE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'seed.json'), 'utf8')).people.map((/** @type {{ id: string }} */ p) => p.id);

fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(FILE);
fs.chmodSync(FILE, 0o600);
db.exec(`CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, set_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL);`);
// A session through Google also keeps the address Google gave, so Settings can show the email you signed in with.
// A file made before sessions kept one gets the column here.
if (!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'email')) db.exec('ALTER TABLE sessions ADD COLUMN email TEXT');

/** @param {unknown} password @param {string} salt */
const scramble = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');
/** @param {unknown} token */
const sha = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
// a person's name as the map writes it, whatever case it was typed in
/** @param {unknown} name */
const person = (name) => PEOPLE.find((p) => p.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

/** @param {string} who @param {string} password */
const setPassword = (who, password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO users (name, salt, hash) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, set_at = datetime('now')`).run(who, salt, scramble(password, salt));
  db.prepare('DELETE FROM sessions WHERE name = ?').run(who);
  db.prepare('DELETE FROM recovery_tokens WHERE name = ?').run(who);
};
export const MIN = 8;
export const recovery = recoveryStore(db, setPassword);

export const users = {
  person,
  // whether this person has chosen a password yet
  /** @param {string} who */
  has: (who) => !!db.prepare('SELECT 1 FROM users WHERE name = ?').get(who),
  // a person's first password, chosen on the sign-in page
  /** @param {unknown} name @param {unknown} password */
  first(name, password) {
    const who = person(name);
    if (!who || users.has(who) || String(password || '').length < MIN) return null;
    setPassword(who, String(password)); return who;
  },
  // the person a name and password belong to, or null
  /** @param {unknown} name @param {unknown} password */
  check(name, password) {
    const who = person(name), row = who && /** @type {any} */ (db.prepare('SELECT salt, hash FROM users WHERE name = ?').get(who));
    if (!row) return null;
    return crypto.timingSafeEqual(Buffer.from(scramble(password, row.salt), 'hex'), Buffer.from(row.hash, 'hex')) ? who : null;
  },
  /** @param {string} name @param {string | null} [email] the address Google gave, for a sign-in through Google */
  start(name, email = null) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, name, at, email) VALUES (?, ?, ?, ?)').run(sha(token), name, Date.now(), email);
    return token;
  },
  // the email this browser signed in with through Google, or '' for any other sign-in
  /** @param {unknown} token @returns {string} */
  emailOf(token) {
    if (!token) return '';
    const row = /** @type {any} */ (db.prepare('SELECT email, at FROM sessions WHERE token_hash = ?').get(sha(token)));
    return row && Date.now() - row.at < DAYS * 86_400_000 ? row.email || '' : '';
  },
  // who a browser's cookie belongs to, or null once it is unknown or older than 30 days
  /** @param {unknown} token */
  whoIs(token) {
    if (!token) return null;
    const row = /** @type {any} */ (db.prepare('SELECT name, at FROM sessions WHERE token_hash = ?').get(sha(token)));
    return row && Date.now() - row.at < DAYS * 86_400_000 ? row.name : null;
  },
  /** @param {unknown} token */
  end: (token) => { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); },
  maxAge: DAYS * 86_400,
};

// node users.js …
if (import.meta.main) {
  const [cmd, name] = process.argv.slice(2), who = person(name);
  if (cmd === 'list') {
    const rows = db.prepare('SELECT name, set_at FROM users ORDER BY name').all();
    console.log(rows.length ? rows.map((r) => `${r.name}  (set ${r.set_at} UTC)`).join('\n') : 'No one has a password yet. Each person chooses one the first time they sign in.');
  } else if (cmd === 'remove' && who) {
    db.prepare('DELETE FROM users WHERE name = ?').run(who); db.prepare('DELETE FROM sessions WHERE name = ?').run(who);
    recovery.clear(who); db.prepare('DELETE FROM recovery_emails WHERE name = ?').run(who);
    console.log(`${who} has no password now and is signed out.`);
  } else if (cmd === 'set' && who) {
    const [one, two] = await askTwice(`New password for ${who}: `, 'Again: ');
    if (one.length < MIN) { console.log(`Use at least ${MIN} characters. Nothing changed.`); process.exit(1); }
    if (one !== two) { console.log('The two passwords differ. Nothing changed.'); process.exit(1); }
    setPassword(who, one);
    console.log(`${who} can sign in now with this password.`);
  } else {
    console.log(`node users.js set <name> | list | remove <name>\nNames: ${PEOPLE.join(', ')}`);
    process.exit(cmd ? 1 : 0);
  }
}

// asks twice without showing what is typed; piped in, it reads two lines
/** @param {string} q1 @param {string} q2 */
async function askTwice(q1, q2) {
  if (!process.stdin.isTTY) {
    let all = ''; for await (const c of process.stdin) all += c;
    const [a = '', b = ''] = all.split(/\r?\n/); return [a, b];
  }
  /** @param {string} q */
  const ask = (q) => new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    /** @type {any} */ (rl)._writeToOutput = (/** @type {string} */ s) => { if (s.includes(q)) process.stdout.write(q); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); ok(a); });
  });
  return [await ask(q1), await ask(q2)];
}
