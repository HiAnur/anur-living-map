// Turns from a transcript: sealing, rewinds and parallel results, tool
// results with patches, reading in chunks giving what one read gives, and
// the question tool.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";

import {
  attachment,
  base,
  call,
  claude,
  compact,
  jsonl,
  prompts,
  read,
  result,
  stopHook,
  summary,
  tmpFile,
  typed,
  user,
} from "./transcript.harness.ts";
import { emptyTranscript, readMore, SEAL_IDLE_MS, view } from "./transcript.ts";
test("a turn is sealed by a later prompt, or by end_turn and 2 s of quiet", () => {
  const one = [typed("p1", null, "q1"), claude("c1", "p1", "a1")];
  const t1 = read(one);
  assert.equal(view(t1, SEAL_IDLE_MS - 1).sealed, 0);
  assert.equal(view(t1, SEAL_IDLE_MS).sealed, 1);

  // bookkeeping after the reply does not reopen it
  const t2 = read([
    ...one,
    attachment("e1", "c1", { type: "hook_non_blocking_error" }),
    stopHook("s1", "e1"),
    { type: "last-prompt", lastPrompt: "q1", leafUuid: "s1", sessionId: "s1" },
  ]);
  assert.equal(view(t2, 60_000).sealed, 1);

  // still working: a tool call, or a notification Claude will answer
  const t3 = read([typed("p1", null, "q1"), call("c1", "p1", "t1", "Bash")]);
  assert.equal(view(t3, 60_000).sealed, 0);
  const t4 = read([
    ...one,
    user("n1", "c1", "<task-notification>…", {
      origin: { kind: "task-notification" },
    }),
  ]);
  assert.equal(view(t4, 60_000).sealed, 0);

  // a later prompt seals the one before at once, whatever the clock
  const t5 = read([...one, typed("p2", "c1", "q2")]);
  assert.equal(view(t5, 0).sealed, 1);
  assert.equal(view(t5, 0).turns.length, 2);
});

test("a rewind leaves an abandoned branch; parallel results are not one", () => {
  const t = read([
    typed("p1", null, "first"),
    claude("c1", "p1", "one"),
    typed("p2", "c1", "second, abandoned"),
    claude("c2", "p2", "two"),
    // rewound to c1 and asked again
    typed("p3", "c1", "second, again"),
    // two tool calls in one reply: each result hangs off the block that made it
    call("u1", "p3", "t1", "Edit"),
    call("u2", "u1", "t2", "Edit"),
    result("r1", "u1", "t1", {
      filePath: "/repo/a.ts",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-a", "+A"],
        },
      ],
      originalFile: "a\n",
    }),
    result("r2", "u2", "t2", {
      filePath: "/repo/b.ts",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-b", "+B"],
        },
      ],
      originalFile: "b\n",
    }),
    claude("c3", "r2", "both edited"),
  ]);
  const v = view(t, 0);
  assert.deepEqual(
    v.abandoned.map((e) => e.uuid),
    ["p2", "c2"],
  );
  assert.deepEqual(prompts(t), ["typed:first", "typed:second, again"]);
  assert.deepEqual(
    v.turns[1].changes.map((c) => c.filePath),
    ["/repo/a.ts", "/repo/b.ts"],
  );
  assert.ok(v.turns[1].entries.includes("r1"));
});

test("tool results keep patches for what changed, never tool output", () => {
  const t = read([
    typed("p0", null, "set up"),
    call("u0", "p0", "t0", "Write"),
    result("r0", "u0", "t0", {
      type: "create",
      filePath: "/repo/new.ts",
      content: "export const x = 1;\n",
      structuredPatch: [],
      originalFile: null,
    }),
    typed("p1", "r0", "fix it"),
    call("u1", "p1", "t1", "Edit"),
    result("r1", "u1", "t1", {
      filePath: "/repo/new.ts",
      oldString: "1",
      newString: "2",
      originalFile: "export const x = 1;\n",
      structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-export const x = 1;", "+export const x = 2;"],
        },
      ],
      userModified: false,
    }),
    call("u2", "r1", "t2", "Bash"),
    result("r2", "u2", "t2", {
      stdout: "TOOL STDOUT",
      stderr: "",
      interrupted: false,
      bashEditDiff: {
        files: [
          {
            filePath: "/repo/c.json",
            hunks: [
              {
                oldStart: 2,
                oldLines: 1,
                newStart: 2,
                newLines: 1,
                lines: ["-1", "+2"],
              },
            ],
          },
        ],
      },
    }),
    call("u3", "r2", "t3", "Read"),
    result("r3", "u3", "t3", { type: "text", file: { content: "FILE TEXT" } }),
    claude("c1", "r3", "Fixed."),
  ]);
  const v = view(t, 0);
  assert.deepEqual(
    v.changes.map((c) => [c.turn, c.tool, c.toolUseId, c.filePath ?? null]),
    [
      [1, "Write", "t0", "/repo/new.ts"],
      [2, "Edit", "t1", "/repo/new.ts"],
      [2, "Bash", "t2", null],
    ],
  );
  assert.equal(v.changes[0].content, "export const x = 1;\n");
  assert.equal(v.changes[0].originalFile, null);
  assert.equal(v.changes[1].originalFile, "export const x = 1;\n");
  assert.equal(v.changes[2].bashEditDiff?.files[0].filePath, "/repo/c.json");
  assert.equal(v.turns[1].reply, "Fixed.");
  const kept = JSON.stringify(t.entries);
  for (const s of ["TOOL OUTPUT TEXT", "TOOL STDOUT", "FILE TEXT", "oldString"])
    assert.ok(!kept.includes(s), s);
});

