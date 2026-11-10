// Following your chats live: one follower per linked chat reads its
// transcript as it grows, and files the new sealed turns with one fresh
// extractor call (extract.ts) that sees only the map so far and those
// turns, so it costs the same however long the chat gets.
//
// - Every second it reads what the transcript gained.
// - A turn is sealed when a later prompt exists, or the file has been still
//   for 2 s after Claude ended it (transcript.ts).
// - It runs as soon as a sealed turn waits: the map's delay is the seal and
//   the model call, nothing else. Turns that seal while a run is out go in
//   the next one, three at a time.
// - One extraction per chat at a time, at most 2 overall; a failure is
//   tried again later and later (30 s doubling to 10 min), its error shown.
// - A long chat linked late reads its newest 40 turns first; older ones are
//   skipped for now.
//
// What a follower holds is in follow/follower.ts, reading the transcript in
// follow/read.ts and filing its turns in follow/run.ts.

import type { Conversation } from "../server/providers/types.ts";
import type { LedgerAction, LedgerView } from "../shared/ledger.ts";
import { applyAction, place, type Acted } from "./apply.ts";
import type { Conv, State } from "./db.ts";
import {
  TICK_MS,
  unique,
  type Ctx,
  type Follower,
  type LedgerDeps,
} from "./follow/follower.ts";
import { read, restart } from "./follow/read.ts";
import { maybeRun } from "./follow/run.ts";
import { emptyTranscript, type Turn } from "./transcript.ts";
import { buildView } from "./view.ts";

export {
  backoff,
  BATCH,
  continuationOf,
  extentOfTurn,
  LATE_TURNS,
  MAX_RUNNING,
  TICK_MS,
  type LedgerDeps,
} from "./follow/follower.ts";

