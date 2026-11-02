// Who may sign in to the team map: a person from the map's people (seed.json) and a password, kept
// scrambled with scrypt in one SQLite file outside the repo, ~/.living-map-2/users.db. A person chooses
// their password the first time they sign in; after that only this command changes it. Signing in gives
// the browser a cookie; the session behind it is kept in the same file, so a server restart keeps you in.
// Both scrypt and SQLite are built into Node: nothing to install. Google sign-in (google.js) lets in
// only the Google addresses listed here, each as one person.
//
//   node users.js set <name>              set or change that person's password (asks for it twice)
//   node users.js google <name> <email>   let that Google address sign in as that person
//   node users.js list                    who has a password, and which Google addresses are let in
//   node users.js remove <name>           take their password and Google addresses away and sign them out

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const FILE = process.env.LIVING_MAP_USERS || path.join(os.homedir(), '.living-map-2', 'users.db');
const DAYS = 30;
const PEOPLE = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'seed.json'), 'utf8')).people.map((p) => p.id);

fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(FILE);
fs.chmodSync(FILE, 0o600);
db.exec(`CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, set_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS emails (email TEXT PRIMARY KEY, name TEXT NOT NULL);`);

const scramble = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');
const sha = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
// a person's name as the map writes it, whatever case it was typed in
const person = (name) => PEOPLE.find((p) => p.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

const setPassword = (who, password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare(`INSERT INTO users (name, salt, hash) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, set_at = datetime('now')`).run(who, salt, scramble(password, salt));
  db.prepare('DELETE FROM sessions WHERE name = ?').run(who);
};
export const MIN = 8;

export const users = {
  person,
  // whether this person has chosen a password yet
  has: (who) => !!db.prepare('SELECT 1 FROM users WHERE name = ?').get(who),
  // a person's first password, chosen on the sign-in page; changing one later is node users.js set
  first(name, password) {
    const who = person(name);
    if (!who || users.has(who) || String(password || '').length < MIN) return null;
    setPassword(who, String(password)); return who;
  },
  // the person a name and password belong to, or null
  check(name, password) {
    const who = person(name), row = who && db.prepare('SELECT salt, hash FROM users WHERE name = ?').get(who);
    if (!row) return null;
    return crypto.timingSafeEqual(Buffer.from(scramble(password, row.salt), 'hex'), Buffer.from(row.hash, 'hex')) ? who : null;
  },
  // the person a Google address signs in as, or null when it is not on the list
  byEmail: (email) => db.prepare('SELECT name FROM emails WHERE email = ?').get(String(email || '').toLowerCase())?.name || null,
  start(name) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, name, at) VALUES (?, ?, ?)').run(sha(token), name, Date.now());
    return token;
  },
  // who a browser's cookie belongs to, or null once it is unknown or older than 30 days
  whoIs(token) {
    if (!token) return null;
    const row = db.prepare('SELECT name, at FROM sessions WHERE token_hash = ?').get(sha(token));
    return row && Date.now() - row.at < DAYS * 86_400_000 ? row.name : null;
  },
  end: (token) => { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token)); },
  maxAge: DAYS * 86_400,
};

// node users.js …
if (import.meta.main) {
  const [cmd, name] = process.argv.slice(2), who = person(name);
  if (cmd === 'list') {
    const rows = db.prepare('SELECT name, set_at FROM users ORDER BY name').all();
    console.log(rows.length ? rows.map((r) => `${r.name}  (set ${r.set_at} UTC)`).join('\n') : 'No one has a password yet. Each person chooses one the first time they sign in.');
    const mails = db.prepare('SELECT email, name FROM emails ORDER BY name, email').all();
    console.log(mails.length ? `\nGoogle sign-in:\n${mails.map((m) => `${m.email}  as ${m.name}`).join('\n')}` : '\nNo Google address is let in yet: node users.js google <name> <email>');
  } else if (cmd === 'google' && who && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(process.argv[4] || '')) {
    const email = process.argv[4].toLowerCase();
    db.prepare('INSERT INTO emails (email, name) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name').run(email, who);
    console.log(`${email} can sign in with Google as ${who} now.`);
  } else if (cmd === 'remove' && who) {
    db.prepare('DELETE FROM users WHERE name = ?').run(who); db.prepare('DELETE FROM sessions WHERE name = ?').run(who);
    db.prepare('DELETE FROM emails WHERE name = ?').run(who);
    console.log(`${who} has no password or Google address now and is signed out.`);
  } else if (cmd === 'set' && who) {
    const [one, two] = await askTwice(`New password for ${who}: `, 'Again: ');
    if (one.length < MIN) { console.log(`Use at least ${MIN} characters. Nothing changed.`); process.exit(1); }
    if (one !== two) { console.log('The two passwords differ. Nothing changed.'); process.exit(1); }
    setPassword(who, one);
    console.log(`${who} can sign in now with this password.`);
  } else {
    console.log(`node users.js set <name> | google <name> <email> | list | remove <name>\nNames: ${PEOPLE.join(', ')}`);
    process.exit(cmd ? 1 : 0);
  }
}

// asks twice without showing what is typed; piped in, it reads two lines
async function askTwice(q1, q2) {
  if (!process.stdin.isTTY) {
    let all = ''; for await (const c of process.stdin) all += c;
    const [a = '', b = ''] = all.split(/\r?\n/); return [a, b];
  }
  const ask = (q) => new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(q); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); ok(a); });
  });
  return [await ask(q1), await ask(q2)];
}
