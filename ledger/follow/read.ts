// Reading a followed chat: what its transcript gained, which turns are
// sealed now, the snapshot behind "what changed", and what is put right on
// the first read (answers saved but not applied, a long chat linked late).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { checkAnswer } from "../apply.ts";
import { planOf } from "../tasks.ts";
import { emptyTranscript, view as readView, type Turn } from "../transcript.ts";
import {
  BATCH,
  continued,
  LATE_TURNS,
  unique,
  type Ctx,
  type Follower,
} from "./follower.ts";
import { commitRun } from "./run.ts";
import { hasRead, mayRead, onRead } from "./states.ts";

// how long a quiet chat waits before looking for its continuation (resumed
// under a new id, in another file)
const SUCCESSOR_MS = 15_000;

const mtimeOf = (file: string) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
};

// carried on in another file: read from its start
export function restart(ctx: Ctx, f: Follower, file: string) {
  const { now } = ctx;
  f.file = file;
  f.t = emptyTranscript();
  onRead(f, "restart");
  f.grewAt = now();
}

export async function read(ctx: Ctx, f: Follower) {
  const { db, deps, now, push } = ctx;
  if (!mayRead(f)) return;
  onRead(f, "start");
  const before = { turns: f.turns.length, sealed: f.sealed };
  try {
    let grew = false;
    try {
      const r = await deps.read(f.t, f.file);
      grew = r.added > 0 || r.reset;
    } catch {
      if (f.error !== "The chat's transcript can't be read.") {
        f.error = "The chat's transcript can't be read.";
        push(f.s.conv.root);
      }
      return;
    }
    const t = now();
    // read for the first time: still since the file was last written
    if (!hasRead(f)) f.grewAt = Math.min(t, mtimeOf(f.file) ?? t);
    else if (grew) f.grewAt = t;
    else if (
      t - f.grewAt > SUCCESSOR_MS &&
      t - f.lookedForNext > SUCCESSOR_MS
    ) {
      f.lookedForNext = t;
      const id = f.s.conv.ids.at(-1) ?? f.s.conv.root;
      const next = deps.findSuccessor?.(f.file, id) ?? null;
      if (next) {
        const conv = f.s.conv;
        conv.ids = unique([...conv.ids, next.id]);
        conv.file = next.file;
        db.saveConv(conv);
        restart(ctx, f, next.file);
        return;
      }
    }
    const v = readView(f.t, t - f.grewAt);
    f.plan = planOf(v.path);
    f.turns = v.turns;
    if (hasRead(f))
      for (const turn of v.turns.slice(before.sealed, v.sealed))
        f.sealedAt.set(turn.n, t);
    f.sealed = v.sealed;
    if (grew) db.setSource(f.file, f.s.conv.root, f.t.offset, t);
    if (!hasRead(f)) {
      onRead(f, "first view");
      if (f.error === "The chat's transcript can't be read.")
        f.error = undefined;
      recover(ctx, f);
      lateLink(ctx, f);
    }
    snapChanges(ctx, f);
    if (before.turns !== f.turns.length || before.sealed !== f.sealed)
      push(f.s.conv.root);
  } finally {
    onRead(f, "end");
  }
}

// A snapshot when following starts, and one after each newly sealed turn;
// what differs between two in a way the readers see is filed against the
// turn. Changes from before the chat was followed are not claimed.
function snapChanges(ctx: Ctx, f: Follower) {
  const { db, deps } = ctx;
  const ch = deps.changes;
  if (!ch) return;
  if (f.shadow === undefined) {
    f.shadow = ch.shadowFor(f.s.conv.cwd);
    if (f.shadow) f.snap = ch.snapshot(f.shadow, "start") ?? undefined;
    f.snapped = f.sealed;
    return;
  }
  if (!f.shadow || !f.snap || f.sealed <= f.snapped) return;
  const turn = f.turns[f.sealed - 1]?.n ?? f.sealed;
  const next = ch.snapshot(f.shadow, `after turn ${turn}`);
  if (!next) return;
  const r = ch.compare(f.shadow, f.snap, next, turn);
  f.snap = next;
  f.snapped = f.sealed;
  if (!r.statements.length) return;
  db.addChanges(
    f.s.conv.root,
    r.statements.map((s) => ({
      id: crypto
        .createHash("sha1")
        .update(`${s.op}|${s.kind}|${s.key}|${turn}`)
        .digest("hex")
        .slice(0, 12),
      change: s.op,
      kind: s.kind,
      text: s.text,
      module: s.from ?? path.posix.dirname(s.files[0] ?? "."),
      file: s.files[0] ?? "",
      turn,
      low: !!s.low,
    })),
  );
}

// Answers saved before a stop that never got applied: applied now, once.
function recover(ctx: Ctx, f: Follower) {
  const { db } = ctx;
  for (const run of db.pendingRuns(f.s.conv.root)) {
    // a run that began at the read point filed more of that turn: rebuilt
    // the same way, from how far it had been read
    const more = run.turns[0] === run.base ? continued(f) : null;
    const turns = run.turns.map((n) =>
      more && n === more.n ? more : f.turns.find((t) => t.n === n),
    );
    const answer = checkAnswer(run.answer);
    if (turns.some((t) => !t) || !answer) {
      db.failRun(run.id, "its turns are no longer in the transcript");
      continue;
    }
    if (run.base !== f.s.store.read) {
      db.failRun(run.id, "the map moved on before it was applied");
      continue;
    }
    try {
      commitRun(ctx, f, run.id, answer, turns as Turn[]);
    } catch (e) {
      console.error("[ledger] could not apply a saved answer:", e);
    }
  }
}

// A long chat linked late is read from its newest turns: reading all of it
// would take many calls before the map shows anything.
function lateLink(ctx: Ctx, f: Follower) {
  const { db, now } = ctx;
  const { store, conv } = f.s;
  const fresh = store.read === 0 && store.items.size === 0;
  if (fresh && conv.skipped === 0 && f.sealed > LATE_TURNS) {
    conv.skipped = f.sealed - LATE_TURNS;
    store.read = conv.skipped;
    db.commit(
      f.s,
      [{ writer: "extractor", op: { op: "skip", turns: conv.skipped } }],
      now(),
    );
    console.log(
      `[ledger] ${conv.root}: linked late; the newest ${LATE_TURNS} turns are read, ${conv.skipped} earlier ones are skipped for now`,
    );
  }
  if (f.sealed - store.read > BATCH)
    f.backlog = { from: store.read, to: f.sealed };
}
