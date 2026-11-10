// The extractor's checks on what is harder to pin down: quotes that match
// loosely, a state change with no quote behind it, creates named by their
// place, what only you can do, the sweep, links, and the question tool.

import assert from "node:assert/strict";
import { test } from "vitest";

import { first, T2, turn } from "./extract.harness.ts";
import { apply, message, quiet, sweepMessage, type Answer } from "./extract.ts";
import { emptyStore, listsOf, type Store } from "./items.ts";
import type { Turn } from "./transcript.ts";

test("a quote matches through markdown links and small copying slips", () => {
  const s = first();
  const t3 = turn(
    3,
    "ok",
    "PR: [harshit-pi/living-map#19](https://github.com/x), five commits from feat/chat-map.",
  );
  const r = apply(
    s,
    {
      topics: [],
      ops: [
        {
          op: "create",
          type: "finding",
          title: "PR opened",
          quote:
            "PR: harshit-pi/living-map#19, five commits from feat/chat-map.",
          turn: 3,
        },
        {
          op: "create",
          type: "finding",
          title: "Slip",
          quote: "PR harshit-pi/living-map#19, five commits from chat-map",
          turn: 3,
        },
      ],
    },
    [t3],
  );
  assert.deepEqual(r.rejected, []);
});

test("a state change lands even when its quote doesn't check out", () => {
  const s = first();
  apply(
    s,
    {
      topics: [],
      ops: [
        {
          op: "update",
          item: "i2",
          state: "answered",
          quote: "words nobody said here",
          turn: 2,
        },
      ],
    },
    [T2],
  );
  assert.equal(s.items.get("i2")!.state, "answered");
});

test("a wait closed with no quote behind it is marked, until a quoted change or waiting again settles it", () => {
  const close = (st: Store, quote: string, state = "answered") =>
    apply(
      st,
      {
        topics: [],
        ops: [{ op: "update", item: "i2", state, quote, turn: 2 }],
      },
      [T2],
    );
  // no quote from the chat: closed, and marked
  const s = first();
  close(s, "words nobody said here");
  assert.deepEqual(s.items.get("i2")!.unconfirmed, {
    from: "open",
    to: "answered",
    turn: 2,
  });
  // a later change that quotes the chat settles it
  close(s, "Go with VPC peering.");
  assert.equal(s.items.get("i2")!.unconfirmed, undefined);
  // quoted the first time: nothing to check
  const q = first();
  close(q, "Go with VPC peering.");
  assert.equal(q.items.get("i2")!.unconfirmed, undefined);
  // reopened by the extractor: waiting again, nothing to check
  const r = first();
  close(r, "words nobody said here");
  close(r, "words nobody said here", "open");
  assert.equal(r.items.get("i2")!.unconfirmed, undefined);
  // something that wasn't waiting on you is never marked
  const o = first();
  apply(
    o,
    {
      topics: [],
      ops: [
        {
          op: "update",
          item: "i3",
          state: "dropped",
          quote: "nothing like it",
          turn: 2,
        },
      ],
    },
    [T2],
  );
  assert.equal(o.items.get("i3")!.unconfirmed, undefined);
});

test("creates with no ref are named by their place, and a turn with no topic keeps the one before", () => {
  const s = first();
  const t3 = turn(
    3,
    "And the routes?",
    "Routes go in both directions. Want me to add them?",
  );
  const r = apply(
    s,
    {
      topics: [{ turn: 2, topic: "i1" }],
      ops: [
        {
          op: "create",
          type: "question",
          title: "Add routes both ways?",
          quote: "Want me to add them?",
          turn: 3,
          owner: "you",
        },
        {
          op: "create",
          type: "finding",
          title: "Routes go both ways",
          quote: "Routes go in both directions",
          turn: 3,
          parent: "new1",
        },
      ],
    },
    [T2, t3],
  );
  assert.deepEqual(r.rejected, []);
  const [q, f] = [s.items.get("i5")!, s.items.get("i6")!];
  assert.equal(q.parent, "i1", "turn 3 had no topic: it keeps turn 2's");
  assert.equal(f.parent, "i5", "new1 names the first create");
  assert.equal(s.topicOf.get(3), "i1");
});

test("a step only you can do waits on you until it is done, however long ago", () => {
  const s = first();
  s.items.set("i9", {
    id: "i9",
    type: "task",
    state: "to-do",
    title: "Merge PR #21",
    body: "",
    quote: "",
    src: [2],
    parent: "i1",
    owner: "you",
    basis: "said",
    links: [],
    writers: {},
  });
  s.read = 200;
  assert.ok(listsOf(s).waiting.some((i) => i.id === "i9"));
  s.items.get("i9")!.state = "done";
  assert.ok(!listsOf(s).waiting.some((i) => i.id === "i9"));
});

