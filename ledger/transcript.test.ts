// The transcript adapter on synthetic transcripts in the shapes Claude Code
// writes: duplicates, partial and bad lines, compaction, queued prompts and
// notices, hook context, and slash commands.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";

import { readMore } from "../server/providers/claude-transcript.ts";
import {
  attachment,
  call,
  claude,
  compact,
  jsonl,
  prompts,
  read,
  summary,
  tmpFile,
  typed,
  user,
} from "./transcript.harness.ts";
import { emptyTranscript, view } from "./transcript.ts";
test("each uuid is kept once, the first copy winning, with no cap", () => {
  const rows: object[] = [typed("p1", null, "hello"), claude("c1", "p1", "hi")];
  let prev = "c1";
  for (let i = 0; i < 6000; i++) {
    rows.push(attachment(`a${i}`, prev, { type: "total_tokens_reminder" }));
    prev = `a${i}`;
  }
  // a resumed chat writes the history again, a parent relinked
  const again = rows.map((r) =>
    (r as { uuid: string }).uuid === "c1" ? { ...r, parentUuid: "x" } : r,
  );
  const t = read([...rows, ...again]);
  assert.equal(t.entries.length, 6002);
  assert.equal(t.duplicates, 6002);
  assert.equal(t.byId.get("c1")?.parent, "p1");
  assert.deepEqual(prompts(t), ["typed:hello"]);
});

test("a partial last line waits until it is whole", async () => {
  const whole = jsonl([typed("p1", null, "first"), claude("c1", "p1", "ok")]);
  const next = JSON.stringify(typed("p2", "c1", "second")) + "\n";
  const f = tmpFile(whole + next.slice(0, 20));
  const t = emptyTranscript();
  await readMore(t, f);
  assert.equal(t.entries.length, 2);
  assert.equal(t.offset, Buffer.byteLength(whole));
  fs.appendFileSync(f, next.slice(20));
  const { added } = await readMore(t, f);
  assert.equal(added, 1);
  assert.deepEqual(prompts(t), ["typed:first", "typed:second"]);
});

test("a bad line is counted and skipped", () => {
  const text =
    jsonl([typed("p1", null, "one")]) +
    '{"type":"assistant","uuid":"broken' +
    "\n" +
    jsonl([claude("c1", "p1", "two"), typed("p2", "c1", "three")]);
  const t = read(text);
  assert.equal(t.bad, 1);
  assert.equal(t.entries.length, 3);
  assert.deepEqual(prompts(t), ["typed:one", "typed:three"]);
});

test("a compaction is walked through, and its summary is not a prompt", () => {
  const t = read([
    typed("p1", null, "before"),
    claude("c1", "p1", "answer"),
    compact("b1", "c1"),
    summary("s1", "b1"),
    attachment("a1", "s1", { type: "session_context" }),
    typed("p2", "a1", "after"),
    claude("c2", "p2", "done"),
  ]);
  const v = view(t, 0);
  assert.equal(v.path[0].uuid, "p1");
  assert.equal(v.path.length, 7);
  assert.equal(v.compactions, 1);
  assert.deepEqual(v.abandoned, []);
  assert.deepEqual(prompts(t), ["typed:before", "typed:after"]);
});

test("a link to an entry never written continues from the one before", () => {
  // an auto-compaction names the message it interrupted, which was never written
  const t = read([
    typed("p1", null, "before"),
    claude("c1", "p1", "working", "tool_use"),
    compact("b1", "never-written"),
    summary("s1", "b1"),
    typed("p2", "s1", "after"),
  ]);
  const v = view(t, 0);
  assert.equal(v.path[0].uuid, "p1");
  assert.deepEqual(v.abandoned, []);
  assert.equal(v.turns.length, 2);
});

