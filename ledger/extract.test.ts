// The extractor's checks: a change lands only when it quotes its own turn,
// names one of the new turns, and uses a kind and state that exist; ids are
// ours; a field you set stays yours; topics catch what has no parent.
import assert from "node:assert/strict";
import { test } from "vitest";

import { first, T2, turn } from "./extract.harness.ts";
import { apply, batches, message } from "./extract.ts";
import { listsOf } from "./items.ts";

test("creates land with server ids, refs resolve to parents, quotes match loosely", () => {
  const s = first();
  const ids = [...s.items.keys()];
  assert.deepEqual(ids, ["i1", "i2", "i3", "i4"]);
  assert.equal(s.items.get("i2")!.parent, "i1");
  assert.equal(s.items.get("i3")!.parent, "i2");
  assert.equal(s.topicOf.get(1), "i1");
  assert.deepEqual(
    listsOf(s).waiting.map((i) => i.id),
    ["i2"],
  );
  assert.equal(s.read, 1);
});

test("an update moves state, quoting the turn that shows it, and adds that turn as a source", () => {
  const s = first();
  const r = apply(
    s,
    {
      topics: [{ turn: 2, topic: "i1" }],
      ops: [
        {
          op: "update",
          item: "i4",
          state: "taken",
          quote: "Go with VPC peering.",
          turn: 2,
        },
        { op: "update", item: "i3", state: "dropped", turn: 2 },
        { op: "update", item: "i2", state: "answered", turn: 2 },
        {
          op: "create",
          type: "task",
          title: "Add the peering routes",
          quote: "I'll add the peering routes next",
          turn: 2,
          owner: "claude",
        },
      ],
    },
    [T2],
  );
  assert.deepEqual(r.rejected, []);
  assert.equal(s.items.get("i4")!.state, "taken");
  assert.deepEqual(s.items.get("i4")!.src, [1, 2]);
  assert.equal(
    s.items.get("i5")!.parent,
    "i1",
    "falls back to its turn's topic",
  );
  const l = listsOf(s);
  assert.deepEqual(l.waiting, []);
  assert.deepEqual(
    l.taken.map((i) => i.id),
    ["i4"],
  );
  assert.deepEqual(
    l.open.map((i) => i.id),
    ["i5"],
  );
});

test("bad changes are rejected one by one, and the rest still land", () => {
  const s = first();
  const r = apply(
    s,
    {
      topics: [],
      ops: [
        {
          op: "create",
          type: "ask",
          title: "Invented",
          quote: "words nobody said",
          turn: 2,
        },
        {
          op: "create",
          type: "ask",
          title: "Old turn",
          quote: "Which do you want?",
          turn: 1,
        },
        {
          op: "create",
          type: "task",
          title: "",
          quote: "Go with VPC peering",
          turn: 2,
        },
        { op: "update", item: "i4", state: "chosen", turn: 2 },
        { op: "update", item: "i99", state: "taken", turn: 2 },
        { op: "update", item: "i1", state: "done", turn: 2 },
        {
          op: "create",
          type: "decision",
          title: "Use VPC peering",
          quote: "go with vpc   PEERING",
          turn: 2,
        },
      ],
    },
    [T2],
  );
  assert.equal(r.rejected.length, 6);
  assert.deepEqual(
    r.applied.map((o) => o.title),
    ["Use VPC peering"],
  );
});

test("a field you set is never overwritten by the extractor", () => {
  const s = first();
  const q = s.items.get("i2")!;
  q.state = "answered";
  q.writers.state = "you";
  apply(
    s,
    { topics: [], ops: [{ op: "update", item: "i2", state: "open", turn: 2 }] },
    [T2],
  );
  assert.equal(q.state, "answered");
});

test("retired items leave every list and can't be updated", () => {
  const s = first();
  apply(
    s,
    {
      topics: [],
      ops: [{ op: "retire", item: "i2", reason: "duplicate", turn: 2 }],
    },
    [T2],
  );
  assert.deepEqual(listsOf(s).waiting, []);
  const r = apply(
    s,
    {
      topics: [],
      ops: [{ op: "update", item: "i2", state: "answered", turn: 2 }],
    },
    [T2],
  );
  assert.equal(r.rejected.length, 1);
});

test("a batch closes at 3 turns, or at once after a turn that asks something", () => {
  const plain = (n: number) => turn(n, "ok", "Done.");
  const asks = turn(2, "next?", "Two ways to do it. Which do you want?");
  const b = batches([1, 0, 3, 4, 5, 6, 7].map((n) => (n ? plain(n) : asks)));
  assert.deepEqual(
    b.map((x) => x.map((t) => t.n)),
    [
      [1, 2],
      [3, 4, 5],
      [6, 7],
    ],
  );
});

test("the message folds settled topics and shows the new turns", () => {
  const s = first();
  const m = message(s, [T2]);
  assert.match(m, /MAP SO FAR:\nmindmap/);
  assert.match(m, /i2\("Keep Nebula or move to VPC peering\?"\)/);
  assert.match(m, /TURN 2 · YOU:\nGo with VPC peering\./);
});
