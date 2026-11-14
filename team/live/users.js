// Who may sign in to the team map: an account (any name and a password, kept scrambled with scrypt) in one SQLite
// file outside the repo, users.db in the team map's data folder (data-dir.js). The first account on an install, or
// the first person to sign in through Google there, is its owner; everyone after joins with a one-use invite the
// owner made, so nobody can take a name by typing it first. A forgotten password is reset with a one-use link: by a
// verified email where mail is set up, else printed by `users.js reset` on this Mac. Signing in gives the browser a
// cookie; the session behind it is kept in the same file, so a server restart keeps you in. Both scrypt and SQLite
// are built into Node: nothing to install.
//
//   node users.js reset <name> [--port 4323]   print a one-use link where that person chooses a new password
//   node users.js set <name>                   set or change a password (asks twice; needs a terminal)
//   node users.js set <name> --password-stdin  the same for a script, the password on the first line of stdin
//   node users.js list                         who has an account, and who owns this install
//   node users.js owner <name>                 make that person (an account, or someone who signed in here) the owner
//   node users.js remove <name>                take their account away and sign them out

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

import { recoveryStore } from './recovery.js';
import { DATA } from './data-dir.js';

const FILE = process.env.LIVING_MAP_USERS || path.join(DATA, 'users.db');
const DAYS = 30, INVITE_DAYS = 7;

fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(FILE);
fs.chmodSync(FILE, 0o600);
db.exec(`CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, set_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, name TEXT NOT NULL, by TEXT NOT NULL, expires INTEGER NOT NULL);`);
// A session through Google also keeps the address Google gave, so Settings can show the email you signed in with.
// A file made before sessions kept one gets the column here.
if (!db.prepare('PRAGMA table_info(sessions)').all().some((c) => c.name === 'email')) db.exec('ALTER TABLE sessions ADD COLUMN email TEXT');
// The picture Google has for a person, as its address, from their latest sign-in through Google: every map draws
// it on their face, for them and for the people they share a map with.
db.exec('CREATE TABLE IF NOT EXISTS pictures (name TEXT PRIMARY KEY, url TEXT NOT NULL)');

/** @param {unknown} password @param {string} salt */
const scramble = (password, salt) => crypto.scryptSync(String(password), salt, 64).toString('hex');
/** @param {unknown} token */
const sha = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
/** @returns {string[]} every account's name, oldest first */
const accounts = () => db.prepare('SELECT name FROM users ORDER BY rowid').all().map((r) => String(r.name));
// an account's name as it was made, whatever case it was typed in
/** @param {unknown} name */
const person = (name) => { const want = String(name || '').trim().toLowerCase(); return want ? accounts().find((p) => p.toLowerCase() === want) || null : null; };
/** @returns {string | null} */
const owner = () => /** @type {any} */ (db.prepare("SELECT value FROM settings WHERE key = 'owner'").get())?.value || null;
/** @param {string} key @param {string} value */
const setSetting = (key, value) => { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value); };
// An owner who signed in through Google has their address kept too: it, not their name, is what seats them as the
// owner again, so a stranger whose Google name is the same comes in as a guest.
/** @param {string} who @param {string | null} [email] */
const setOwner = (who, email = null) => {
  setSetting('owner', who);
  if (email) setSetting('owner_email', email.toLowerCase()); else db.prepare("DELETE FROM settings WHERE key = 'owner_email'").run();
};
/** @returns {string} */
const ownerEmail = () => /** @type {any} */ (db.prepare("SELECT value FROM settings WHERE key = 'owner_email'").get())?.value || '';
// someone who signed in through Google under a name that is one of this map's people, but not by its address
/** @param {string} name */
const isGuest = (name) => / \(guest\)$/.test(name);
/** @returns {string[]} the owner, everyone with an account and everyone signed in here, guests left out */
const people = () => [...new Set([owner() || '', ...accounts(), ...db.prepare('SELECT name FROM sessions ORDER BY at').all().map((r) => String(r.name))])].filter((n) => n && !isGuest(n));

