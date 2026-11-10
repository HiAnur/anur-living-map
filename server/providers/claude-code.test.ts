// The Claude Code provider's spare process, on a fake `claude`: at most one is
// kept, keyed by everything fixed when it starts; a move takes it only when
// that key matches, and it is ended when idle, on another key, or released.

import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, test, vi } from "vitest";

import { childEnv, claudeCode, signedOut, type Spawn } from "./claude-code.ts";

afterEach(() => {
  vi.useRealTimers();
});

type Fake = ChildProcess & {
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  sent: string;
  say: (events: unknown[]) => void;
  end: () => void;
};

function fakeSpawn() {
  const procs: Fake[] = [];
  const spawn: Spawn = (_cmd, args, opts) => {
    const p = new EventEmitter() as Fake;
    p.cwd = opts.cwd;
    p.env = opts.env;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    p.sent = "";
    const stdin = new Writable({
      write(chunk, _enc, cb) {
        p.sent += chunk;
        cb();
      },
    });
    let exited = false;
    const exit = (signal: NodeJS.Signals | null) => {
      if (exited) return;
      exited = true;
      Object.assign(p, { exitCode: signal ? null : 0, signalCode: signal });
      stdout.end();
      setTimeout(() => p.emit("close", signal ? null : 0, signal), 0);
    };
    Object.assign(p, {
      args,
      stdout,
      stderr,
      stdin,
      exitCode: null,
      signalCode: null,
      killed: false,
      kill: (sig: NodeJS.Signals = "SIGTERM") => {
        Object.assign(p, { killed: true });
        exit(sig);
        return true;
      },
      say: (events: unknown[]) =>
        stdout.write(events.map((e) => `${JSON.stringify(e)}\n`).join("")),
      end: () => exit(null),
    });
    procs.push(p);
    return p;
  };
  return { spawn, procs };
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-provider-"));

test("claude never runs as part of the chat session that started the server", () => {
  const env = childEnv({
    PATH: "/bin",
    HOME: "/h",
    CLAUDECODE: "1",
    CLAUDE_CODE_SESSION_ID: "chat",
    CLAUDE_CODE_REMOTE_SESSION_ID: "cse_1",
    CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: "1",
    CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: "1",
  });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/h" });
});

test("a sign-in Claude Code cannot renew reads as signed out; other failures do not", () => {
  assert.ok(
    signedOut(
      "Failed to authenticate: OAuth session expired and could not be refreshed",
    ),
  );
  assert.ok(signedOut("Not logged in · Please run /login"));
  assert.ok(!signedOut("Claude took too long to answer"));
  assert.ok(!signedOut(undefined));
});

test("extract runs a fresh call with its own instructions, no tools and no cache, and returns the structured answer", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const schema = { type: "object", properties: { n: { type: "number" } } };
  const call = provider.extract!({
    system: "File the turns.",
    message: "NEW TURNS: …",
    schema,
    model: "sonnet",
    maxOutputTokens: 3000,
  });
  const p = procs[0];
  const arg = (flag: string) => p.args[p.args.indexOf(flag) + 1];
  assert.equal(arg("--system-prompt"), "File the turns.");
  assert.ok(!p.args.includes("--append-system-prompt"));
  assert.equal(arg("--tools"), "");
  assert.deepEqual(JSON.parse(arg("--json-schema")), schema);
  assert.equal(arg("--output-format"), "json");
  assert.equal(arg("--model"), "sonnet");
  assert.equal(arg("--setting-sources"), "");
  assert.ok(p.args.includes("--no-session-persistence"));
  assert.ok(!p.args.includes("--resume"));
  assert.equal(p.env?.DISABLE_PROMPT_CACHING, "1");
  assert.equal(p.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "3000");
  assert.equal(p.cwd, path.join(home, "extract"));
  p.say([
    {
      type: "result",
      subtype: "success",
      result: "",
      structured_output: { n: 3 },
      total_cost_usd: 0.0005,
      usage: { input_tokens: 900, output_tokens: 120 },
      modelUsage: { "claude-sonnet-5-5": { outputTokens: 120 } },
    },
  ]);
  p.end();
  const r = await call;
  assert.equal(p.sent, "NEW TURNS: …");
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { n: 3 });
  assert.equal(r.usage?.model, "claude-sonnet-5-5");
  assert.equal(r.usage?.costUsd, 0.0005);
});