test("reading in small chunks, or as the file grows, gives what one read gives", async () => {
  // longer than every chunk size below, short enough that 7-byte reads stay
  // fast when the whole suite runs at once
  const long = "x".repeat(5_000);
  const rows = [
    typed("p1", null, "hello"),
    claude("c1", "p1", `long ${long}`),
    attachment("q1", "c1", {
      type: "queued_command",
      prompt: "queued ✓ ünïcode",
      commandMode: "prompt",
      origin: { kind: "human" },
    }),
    compact("b1", "q1"),
    summary("s1", "b1"),
    typed("p2", "s1", "after"),
    claude("c2", "p2", "done"),
  ];
  const text = jsonl([...rows, ...rows.slice(0, 3)]) + "not json\n";
  const f = tmpFile(text);
  const once = emptyTranscript();
  await readMore(once, f);

  const small = emptyTranscript();
  await readMore(small, f, 7);
  assert.deepEqual(small, once);

  // the file written a few bytes at a time, read after every write
  const g = tmpFile();
  const growing = emptyTranscript();
  const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.length; i += 4093) {
    fs.appendFileSync(g, bytes.subarray(i, i + 4093));
    await readMore(growing, g, 1000);
  }
  assert.deepEqual(growing, once);
  assert.equal(once.duplicates, 3);
  assert.equal(once.bad, 1);
  assert.deepEqual(view(growing, 0).turns, view(once, 0).turns);
  assert.deepEqual(prompts(once), [
    "typed:hello",
    "queued:queued ✓ ünïcode",
    "typed:after",
  ]);
});

test("a file shorter than what was read is read again from the start", async () => {
  const f = tmpFile(jsonl([typed("p1", null, "one"), claude("c1", "p1", "a")]));
  const t = emptyTranscript();
  await readMore(t, f);
  fs.writeFileSync(f, jsonl([typed("p9", null, "new")]));
  const { reset } = await readMore(t, f);
  assert.equal(reset, true);
  assert.deepEqual(prompts(t), ["typed:new"]);
});

test("the question tool's questions and your picks are kept on the turn; a typed answer is not a pick", () => {
  const ask = (
    uuid: string,
    parent: string,
    id: string,
    questions: object[],
  ) => ({
    ...base("assistant", uuid, parent),
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id, name: "AskUserQuestion", input: { questions } },
      ],
      stop_reason: "tool_use",
    },
  });
  const t = read([
    typed("p1", null, "set up sessions"),
    ask("a1", "p1", "q1", [
      {
        question: "Where should sessions live?",
        header: "Store",
        multiSelect: false,
        options: [
          { label: "Redis", description: "fast" },
          { label: "Postgres", description: "durable" },
        ],
      },
      {
        question: "Which regions?",
        header: "Regions",
        multiSelect: true,
        options: [
          { label: "EU", description: "" },
          { label: "US", description: "" },
        ],
      },
    ]),
    user(
      "r1",
      "a1",
      [
        {
          tool_use_id: "q1",
          type: "tool_result",
          content: "Your questions have been answered: …",
        },
      ],
      {
        toolUseResult: {
          questions: [],
          answers: {
            "Where should sessions live?": "Postgres",
            "Which regions?": ["EU", "US"],
          },
        },
        sourceToolAssistantUUID: "a1",
      },
    ),
    claude("c1", "r1", "Postgres it is."),
    typed("p2", "c1", "and the cache?"),
    ask("a2", "p2", "q2", [
      { question: "Cache TTL?", options: [{ label: "1h" }, { label: "1d" }] },
    ]),
    user(
      "r2",
      "a2",
      [
        {
          tool_use_id: "q2",
          type: "tool_result",
          content: "The user doesn't want to proceed",
          is_error: true,
        },
      ],
      {
        toolUseResult:
          "Error: The user doesn't want to proceed with this tool use.",
        sourceToolAssistantUUID: "a2",
      },
    ),
    typed("p3", "r2", "skip the cache for now"),
  ]);
  const turns = view(t, 0).turns;
  assert.deepEqual(turns[0].asked, [
    "Claude asked: Where should sessions live? Options: Redis · Postgres",
    "Claude asked: Which regions? Options (any number): EU · US",
    'You picked, for "Where should sessions live?": Postgres',
    'You picked, for "Which regions?": EU, US',
  ]);
  // never as Claude's words or yours
  assert.equal(turns[0].reply, "Postgres it is.");
  assert.equal(turns[0].text, "set up sessions");
  // a question you answered by typing: asked, no pick, and your words are the next prompt
  assert.deepEqual(turns[1].asked, [
    "Claude asked: Cache TTL? Options: 1h · 1d",
  ]);
  assert.equal(turns[2].text, "skip the cache for now");
});
