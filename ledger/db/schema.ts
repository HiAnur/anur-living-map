// The store's tables, as a list of migrations: a store's PRAGMA user_version
// is how many of them it has had. A change to the tables is a new entry at
// the end, never an edit to one already there.

import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { num, type Row } from "./rows.ts";

const MIGRATIONS: string[] = [
  `CREATE TABLE conversations (
     root TEXT PRIMARY KEY,
     ids TEXT NOT NULL DEFAULT '[]',
     title TEXT NOT NULL DEFAULT '',
     cwd TEXT NOT NULL DEFAULT '',
     file TEXT NOT NULL DEFAULT '',
     looked_turn INTEGER NOT NULL DEFAULT 0,
     following INTEGER NOT NULL DEFAULT 0,
     linked_at INTEGER NOT NULL DEFAULT 0,
     skipped INTEGER NOT NULL DEFAULT 0,
     next_item INTEGER NOT NULL DEFAULT 1,
     read_turn INTEGER NOT NULL DEFAULT 0,
     topic_of TEXT NOT NULL DEFAULT '{}'
   );
   CREATE TABLE sources (
     path TEXT PRIMARY KEY,
     conv TEXT NOT NULL,
     offset INTEGER NOT NULL DEFAULT 0,
     read_at INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE items (
     conv TEXT NOT NULL,
     id TEXT NOT NULL,
     type TEXT NOT NULL,
     state TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     quote TEXT NOT NULL,
     src TEXT NOT NULL,
     parent TEXT,
     owner TEXT,
     basis TEXT NOT NULL,
     links TEXT NOT NULL,
     writers TEXT NOT NULL,
     retired TEXT,
     order_key TEXT NOT NULL,
     under TEXT,
     folded INTEGER NOT NULL DEFAULT 0,
     filed_at INTEGER NOT NULL,
     PRIMARY KEY (conv, id)
   );
   CREATE TABLE log (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     conv TEXT NOT NULL,
     run INTEGER,
     writer TEXT NOT NULL,
     op TEXT NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE INDEX log_conv ON log (conv, seq);
   CREATE TABLE runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conv TEXT NOT NULL,
     turns TEXT NOT NULL,
     base INTEGER NOT NULL,
     answer TEXT,
     rejected TEXT,
     status TEXT NOT NULL,
     usd REAL NOT NULL DEFAULT 0,
     input INTEGER NOT NULL DEFAULT 0,
     output INTEGER NOT NULL DEFAULT 0,
     model TEXT NOT NULL DEFAULT '',
     ms INTEGER NOT NULL DEFAULT 0,
     error TEXT NOT NULL DEFAULT '',
     at INTEGER NOT NULL
   );
   CREATE INDEX runs_conv ON runs (conv, id);
   CREATE TABLE spend (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conv TEXT NOT NULL,
     run INTEGER,
     what TEXT NOT NULL,
     model TEXT NOT NULL DEFAULT '',
     input INTEGER NOT NULL DEFAULT 0,
     output INTEGER NOT NULL DEFAULT 0,
     usd REAL NOT NULL DEFAULT 0,
     at INTEGER NOT NULL
   );
   CREATE TABLE changes (
     conv TEXT NOT NULL,
     id TEXT NOT NULL,
     turn INTEGER NOT NULL,
     statement TEXT NOT NULL,
     review TEXT,
     PRIMARY KEY (conv, id)
   );`,
  // side chats (sides.ts): what was said, what it cost, what it proposed;
  // and what you did that the main chat was told, to say when it has it
  `CREATE TABLE sides (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conv TEXT NOT NULL,
     item TEXT NOT NULL,
     title TEXT NOT NULL,
     closed INTEGER NOT NULL DEFAULT 0,
     input INTEGER NOT NULL DEFAULT 0,
     output INTEGER NOT NULL DEFAULT 0,
     usd REAL NOT NULL DEFAULT 0,
     at INTEGER NOT NULL
   );
   CREATE INDEX sides_conv ON sides (conv, id);
   CREATE TABLE side_messages (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     side INTEGER NOT NULL,
     role TEXT NOT NULL,
     text TEXT NOT NULL,
     tools TEXT NOT NULL DEFAULT '[]',
     stopped INTEGER NOT NULL DEFAULT 0,
     at INTEGER NOT NULL
   );
   CREATE INDEX side_messages_side ON side_messages (side, seq);
   CREATE TABLE side_proposals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     side INTEGER NOT NULL,
     ops TEXT NOT NULL,
     dropped TEXT NOT NULL,
     status TEXT NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE INDEX side_proposals_side ON side_proposals (side, id);
   CREATE TABLE told (
     conv TEXT NOT NULL,
     item TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (conv, item)
   );`,
  // a wait the extractor closed with no quote behind it (Item.unconfirmed)
  `ALTER TABLE items ADD COLUMN unconfirmed TEXT;`,
  // how much of the last filed turn was read (Conv.readExtent)
  `ALTER TABLE conversations ADD COLUMN read_extent TEXT;`,
  // which instructions and schema produced a run (promptId in extract.ts);
  // runs from before have none
  `ALTER TABLE runs ADD COLUMN prompt TEXT;`,
];

// Brings a store up to the latest version, each migration in its own
// transaction.
export function migrate(db: DatabaseSync, file: string) {
  const version = num(
    (db.prepare("PRAGMA user_version").get() as Row).user_version,
  );
  // Before a store that already holds maps is migrated, a copy of it as it
  // is: a migration that fails rolls back on its own, but one that runs and
  // turns out wrong would leave no way back. VACUUM INTO writes a whole,
  // consistent copy (what the WAL holds included); the first copy made for
  // a version is kept.
  if (version > 0 && version < MIGRATIONS.length) {
    const copy = `${file}.before-v${MIGRATIONS.length}`;
    if (!fs.existsSync(copy)) {
      db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
      fs.chmodSync(copy, 0o600);
    }
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