test("extract names the model the call spent most on, not the one that wrote most", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const call = provider.extract!({ system: "s", message: "m", schema: {} });
  procs[0].say([
    {
      type: "result",
      subtype: "success",
      structured_output: {},
      total_cost_usd: 0.03,
      modelUsage: {
        "claude-haiku-5-5": { outputTokens: 900, costUSD: 0.001 },
        "claude-opus-5-5": { outputTokens: 400, costUSD: 0.029 },
      },
    },
  ]);
  procs[0].end();
  assert.equal((await call).usage?.model, "claude-opus-5-5");
});

test("extract with no model passes none, so Claude Code's default model answers", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const call = provider.extract!({ system: "s", message: "m", schema: {} });
  assert.ok(!procs[0].args.includes("--model"));
  procs[0].say([{ type: "result", subtype: "success", structured_output: {} }]);
  procs[0].end();
  assert.equal((await call).ok, true);
});

test("judgment never runs on Haiku: Claude Code's default instead, said once", () => {
  const { spawn } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  assert.equal(provider.judgmentModel!(""), "");
  assert.equal(provider.judgmentModel!("sonnet"), "sonnet");
  assert.equal(provider.judgmentModel!("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(provider.judgmentModel!("claude-haiku-5-5"), "");
  assert.equal(provider.judgmentModel!("Haiku"), "");
  assert.equal(warn.mock.calls.length, 1);
  assert.match(String(warn.mock.calls[0]![0]), /never files on Haiku/);
  warn.mockRestore();
});

test("extract reports an answer with no structured output, or none at all, as a failure", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const a = provider.extract!({ system: "s", message: "m", schema: {} });
  procs[0].say([
    { type: "result", subtype: "error_max_turns", is_error: true },
  ]);
  procs[0].end();
  const ra = await a;
  assert.equal(ra.ok, false);
  assert.equal(ra.error, "error_max_turns");
  const b = provider.extract!({ system: "s", message: "m", schema: {} });
  procs[1].end();
  assert.deepEqual((await b).error, "no result");
});

test("extract gives up on a call that hangs, and ends its process", async () => {
  const { spawn, procs } = fakeSpawn();
  const provider = claudeCode({ home, spawn });
  const r = await provider.extract!({
    system: "s",
    message: "m",
    schema: {},
    timeoutMs: 20,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "timed out");
  assert.equal(procs[0].killed, true);
});

// ---- the read-only chat behind a side chat ---------------------------------

const say = (text: string) => ({
  type: "stream_event",
  event: { type: "content_block_delta", delta: { text } },
});
const start = (model = "claude-opus-5-5") => ({
  type: "stream_event",
  event: { type: "message_start", message: { model } },
});

function chat() {
  const { spawn, procs } = fakeSpawn();
  const events: unknown[] = [];
  let closed = 0;
  const c = claudeCode({ home, spawn }).openChat!(
    { cwd: "/project", dir: "/h/sides/c", model: "opus" },
    { event: (e) => events.push(e), close: () => closed++ },
  );
  return { c, p: procs[0]!, events, closed: () => closed };
}

test("a chat's process is read-only and takes one message after another on its input", () => {
  const t = chat();
  const after = (flag: string) => t.p.args[t.p.args.indexOf(flag) + 1];
  assert.equal(after("--tools"), "Read,Grep,Glob");
  assert.equal(after("--add-dir"), "/h/sides/c");
  assert.equal(after("--model"), "opus");
  assert.equal(after("--input-format"), "stream-json");
  assert.equal(t.p.cwd, "/project");
  assert.equal(t.p.env?.CLAUDECODE, undefined);
  t.c.send("What is this for?");
  t.c.send("And this?");
  assert.deepEqual(
    t.p.sent
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l)),
    ["What is this for?", "And this?"].map((content) => ({
      type: "user",
      message: { role: "user", content },
    })),
  );
});

