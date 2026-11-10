// Filing a followed chat's sealed turns: one extractor call at a time per
// chat, its answer saved before it is applied, backoff after a failure, and
// now and then a sweep of what waits on you and has gone quiet.

import { applyAnswer, checkAnswer } from "../apply.ts";
import {
  batches,
  message,
  quiet,
  SCHEMA,
  SWEEP_EVERY,
  SWEEP_SYSTEM,
  sweepMessage,
  SYSTEM,
  type Answer,
} from "../extract.ts";
import type { Turn } from "../transcript.ts";
import {
  backoff,
  BATCH,
  continued,
  extentOfTurn,
  MAX_RUNNING,
  pendingOf,
  type Ctx,
  type Follower,
} from "./follower.ts";

// anything sealed and not yet filed is due now
const due = (pending: Turn[]) => pending.length > 0;

export function maybeRun(ctx: Ctx, f: Follower): Promise<void> | null {
  const { deps, now, push } = ctx;
  if (f.running) return f.running;
  if (!f.readOnce || !deps.extract || !f.s.conv.following) return null;
  if (ctx.active >= MAX_RUNNING) return null;
  if (f.failures && now() < f.retryAt) return null;
  const pending = pendingOf(f);
  const more = continued(f);
  if (!more && !due(pending)) return null;
  f.nudged = false;
  // more of the last filed turn goes first, with what came after it
  const batch = more
    ? [more, ...(batches(pending, BATCH - 1)[0] ?? [])]
    : batches(pending, BATCH)[0]!;
  ctx.active++;
  f.filing = { turns: batch.map((t) => t.n), since: now() };
  push(f.s.conv.root);
  f.running = run(ctx, f, batch).finally(() => {
    ctx.active--;
    f.running = null;
    f.filing = undefined;
    if (f.backlog && f.s.store.read >= f.backlog.to) f.backlog = undefined;
    push(f.s.conv.root);
  });
  return f.running;
}

export function commitRun(
  ctx: Ctx,
  f: Follower,
  id: number,
  answer: Answer,
  turns: Turn[],
) {
  const { db, now } = ctx;
  const root = f.s.conv.root;
  try {
    const { lines, rejected } = applyAnswer(f.s, answer, turns, now());
    // how far the last turn filed was read: all of it, as it is now
    const last = f.turns.find((t) => t.n === turns.at(-1)?.n);
    if (last) f.s.conv.readExtent = extentOfTurn(last);
    db.commit(f.s, lines, now(), { id, rejected });
  } catch (e) {
    // what is in memory follows what was written
    f.s = db.load(root) ?? f.s;
    throw e;
  }
}

async function run(ctx: Ctx, f: Follower, batch: Turn[]) {
  const { db, deps, now, model } = ctx;
  const root = f.s.conv.root;
  const base = f.s.store.read;
  const turns = batch.map((t) => t.n);
  const fail = (error: string) => {
    f.failures++;
    f.retryAt = now() + backoff(f.failures);
    f.error = error;
  };
  try {
    const r = await deps.extract!({
      system: SYSTEM,
      message: message(f.s.store, batch),
      schema: SCHEMA as unknown as Record<string, unknown>,
      model: model(),
      timeoutMs: 120_000,
    });
    const usage = r.usage
      ? {
          usd: r.usage.costUsd,
          input: r.usage.input,
          output: r.usage.output,
          model: r.usage.model,
        }
      : null;
    const answer = r.ok ? checkAnswer(r.value) : null;
    if (!answer) {
      const error = r.ok
        ? "The map's answer was not in the shape asked for."
        : r.error || "The model did not answer.";
      db.saveRun(root, { turns, base, error, usage, ms: r.ms }, now());
      fail(error);
      return;
    }
    // what you did meanwhile stays; only the read point must not have
    // moved (one run per chat at a time keeps it so)
    if (f.s.store.read !== base) {
      db.saveRun(
        root,
        { turns, base, error: "the map moved on", usage, ms: r.ms },
        now(),
      );
      return;
    }
    const id = db.saveRun(
      root,
      { turns, base, answer: r.value, usage, ms: r.ms },
      now(),
    );
    commitRun(ctx, f, id, answer, batch);
    f.failures = 0;
    f.retryAt = 0;
    f.error = undefined;
    measure(ctx, f, batch, r.ms);
    const store = f.s.store;
    if (store.read - f.lastSweep >= SWEEP_EVERY && quiet(store).length) {
      f.lastSweep = store.read;
      await sweep(ctx, f);
    }
  } catch (e) {
    console.error("[ledger] filing turns failed:", e);
    fail("Filing the chat's turns failed on the server.");
  }
}

// How long the newest turn of a batch waited between sealing and landing
// on the map: the lag the page shows, and one log line per run
function measure(ctx: Ctx, f: Follower, batch: Turn[], modelMs: number) {
  const { now } = ctx;
  const last = batch.at(-1)!.n;
  const sealed = f.sealedAt.get(last);
  for (const n of f.sealedAt.keys()) if (n <= last) f.sealedAt.delete(n);
  if (sealed === undefined) return;
  const ms = Math.max(0, now() - sealed);
  f.lag = { turn: last, ms, modelMs };
  const s = (x: number) => `${(x / 1000).toFixed(1)}s`;
  console.log(
    `[ledger] ${f.s.conv.root}: filed turn${batch.length === 1 ? "" : "s"} ${batch[0]!.n}${batch.length === 1 ? "" : `–${last}`} ${s(ms)} after turn ${last} sealed (model ${s(modelMs)})`,
  );
}

// What waits on you and has gone quiet, checked on its own against the
// turns since (extract.ts): saved and applied like any run. A failed sweep
// is left for the next one; it never holds up filing.
async function sweep(ctx: Ctx, f: Follower) {
  const { db, deps, now, model } = ctx;
  const root = f.s.conv.root;
  const base = f.s.store.read;
  const { message: m, shown } = sweepMessage(
    f.s.store,
    quiet(f.s.store),
    f.turns,
  );
  if (!shown.length) return;
  const r = await deps.extract!({
    system: SWEEP_SYSTEM,
    message: m,
    schema: SCHEMA as unknown as Record<string, unknown>,
    model: model(),
    timeoutMs: 120_000,
  });
  const usage = r.usage
    ? {
        usd: r.usage.costUsd,
        input: r.usage.input,
        output: r.usage.output,
        model: r.usage.model,
      }
    : null;
  const answer = r.ok ? checkAnswer(r.value) : null;
  const turns = shown.map((t) => t.n);
  if (!answer || f.s.store.read !== base) {
    db.saveRun(
      root,
      { turns, base, error: "sweep: no usable answer", usage, ms: r.ms },
      now(),
    );
    return;
  }
  const id = db.saveRun(
    root,
    { turns, base, answer: r.value, usage, ms: r.ms },
    now(),
  );
  commitRun(ctx, f, id, answer, shown);
}
