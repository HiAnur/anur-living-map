// Who may sign in to the team map: a person from the map's people (seed.json) and a password, kept
// scrambled with scrypt in one SQLite file outside the repo, ~/.living-map-2/users.db. Signing in gives
// the browser a cookie; the session behind it is kept in the same file, so a server restart keeps you in.
// Both scrypt and SQLite are built into Node: nothing to install.
//
//   node users.js set <name>      set or change that person's password (asks for it twice)
//   node users.js list            who has a password
//   node users.js remove <name>   take their password away and sign them out

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
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL);`);

const scramble = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');
const sha = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
// a person's name as the map writes it, whatever case it was typed in
const person = (name) => PEOPLE.find((p) => p.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

export const users = {
  // until someone has a password, the map stays open as it was
  any: () => !!db.prepare('SELECT 1 FROM users LIMIT 1').get(),
  // the person a name and password belong to, or null
  check(name, password) {
    const who = person(name), row = who && db.prepare('SELECT salt, hash FROM users WHERE name = ?').get(who);
    if (!row) return null;
    return crypto.timingSafeEqual(Buffer.from(scramble(password, row.salt), 'hex'), Buffer.from(row.hash, 'hex')) ? who : null;
  },
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
    console.log(rows.length ? rows.map((r) => `${r.name}  (set ${r.set_at} UTC)`).join('\n') : 'No one has a password yet, so the map is open.');
  } else if (cmd === 'remove' && who) {
    db.prepare('DELETE FROM users WHERE name = ?').run(who); db.prepare('DELETE FROM sessions WHERE name = ?').run(who);
    console.log(`${who} has no password now and is signed out.`);
  } else if (cmd === 'set' && who) {
    const [one, two] = await askTwice(`New password for ${who}: `, 'Again: ');
    if (one.length < 8) { console.log('Use at least 8 characters.'); process.exit(1); }
    if (one !== two) { console.log('The two passwords differ. Nothing changed.'); process.exit(1); }
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare(`INSERT INTO users (name, salt, hash) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, set_at = datetime('now')`).run(who, salt, scramble(one, salt));
    db.prepare('DELETE FROM sessions WHERE name = ?').run(who);
    console.log(`${who} can sign in now. From now on the map asks everyone to sign in.`);
  } else {
    console.log(`node users.js set <name> | list | remove <name>\nNames: ${PEOPLE.join(', ')}`);
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
