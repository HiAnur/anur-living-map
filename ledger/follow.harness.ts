// What the follower's tests share: a transcript written in the shapes
// Claude Code writes, a scripted model, and a ledger on a clock the test
// moves.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  ExtractRequest,
  ExtractResult,
} from "../server/providers/types.ts";
import type { LedgerEvent } from "../shared/ledger.ts";
import { openDb, type Conv } from "./db.ts";
import { createLedger } from "./follow.ts";
export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-follow-"));
export let fileN = 0;

// ---- a transcript in the shapes Claude Code writes --------------------------

export function chat() {
  const file = path.join(tmp, `chat-${++fileN}.jsonl`);
  fs.writeFileSync(file, "");
  let last: string | null = null;
  let n = 0;
  const write = (d: object) =>
    fs.appendFileSync(file, `${JSON.stringify(d)}\n`);
  const base = (type: string) => {
    const uuid = `u${fileN}-${++n}`;
    const d = {
      parentUuid: last,
      isSidechain: false,
      type,
      uuid,
      timestamp: new Date(1_700_000_000_000 + n * 1000).toISOString(),
      sessionId: `s${fileN}`,
    };
    last = uuid;
    return d;
  };
  return {
    file,
    id: `s${fileN}`,
    you(text: string) {
      write({
        ...base("user"),
        message: { role: "user", content: text },
        origin: { kind: "human" },
        promptSource: "sdk",
      });
    },
    claude(text: string, stop = "end_turn") {
      write({
        ...base("assistant"),
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          stop_reason: stop,
        },
      });
    },
    turn(you: string, claude: string) {
      this.you(you);
      this.claude(claude);
    },
    // a background task finishing: a notice, not a prompt
    notice(summary: string) {
      write({
        ...base("user"),
        message: {
          role: "user",
          content: `<task-notification>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`,
        },
        promptSource: "sdk",
      });
    },
  };
}

// ---- a scripted model: a topic per batch, a question per "?" turn ----------

export type Script = (
  req: ExtractRequest,
) => ExtractResult | Promise<ExtractResult>;

export const turnsOf = (msg: string) =>
  [...msg.matchAll(/TURN (\d+) · YOU:\n(.*)/g)].map((m) => ({
    n: Number(m[1]),
    text: m[2]!,
  }));

export const filing = (req: ExtractRequest): ExtractResult => {
  const turns = turnsOf(req.message);
  const first = turns[0]!;
  const ops: unknown[] = [
    {
      op: "create",
      ref: "new1",
      type: "topic",
      title: `About ${first.text}`,
      quote: first.text,
      turn: first.n,
    },
  ];
  for (const t of turns)
    if (t.text.includes("?"))
      ops.push({
        op: "create",
        type: "question",
        title: t.text,
        quote: t.text,
        turn: t.n,
        parent: "new1",
        owner: "you",
      });
  return {
    ok: true,
    value: { topics: turns.map((t) => ({ turn: t.n, topic: "new1" })), ops },
    ms: 5,
    usage: {
      input: 100,
      output: 20,
      costUsd: 0.01,
      model: "scripted",
      effort: "low",
    },
  };
};

export function setup(
  script: Script = filing,
  dbFile?: string,
  changes?: Parameters<typeof createLedger>[0]["changes"],
  handover?: Parameters<typeof createLedger>[0]["handover"],
) {
  let clock = Date.now();
  const calls: ExtractRequest[] = [];
  const events: LedgerEvent[] = [];
  const told: { conv: Conv; text: string }[] = [];
  const file = dbFile ?? path.join(tmp, `ledger-${++fileN}.db`);
  const db = openDb(file);
  const ledger = createLedger({
    db,
    extract: async (req) => {
      calls.push(req);
      return script(req);
    },
    emit: (e) => events.push(e),
    tell: (conv, text) => told.push({ conv, text }),
    now: () => clock,
    everyMs: 0,
    findSuccessor: () => null,
    changes,
    handover,
  });
  return {
    db,
    file,
    ledger,
    calls,
    events,
    told,
    advance: (ms: number) => (clock += ms),
    link: (c: { id: string; file: string }) =>
      ledger.follow({ id: c.id, file: c.file, cwd: tmp, title: "A chat" }),
  };
}
// a number no other file or store in this run has
export const next = () => ++fileN;

// Waits for what a tick starts (file reads, then the call) without guessing
// how long that takes on a busy machine; settle() leaves room for anything
// that should NOT start to show up.
export async function until(cond: () => boolean, ms = 20_000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end)
    await new Promise((r) => setTimeout(r, 10));
}
export const settle = () => new Promise((r) => setTimeout(r, 100));