test("the sweep checks what waits on you and has gone quiet, against the turns since", () => {
  const s = first(); // i2 waits on you, from turn 1
  const later = Array.from({ length: 12 }, (_, k) =>
    turn(k + 2, k === 6 ? "I picked VPC peering and it works." : "ok", "Done."),
  );
  s.read = 13;
  const items = quiet(s);
  assert.deepEqual(
    items.map((i) => i.id),
    ["i2"],
  );
  const { message: m, shown } = sweepMessage(s, items, later);
  assert.match(m, /ITEMS TO CHECK:\n- i2 question open owner=you/);
  assert.deepEqual(
    shown.map((t) => t.n),
    later.map((t) => t.n),
  );
  const r = apply(
    s,
    {
      topics: [],
      ops: [
        {
          op: "update",
          item: "i2",
          state: "answered",
          turn: 8,
          quote: "I picked VPC peering",
        },
      ],
    },
    shown,
  );
  assert.deepEqual(r.rejected, []);
  assert.equal(s.items.get("i2")!.state, "answered");
  assert.deepEqual(quiet(s), []);
});

test("links land only between live items, through refs, never to the item itself", () => {
  const s = first();
  const a: Answer = {
    topics: [{ turn: 2, topic: "i1" }],
    ops: [
      {
        op: "create",
        ref: "new1",
        type: "task",
        title: "Add the peering routes",
        quote: "add the peering routes",
        turn: 2,
        parent: "i1",
        owner: "claude",
        links: [
          { rel: "blocks", to: "new1" }, // itself
          { rel: "answers", to: "i99" }, // no such item
          { rel: "answers", to: "i2" },
        ],
      },
      {
        op: "update",
        item: "i2",
        state: "answered",
        quote: "Go with VPC peering",
        turn: 2,
        links: [
          { rel: "blocks", to: "new1" },
          { rel: "blocks", to: "new1" }, // once
          { rel: "nope" as "blocks", to: "new1" }, // not a rel we know
        ],
      },
      {
        op: "create",
        ref: "new2",
        type: "decision",
        title: "Clusters talk over VPC peering",
        body: "No overlay to run.",
        quote: "Go with VPC peering",
        turn: 2,
        parent: "i1",
        links: [{ rel: "answers", to: "i2" }],
      },
    ],
  };
  const r = apply(s, a, [T2]);
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(s.items.get("i5")!.links, [{ rel: "answers", to: "i2" }]);
  assert.deepEqual(s.items.get("i2")!.links, [{ rel: "blocks", to: "i5" }]);
  assert.deepEqual(s.items.get("i6")!.links, [{ rel: "answers", to: "i2" }]);
  assert.equal(s.items.get("i6")!.body, "No overlay to run.");
  // the map the model reads next carries them
  assert.match(message(s, []), /%% i2 blocks i5/);
  assert.match(message(s, []), /%% i6 answers i2/);
});

test("the question tool's lines reach the model in full, and can be quoted", () => {
  const long = "Working on it. ".repeat(400);
  const t3: Turn = {
    ...turn(3, "Which store?", long),
    asked: [
      "Claude asked: Where should sessions live? Options: Redis · Postgres",
      'You picked, for "Where should sessions live?": Postgres',
    ],
  };
  const s = emptyStore("c1", "Sessions");
  const m = message(s, [t3]);
  // past the clipped reply, whole
  assert.match(
    m,
    /TURN 3 · CLAUDE'S QUESTION TOOL:\nClaude asked: Where should sessions live\? Options: Redis · Postgres\nYou picked, for "Where should sessions live\?": Postgres/,
  );
  const r = apply(
    s,
    {
      topics: [{ turn: 3, topic: "new1" }],
      ops: [
        {
          op: "create",
          ref: "new1",
          type: "topic",
          title: "Sessions",
          quote: "Which store?",
          turn: 3,
        },
        {
          op: "create",
          ref: "new2",
          type: "question",
          title: "Where should sessions live?",
          quote: "Where should sessions live?",
          turn: 3,
          owner: "you",
          parent: "new1",
          state: "answered",
        },
        {
          op: "create",
          ref: "new3",
          type: "option",
          title: "Postgres",
          quote: 'You picked, for "Where should sessions live?": Postgres',
          turn: 3,
          parent: "new2",
          state: "taken",
        },
      ],
    },
    [t3],
  );
  assert.deepEqual(r.rejected, []);
  assert.equal(s.items.get("i3")!.state, "taken");
});