// Names the map itself speaks as, and so no person may take.
const TAKEN = new Set(['claude', 'guest', 'you']);
/**
 * Why a name cannot be a new account, or '' when it can: 1 to 40 letters, digits, spaces, dots, dashes or
 * underscores, starting with a letter or digit. Those are safe wherever the map writes a name.
 * @param {string} name
 */
const nameProblem = (name) => {
  if (!name) return 'Type your name.';
  if (name.length > 40) return 'Use a name of 40 characters or fewer.';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(name)) return 'Use letters, digits, spaces, dots and dashes in a name.';
  if (TAKEN.has(name.toLowerCase())) return `${name} is a name the map uses itself. Choose another.`;
  if (person(name)) return `Someone called ${person(name)} is already here. Sign in instead.`;
  return '';
};
/** @param {unknown} name */
const tidyName = (name) => String(name || '').trim().replace(/\s+/g, ' ');

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

/**
 * One write that must see the file as nobody else changes it: two people creating the first account at once, or
 * one invite used twice, leave one owner and one account.
 * @template T @param {() => T} work @returns {T}
 */
const alone = (work) => {
  db.exec('BEGIN IMMEDIATE');
  try { const done = work(); db.exec('COMMIT'); return done; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

// An install from before owners were kept has accounts and no owner: the demo story's Admin who has a password
// owns it, else whoever made the first account, so whoever ran it keeps running it.
if (!owner() && accounts().length) {
  /** @type {string[]} */ let admins = [];
  try { admins = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'seed.json'), 'utf8')).people.filter((/** @type {any} */ p) => p.role === 'Admin').map((/** @type {any} */ p) => String(p.id)); }
  catch { /* no story beside this file: the first account owns the install */ }
  setOwner(accounts().find((a) => admins.includes(a)) || accounts()[0]);
}