test("a chat passes on words, the tools it uses and the result, and nothing else", () => {
  const t = chat();
  t.c.send("q");
  t.p.stdout!.push("not json\nnull\n7\n");
  t.p.say([
    start(),
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "ignored here" },
          { type: "tool_use", name: "Read", input: { file_path: "/p/a.ts" } },
          { type: "tool_use", name: "Grep", input: { pattern: "TODO" } },
          { type: "tool_use", name: "Glob", input: {} },
        ],
      },
    },
    start(),
    say("It holds"),
    say(""),
    say(" the plan."),
    { type: "system", subtype: "init" },
    {
      type: "result",
      total_cost_usd: 0.03,
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 1000,
        output_tokens: 50,
      },
    },
  ]);
  assert.deepEqual(t.events, [
    { type: "start" },
    { type: "tool", name: "Read", target: "/p/a.ts" },
    { type: "tool", name: "Grep", target: "TODO" },
    { type: "tool", name: "Glob", target: "" },
    { type: "start" },
    { type: "text", text: "It holds" },
    { type: "text", text: " the plan." },
    {
      type: "result",
      ok: true,
      usage: { usd: 0.03, input: 1015, output: 50, model: "claude-opus-5-5" },
    },
  ]);
});

test("a chat's cost is what the process's total grew by; with no total, its tokens priced", () => {
  const t = chat();
  const result = (extra: object) => ({ type: "result", usage: {}, ...extra });
  t.c.send("one");
  t.p.say([start(), result({ total_cost_usd: 0.03 })]);
  t.c.send("two");
  t.p.say([start(), result({ total_cost_usd: 0.05 })]);
  t.c.send("three");
  t.p.say([
    start("claude-opus-5-5"),
    {
      type: "result",
      usage: { input_tokens: 1_000_000, output_tokens: 0 },
    },
  ]);
  // a message with no model named is priced as unknown: nothing
  t.c.send("four");
  t.p.say([{ type: "result", usage: { input_tokens: 1_000_000 } }]);
  const usd = (t.events as { type: string; usage?: { usd: number } }[])
    .filter((e) => e.type === "result")
    .map((e) => Math.round(e.usage!.usd * 100) / 100);
  assert.deepEqual(usd, [0.03, 0.02, 4, 0]);
});

test("a chat that fails says so, in the provider's words when it is signed out", () => {
  const t = chat();
  t.c.send("q");
  t.p.say([
    {
      type: "result",
      is_error: true,
      result: "Not logged in · Please run /login",
    },
    { type: "result", is_error: true, result: "Overloaded" },
  ]);
  const [out, bad] = t.events as { ok: boolean; error?: string }[];
  assert.equal(out!.ok, false);
  assert.match(out!.error!, /signed out/);
  assert.equal(bad!.ok, false);
  assert.equal(bad!.error, undefined);
});

test("a chat keeps a character whole when it arrives split across two chunks", () => {
  const t = chat();
  t.c.send("q");
  const bytes = Buffer.from(`${JSON.stringify(say("Café"))}\n`);
  const cut = bytes.indexOf(0xc3) + 1;
  t.p.stdout!.push(bytes.subarray(0, cut));
  t.p.stdout!.push(bytes.subarray(cut));
  assert.deepEqual(t.events, [{ type: "text", text: "Café" }]);
});

test("a chat is alive until it is stopped, and says once that it closed", async () => {
  const t = chat();
  assert.equal(t.c.alive, true);
  t.c.stop();
  assert.equal(t.c.alive, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(t.closed(), 1);
});

test("extract keeps a character whole when its answer arrives split across two chunks", async () => {
  const { spawn, procs } = fakeSpawn();
  const call = claudeCode({ home, spawn }).extract!({
    system: "s",
    message: "m",
    schema: {},
  });
  const bytes = Buffer.from(
    JSON.stringify({ structured_output: { quote: "Café" }, usage: {} }),
  );
  const cut = bytes.indexOf(0xc3) + 1;
  procs[0]!.stdout!.push(bytes.subarray(0, cut));
  procs[0]!.stdout!.push(bytes.subarray(cut));
  procs[0]!.end();
  const r = await call;
  assert.deepEqual(r.value, { quote: "Café" });
});
