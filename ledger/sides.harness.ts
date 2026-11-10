// What the side chats' tests share: a fake `claude` that answers in
// stream-json, and a ledger with one chat and its side chats on it.

import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";

import { claudeCode, type Spawn } from "../server/providers/claude-code.ts";
import { readMore } from "../server/providers/claude-transcript.ts";
import type { LedgerEvent } from "../shared/ledger.ts";
import { openDb, type Conv } from "./db.ts";
import { createLedger } from "./follow.ts";
import { createSides } from "./sides.ts";
export const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sides-"));
export let n = 0;

export type Fake = ChildProcess & {
  args: string[];
  cwd: string;
  sent: string[];
  say: (events: unknown[]) => void;
};

export function fakeSpawn() {
  const procs: Fake[] = [];
  const spawn: Spawn = (_cmd, args, opts) => {
    const p = new EventEmitter() as Fake;
    const stdout = new PassThrough();
    p.sent = [];
    let buf = "";
    const stdin = new Writable({
      write(chunk, _enc, cb) {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          p.sent.push(
            (
              JSON.parse(buf.slice(0, nl)) as {
                message: { content: string };
              }
            ).message.content,
          );
          buf = buf.slice(nl + 1);
        }
        cb();
      },
    });
    Object.assign(p, {
      args,
      cwd: opts.cwd,
      stdout,
      stderr: new PassThrough(),
      stdin,
      exitCode: null,
      signalCode: null,
      killed: false,
      kill: (sig: NodeJS.Signals = "SIGTERM") => {
        if (p.killed) return true;
        Object.assign(p, { killed: true, signalCode: sig });
        stdout.end();
        setTimeout(() => p.emit("close", null, sig), 0);
        return true;
      },
      say: (events: unknown[]) =>
        stdout.write(events.map((e) => `${JSON.stringify(e)}\n`).join("")),
    });
    procs.push(p);
    return p;
  };
  return { spawn, procs };
}

export const ev = (event: unknown) => ({ type: "stream_event", event });
// an answer: it reads, may call propose_change with `change`, then says `text`
export const reply = (text: string, cost: number, change?: unknown) => [
  ev({ type: "message_start", message: { model: "claude-opus-5-5" } }),
  {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Read", input: { file_path: "ITEMS" } },
        ...(change === undefined
          ? []
          : [
              {
                type: "tool_use",
                name: "mcp__living_map__propose_change",
                input: change,
              },
            ]),
      ],
    },
  },
  ev({ type: "message_start", message: { model: "claude-opus-5-5" } }),
  ev({ type: "content_block_delta", delta: { text } }),
  {
    type: "result",
    subtype: "success",
    total_cost_usd: cost,
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 1000,
      output_tokens: 50,
    },
  },
];
export const tick = () => new Promise((r) => setTimeout(r, 5));
export async function until(ok: () => boolean) {
  for (let k = 0; k < 200 && !ok(); k++) await tick();
  assert.ok(ok(), "timed out waiting");
}

// a chat of two turns on disk, filed by a scripted extractor: a topic, a
// question with two options under it
export async function setup(idleMs = 60_000) {
  const dir = path.join(tmp, `case-${++n}`);
  const home = path.join(dir, "home");
  const project = path.join(dir, "project");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  const file = path.join(dir, "chat.jsonl");
  const line = (d: object) => `${JSON.stringify(d)}\n`;
  const at = (k: number) =>
    new Date(1_700_000_000_000 + k * 1000).toISOString();
  fs.writeFileSync(
    file,
    line({
      type: "user",
      uuid: "a",
      parentUuid: null,
      timestamp: at(1),
      message: { role: "user", content: "Which queue should we use?" },
      origin: { kind: "human" },
      promptSource: "sdk",
    }) +
      line({
        type: "assistant",
        uuid: "b",
        parentUuid: "a",
        timestamp: at(2),
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Option A is Redis. Option B is Kafka." },
            { type: "tool_use", id: "t1", name: "Bash", input: {} },
          ],
          stop_reason: "tool_use",
        },
      }) +
      line({
        type: "user",
        uuid: "c",
        parentUuid: "b",
        timestamp: at(3),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: "SECRET-OUTPUT",
            },
          ],
        },
      }) +
      line({
        type: "assistant",
        uuid: "d",
        parentUuid: "c",
        timestamp: at(4),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Which one do you want?" }],
          stop_reason: "end_turn",
        },
      }),
  );
  const old = (Date.now() - 60_000) / 1000;
  fs.utimesSync(file, old, old);
  const db = openDb(path.join(dir, "ledger.db"));
  const told: { text: string; quiet?: boolean }[] = [];
  const events: LedgerEvent[] = [];
  const ledger = createLedger({
    read: readMore,
    db,
    everyMs: 0,
    emit: (e) => events.push(e),
    tell: (_c: Conv, text, quiet) => told.push({ text, quiet }),
    findSuccessor: () => null,
    extract: async () => ({
      ok: true,
      ms: 1,
      usage: null,
      value: {
        topics: [{ turn: 1, topic: "new1" }],
        ops: [
          {
            op: "create",
            ref: "new1",
            type: "topic",
            title: "The queue",
            quote: "Which queue should we use?",
            turn: 1,
          },
          {
            op: "create",
            ref: "new2",
            type: "question",
            title: "Which queue?",
            quote: "Which queue should we use?",
            turn: 1,
            parent: "new1",
            owner: "you",
          },
          {
            op: "create",
            type: "option",
            title: "Redis",
            quote: "Option A is Redis.",
            turn: 1,
            parent: "new2",
          },
          {
            op: "create",
            type: "option",
            title: "Kafka",
            quote: "Option B is Kafka.",
            turn: 1,
            parent: "new2",
          },
        ],
      },
    }),
  });
  const root = ledger.follow({
    id: "chat-1",
    file,
    cwd: project,
    title: "Queues",
  });
  await ledger.tick();
  await ledger.tick();
  const v = ledger.view(root)!;
  assert.equal(v.items.length, 4, "the chat is filed");
  const { spawn, procs } = fakeSpawn();
  const sides = createSides({
    read: readMore,
    db,
    ledger,
    emit: (e) => events.push(e),
    home,
    // the real Claude Code provider, on the fake `claude`
    openChat: claudeCode({ home, spawn }).openChat,
    idleMs,
  });
  const id = (title: string) => v.items.find((i) => i.title === title)!.id;
  return {
    db,
    ledger,
    sides,
    procs,
    root,
    told,
    events,
    home,
    project,
    file,
    id,
  };
}