export const users = {
  person,
  owner,
  nameProblem,
  // whether this person has an account with a password here
  /** @param {string} who */
  has: (who) => !!db.prepare('SELECT 1 FROM users WHERE name = ?').get(who),
  // whether this name has ever signed in here, with a password or through Google
  /** @param {string} who */
  known: (who) => users.has(who) || !!db.prepare('SELECT 1 FROM sessions WHERE name = ?').get(who),
  // nobody has an account or owns the install yet: the first person to come creates the owner's
  firstRun: () => !owner() && !accounts().length,
  people,
  /**
   * The first person on a new install who signs in through Google owns it, as a first account would. Refused once
   * anyone owns it, and for a guest or a name the map speaks as. @param {string} name @param {string | null} email
   */
  claim: (name, email) => alone(() => {
    if (!users.firstRun() || isGuest(name) || TAKEN.has(name.toLowerCase())) return false;
    setOwner(name, email);
    return true;
  }),
  // the owner's name when this address is the one they signed in through Google with, else null
  /** @param {unknown} email @returns {string | null} */
  ownerBy: (email) => (ownerEmail() && String(email || '').toLowerCase() === ownerEmail() && owner()) || null,
  // whether a stranger signing in through Google under this name would pass as someone here: an account, or the
  // owner who signed in through Google
  /** @param {string} name */
  taken: (name) => !!person(name) || name.toLowerCase() === String(owner() || '').toLowerCase(),
  // The person signed in on this Mac, as the server only answers on this Mac: of everyone signed in, the one who
  // signed in last. A Claude Code chat opening the map is theirs. Guests are left out.
  /** @returns {string | null} */
  signedIn() {
    const rows = db.prepare('SELECT name FROM sessions WHERE at > ? ORDER BY at DESC').all(Date.now() - DAYS * 86_400_000);
    return rows.map((r) => String(r.name)).find((n) => !isGuest(n)) || null;
  },
  /**
   * The first account on an install, which owns it. Refused once anyone has an account.
   * @param {unknown} name @param {unknown} password @returns {{ name: string } | { error: string }}
   */
  create(name, password) {
    const who = tidyName(name), pw = String(password || '');
    return alone(() => {
      if (!users.firstRun()) return { error: 'This map already has an owner. Sign in, or ask them for an invite.' };
      const wrong = nameProblem(who) || (pw.length < MIN ? `Use at least ${MIN} characters.` : '');
      if (wrong) return { error: wrong };
      setPassword(who, pw); setOwner(who);
      return { name: who };
    });
  },
  /**
   * A one-use invite the owner makes for someone by name, good for a week.
   * @param {string} by @param {unknown} name @returns {{ token: string, name: string } | { error: string }}
   */
  invite(by, name) {
    if (!by || by !== owner()) return { error: 'Only the owner of this map can invite someone.' };
    const who = tidyName(name), wrong = nameProblem(who);
    if (wrong) return { error: wrong.replace('Type your name.', 'Type their name.').replace(' Sign in instead.', '') };
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM invites WHERE expires <= ? OR lower(name) = lower(?)').run(Date.now(), who);
    db.prepare('INSERT INTO invites (hash, name, by, expires) VALUES (?, ?, ?, ?)').run(sha(token), who, by, Date.now() + INVITE_DAYS * 86_400_000);
    return { token, name: who };
  },
  /** Whom an invite is for and who made it, while it can still be used. @param {unknown} token @returns {{ name: string, by: string } | null} */
  invited(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = /** @type {any} */ (db.prepare('SELECT name, by FROM invites WHERE hash = ? AND expires > ?').get(sha(token), Date.now()));
    return row && !person(row.name) ? { name: row.name, by: row.by } : null;
  },
  /**
   * Uses an invite: the account it names, with the password they chose. The invite is gone after.
   * @param {unknown} token @param {unknown} password @returns {{ name: string } | { error: string }}
   */
  join(token, password) {
    const pw = String(password || '');
    if (pw.length < MIN) return { error: `Use at least ${MIN} characters.` };
    return alone(() => {
      const got = users.invited(token);
      if (!got) return { error: 'This invite has expired or was already used. Ask for a new one.' };
      db.prepare('DELETE FROM invites WHERE hash = ?').run(sha(token));
      setPassword(got.name, pw);
      return { name: got.name };
    });
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
  // a sign-in through Google that brought no picture takes the old one away
  /** @param {string} name @param {string} url */
  setPicture(name, url) {
    if (url) db.prepare('INSERT INTO pictures (name, url) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET url = excluded.url').run(name, url);
    else db.prepare('DELETE FROM pictures WHERE name = ?').run(name);
  },
  /** @param {string} name @returns {string} the address of their Google picture, or '' */
  pictureOf: (name) => /** @type {any} */ (db.prepare('SELECT url FROM pictures WHERE name = ?').get(name))?.url || '',
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

const USAGE = `node users.js reset <name> [--port 4323]   print a one-use link to choose a new password
node users.js set <name> [--password-stdin]  set or change a password
node users.js list | owner <name> | remove <name>`;

/**
 * `node users.js …`, and `npx anur-living-map reset <name>`. Prints what it did; the answer is the exit code.
 * @param {string[]} args @param {{ tty?: boolean, stdin?: AsyncIterable<any> }} [io]
 * @returns {Promise<number>}
 */
export async function cli(args, io = {}) {
  const tty = io.tty ?? !!process.stdin.isTTY, stdin = io.stdin ?? process.stdin;
  /** @param {string} flag */
  const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? '' : args[i + 1] || ''; };
  const words = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');
  const [cmd, typed = ''] = words, who = person(typed);
  if (cmd === 'list') {
    const rows = db.prepare('SELECT name, set_at FROM users ORDER BY rowid').all(), boss = owner();
    // an owner who signs in through Google has no password here, and is listed all the same
    const lines = [...(boss && !users.has(boss) ? [`${boss}  (owner)  (signs in through Google)`] : []), ...rows.map((r) => `${r.name}${r.name === boss ? '  (owner)' : ''}  (password set ${r.set_at} UTC)`)];
    console.log(lines.length ? lines.join('\n') : 'No one has an account yet. The first person to open the map creates the owner\'s.');
    return 0;
  }
  // the install can go to anyone who has signed in here, with a password or through Google
  if (cmd === 'owner') {
    const to = who || people().find((p) => p.toLowerCase() === typed.trim().toLowerCase());
    if (!to) { console.log(typed ? `No one called ${typed} has signed in here. node users.js list shows who has an account.` : USAGE); return 1; }
    const google = users.has(to) ? null : /** @type {any} */ (db.prepare('SELECT email FROM sessions WHERE name = ? AND email IS NOT NULL ORDER BY at DESC').get(to))?.email || null;
    setOwner(to, google);
    console.log(`${to} owns this map server now.`);
    return 0;
  }
  if (['reset', 'remove'].includes(cmd) && !who) {
    console.log(typed ? `No one called ${typed} has an account here. node users.js list shows who does.` : USAGE);
    return 1;
  }
  if (cmd === 'reset' && who) {
    // A link from this Mac's terminal needs no mailbox: whoever can run it already has this Mac's account.
    const port = Number(value('--port') || process.env.LIVING_MAP_PORT || 4323);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { console.log('Give --port a port number, like 4323.'); return 1; }
    const token = recovery.issue(who, '', 'reset');
    console.log(`Open this link on this Mac within 15 minutes, and ${who} chooses a new password there. It works once.\n\nhttp://localhost:${port}/login#reset=${token}`);
    return 0;
  }
  if (cmd === 'remove' && who) {
    if (who === owner()) { console.log(`${who} owns this map server. Make someone else the owner first: node users.js owner <name>`); return 1; }
    db.prepare('DELETE FROM users WHERE name = ?').run(who); db.prepare('DELETE FROM sessions WHERE name = ?').run(who);
    recovery.clear(who); db.prepare('DELETE FROM recovery_emails WHERE name = ?').run(who); db.prepare('DELETE FROM pictures WHERE name = ?').run(who);
    console.log(`${who} has no account now and is signed out.`);
    return 0;
  }
  if (cmd === 'set' && typed) {
    const name = who || tidyName(typed), wrong = who ? '' : nameProblem(name);
    if (wrong) { console.log(wrong); return 1; }
    let one, two;
    if (args.includes('--password-stdin')) {
      let all = ''; for await (const c of stdin) all += c;
      one = two = all.split(/\r?\n/)[0];
    } else if (!tty) {
      // without a terminal, a prompt for a password waits for typing that never comes
      console.log(`Run this in a terminal: it asks for the password without showing it. To let ${name} choose their own, run: node users.js reset ${name}`);
      return 1;
    } else [one, two] = await askTwice(`New password for ${name}: `, 'Again: ');
    if (one.length < MIN) { console.log(`Use at least ${MIN} characters. Nothing changed.`); return 1; }
    if (one !== two) { console.log('The two passwords differ. Nothing changed.'); return 1; }
    const first = users.firstRun();
    setPassword(name, one);
    if (first) setOwner(name);
    console.log(`${name} can sign in now with this password.${first ? ` ${name} owns this map server.` : ''}`);
    return 0;
  }
  console.log(USAGE);
  return cmd ? 1 : 0;
}

// asks twice in a terminal without showing what is typed
/** @param {string} q1 @param {string} q2 */
async function askTwice(q1, q2) {
  /** @param {string} q @returns {Promise<string>} */
  const ask = (q) => new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    /** @type {any} */ (rl)._writeToOutput = (/** @type {string} */ s) => { if (s.includes(q)) process.stdout.write(q); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); ok(a); });
  });
  return [await ask(q1), await ask(q2)];
}

// Run directly. import.meta.main is newer than the Node 22 the package allows, so the path decides.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename) process.exitCode = await cli(process.argv.slice(2));