test("queued prompts count; task notifications and agent messages do not", () => {
  const t = read([
    typed("p1", null, "start the build"),
    call("c1", "p1", "t1", "Bash"),
    attachment("q1", "c1", {
      type: "queued_command",
      prompt: "also run the tests",
      commandMode: "prompt",
      origin: { kind: "human" },
      humanTurn: true,
    }),
    attachment("q2", "q1", {
      type: "queued_command",
      prompt: "<task-notification>\n<task-id>b1</task-id>…",
      commandMode: "task-notification",
      origin: { kind: "task-notification", producer: "session-task" },
    }),
    attachment("q3", "q2", {
      type: "queued_command",
      prompt: '<agent-message from="a1">\n[Subagent hand-back] …',
      commandMode: "prompt",
      origin: { kind: "peer", from: "a1", handback: true },
      isMeta: true,
    }),
    // an older Claude Code writes no origin
    attachment("q4", "q3", {
      type: "queued_command",
      prompt: [{ type: "text", text: "and lint" }],
      commandMode: "prompt",
    }),
    attachment("q5", "q4", {
      type: "queued_command",
      prompt: "<task-notification>\n<task-id>b2</task-id>…",
      commandMode: "prompt",
    }),
    user("n1", "q5", "<task-notification>\n<task-id>b3</task-id>…", {
      origin: { kind: "task-notification" },
      promptSource: "system",
    }),
    user("n2", "n1", "Another Claude session sent a message: …", {
      origin: { kind: "peer" },
      isMeta: true,
    }),
    user("n3", "n2", "<task-notification>\n<task-id>b4</task-id>…"),
    claude("c2", "n3", "all done"),
  ]);
  assert.deepEqual(prompts(t), [
    "typed:start the build",
    "queued:also run the tests",
    "queued:and lint",
  ]);
  // what Claude said after a notification stays in the turn it belongs to
  assert.equal(view(t, 0).turns[2].reply, "all done");
});

test("hook context is flagged on its turn, never a prompt", () => {
  const t = read([
    typed("p1", null, "what is pending?"),
    attachment("h1", "p1", {
      type: "hook_additional_context",
      content: ["LIVING MAP: 2 questions wait on you"],
      hookName: "UserPromptSubmit",
      hookEvent: "UserPromptSubmit",
    }),
    claude("c1", "h1", "Two questions."),
  ]);
  const v = view(t, 0);
  assert.equal(v.turns.length, 1);
  assert.deepEqual(v.turns[0].hooks, ["h1"]);
  const h = t.byId.get("h1");
  assert.equal(h?.kind, "hook");
  assert.equal(h?.hookEvent, "UserPromptSubmit");
  assert.equal(h?.text, "LIVING MAP: 2 questions wait on you");
});

test("slash commands count when Claude acts on them, not when run locally", () => {
  const t = read([
    // a skill: yours, followed by its expansion
    user(
      "k1",
      null,
      "<command-message>idea-gauntlet</command-message>\n<command-name>/idea-gauntlet</command-name>\n<command-args>a map app</command-args>",
      { origin: { kind: "human" } },
    ),
    user(
      "k1x",
      "k1",
      [{ type: "text", text: "Base directory for this skill…" }],
      {
        isMeta: true,
      },
    ),
    claude("c1", "k1x", "Verdict: build"),
    // a built-in run locally
    user(
      "m1",
      "c1",
      "<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>",
    ),
    user(
      "m1o",
      "m1",
      "<local-command-stdout>Set model to opus</local-command-stdout>",
    ),
    // a custom command from an older Claude Code: no origin, then its expansion
    user(
      "x1",
      "m1o",
      "<command-name>/map</command-name>\n            <command-message>map</command-message>\n            <command-args></command-args>",
    ),
    user("x1x", "x1", "Open the map…", { isMeta: true }),
    claude("c2", "x1x", "Opened"),
    // `!` input, an interruption and a reminder alone are not prompts
    user("b1", "c2", "<bash-input>ls</bash-input>", {
      origin: { kind: "human" },
    }),
    user(
      "b1o",
      "b1",
      "<bash-stdout>a b</bash-stdout><bash-stderr></bash-stderr>",
    ),
    user("i1", "b1o", [
      { type: "text", text: "[Request interrupted by user]" },
    ]),
    user("r1", "i1", "<system-reminder>The date changed.</system-reminder>"),
    // just typed, nothing after it yet: not counted until the next line says
    user(
      "z1",
      "r1",
      "<command-name>/compact</command-name>\n            <command-message>compact</command-message>",
    ),
  ]);
  assert.deepEqual(prompts(t), [
    "command:/idea-gauntlet a map app",
    "command:/map",
  ]);
  assert.equal(t.byId.get("b1")?.kind, "shell");
  assert.equal(t.byId.get("b1")?.text, "ls");
  assert.equal(t.byId.get("i1")?.kind, "interrupt");
  assert.equal(t.byId.get("r1")?.kind, "meta");
});