export function createLedger(deps: LedgerDeps) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const followers = new Map<string, Follower>();
  // the model to file with, as the agent judges it (routes.ts); empty for its default
  const model = () => deps.model?.() ?? "";

  const ctx: Ctx = { deps, db, now, model, push, active: 0 };

  function addFollower(c: Conv): Follower {
    const s = db.load(c.root);
    if (!s) throw new Error(`no conversation ${c.root}`);
    const f: Follower = {
      s,
      t: emptyTranscript(),
      file: c.file,
      grewAt: now(),
      turns: [],
      sealed: 0,
      readOnce: false,
      readBusy: false,
      running: null,
      failures: 0,
      retryAt: 0,
      lookedForNext: now(),
      snapped: 0,
      lastSweep: 0,
      sealedAt: new Map(),
    };
    followers.set(c.root, f);
    return f;
  }

  // Starts following one of your conversations (or carries on, if it was
  // already), under the first id it had.
  function follow(c: Conversation): string {
    const ids = unique([...(c.previous ?? []), c.id]);
    const t = now();
    const conv: Conv = db.findConv(ids) ?? {
      root: ids[0]!,
      ids: [],
      title: "",
      cwd: "",
      file: "",
      lookedTurn: 0,
      following: true,
      linkedAt: t,
      skipped: 0,
    };
    conv.ids = unique([conv.root, ...conv.ids, ...ids]);
    conv.title = c.title || conv.title;
    conv.cwd = c.cwd || conv.cwd;
    conv.file = c.file || conv.file;
    conv.following = true;
    conv.linkedAt = t;
    db.saveConv(conv);
    const f = followers.get(conv.root);
    if (!f) addFollower(conv);
    else {
      f.s.conv = conv;
      f.s.store.title = conv.title;
      // carried on in another file: read that one from the start
      if (f.file !== conv.file) restart(ctx, f, conv.file);
    }
    push(conv.root);
    return conv.root;
  }

  // the followers marked following when the server last stopped
  function resume() {
    for (const c of db.conversations())
      if (c.following && !followers.has(c.root) && c.file) addFollower(c);
  }

  async function tickOne(f: Follower) {
    await read(ctx, f);
    await maybeRun(ctx, f);
  }

  // one round for every follower; resolves when what it started is done
  async function tick() {
    await Promise.all([...followers.values()].map(tickOne));
  }

  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  function stateOf(root: string): { s: State; f?: Follower } | null {
    const f = followers.get(root);
    if (f) return { s: f.s, f };
    const s = db.load(root);
    return s ? { s } : null;
  }

  // the side chats open on a chat, as the view lists them (sides.ts sets it)
  let sidesOf: (root: string) => LedgerView["sides"] = () => [];

  function viewOf(root: string): LedgerView | null {
    const hit = stateOf(root);
    if (!hit) return null;
    const { s, f } = hit;
    const read = s.store.read;
    const heardAt = deps.heardAt?.(s.conv) ?? 0;
    return buildView(s, {
      told: new Map(
        [...db.told(root)].map(([id, at]) => [
          id,
          { at, heard: heardAt >= at },
        ]),
      ),
      proposals: db.pendingByItem(root),
      sides: sidesOf(root),
      turns: f?.turns.length ?? read,
      behind: f ? Math.max(0, f.sealed - read) : 0,
      following: s.conv.following,
      error: f?.error,
      reading:
        f?.backlog && f.backlog.to > read
          ? {
              done: read - f.backlog.from,
              total: f.backlog.to - f.backlog.from,
            }
          : undefined,
      filing: f?.filing,
      lag: f?.lag,
      spend: db.spend(root, startOfDay(now())),
      changes: db.changes(root),
      // what Claude is on from its own list, when it keeps one
      ...(f?.plan?.steps.length ? { doing: f.plan.doing } : {}),
    });
  }

  function push(root: string) {
    const v = viewOf(root);
    if (!v) return;
    deps.emit({ type: "ledger", conv: root, view: v });
    const hit = stateOf(root);
    // a handover that can't be written never holds the map up
    try {
      if (hit) deps.handover?.(hit.s, v);
    } catch (e) {
      console.error(
        `[ledger] ${root}: handover not written: ${(e as Error).message}`,
      );
    }
  }

  // A change to a chat's items from outside the extractor (you, a side
  // chat's proposal): made on the state in memory, placed, written in one
  // transaction, told to the main chat when it says so, and pushed.
  function change(
    root: string,
    fn: (s: State, turns: number) => Acted,
  ): { error?: string; view?: LedgerView } {
    const hit = stateOf(root);
    if (!hit) return { error: "That chat is not on the map." };
    const { s, f } = hit;
    const r = fn(s, f?.turns.length ?? s.store.read);
    if (r.error) {
      // nothing written: what is in memory follows what was
      if (f) f.s = db.load(root) ?? f.s;
      return { error: r.error };
    }
    place(s, now());
    try {
      db.commit(s, r.lines, now());
    } catch (e) {
      if (f) f.s = db.load(root) ?? f.s;
      throw e;
    }
    if (r.tell) {
      deps.tell?.(s.conv, r.tell, r.quiet);
      if (r.about) db.setTold(root, r.about, now());
    }
    push(root);
    return { view: viewOf(root) ?? undefined };
  }

  // What you did on the map: written as "you" at once; what the chat should
  // hear (an answer, a pick, a tick) goes to it at once too.
  function act(root: string, action: LedgerAction) {
    return change(root, (s, turns) => {
      const r = applyAction(s, action, turns);
      return "item" in action && r.tell ? { ...r, about: action.item } : r;
    });
  }

  // a chat's turns as the follower last read them (null: not followed now)
  const turnsOf = (root: string): Turn[] | null =>
    followers.get(root)?.turns ?? null;

  let timer: ReturnType<typeof setInterval> | null = null;
  if (deps.everyMs !== 0) {
    timer = setInterval(() => {
      for (const f of followers.values())
        void tickOne(f).catch((e) =>
          console.error("[ledger] following failed:", e),
        );
    }, deps.everyMs ?? TICK_MS);
    timer.unref?.();
  }

  return {
    follow,
    resume,
    tick,
    view: viewOf,
    act,
    change,
    turnsOf,
    state: (root: string) => stateOf(root)?.s ?? null,
    push,
    useSides(fn: (root: string) => LedgerView["sides"]) {
      sidesOf = fn;
    },
    // the main chat with this session id took its inbox: its cards say so
    heard(session: string) {
      const root = db.findConv([session])?.root;
      if (root) push(root);
    },
    // the conversation any of these ids is filed under
    rootOf: (ids: string[]) => db.findConv(unique(ids))?.root ?? null,
    // the one linked last
    latest: () => db.conversations()[0]?.root ?? null,
    conversations: () => db.conversations(),
    following: () => [...followers.keys()],
    close() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type Ledger = ReturnType<typeof createLedger>;
