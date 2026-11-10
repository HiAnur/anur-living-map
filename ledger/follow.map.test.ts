// A followed chat's map after its turns are filed: what you do on it, what
// changed in the system, the sweep of what waits, how long filing took,
// more of a turn filed after a notice, and the handover.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";

import type { ExtractRequest } from "../server/providers/types.ts";
import { applyAction } from "./apply.ts";
import { type Conv } from "./db.ts";
import { SWEEP_SYSTEM } from "./extract.ts";
import { chat, filing, setup, tmp, until } from "./follow.harness.ts";
import { emptyStore, type Item } from "./items.ts";

// ---- what you do on the map -------------------------------------------------

test("your actions land as yours, and an answer reaches the chat", async () => {
  const c = chat();
  const t = setup();
  const root = t.link(c);
  c.turn("Should we use Postgres?", "Postgres? Yes or no?");
  c.turn("Can it run on my laptop?", "Docker or native?");
  t.advance(6000);
  // each turn asks something: one run each
  await t.ledger.tick();
  await t.ledger.tick();
  const v = t.ledger.view(root)!;
  const [q1, q2] = v.items.filter((i) => i.type === "question");
  assert.ok(q1 && q2);
  const [t1, t2] = v.items.filter((i) => i.type === "topic");
  assert.ok(t1!.order < t2!.order, "a later topic sorts after");
  assert.equal(q1.order, q2.order, "each the first under its own topic");

  let r = t.ledger.act(root, { type: "answer", item: q1.id, text: "Yes" });
  assert.equal(r.error, undefined);
  assert.equal(t.told.length, 1);
  assert.match(t.told[0]!.text, /answered "Should we use Postgres\?": Yes/);
  assert.equal(r.view!.items.find((i) => i.id === q1.id)!.state, "answered");

  r = t.ledger.act(root, { type: "not-right", item: q2.id });
  assert.ok(!r.view!.items.some((i) => i.id === q2.id));
  r = t.ledger.act(root, { type: "fold", item: v.items[0]!.id, folded: true });
  assert.equal(r.view!.items[0]!.folded, true);
  r = t.ledger.act(root, { type: "state", item: q1.id, state: "nonsense" });
  assert.match(r.error!, /can't be/);
  r = t.ledger.act(root, { type: "looked" });
  assert.equal(r.view!.lookedTurn, 2);
  assert.ok(r.view!.items.every((i) => !i.isNew));

  const log = t.db.log(root).filter((l) => l.writer === "you");
  assert.deepEqual(
    log.map((l) => (l.op as { op: string }).op),
    ["answer", "miss", "fold", "looked"],
  );
  // the extractor can't undo your answer: the field is yours
  const s = t.db.load(root)!;
  assert.equal(s.store.items.get(q1.id)!.writers.state, "you");
  assert.equal(s.meta.get(v.items[0]!.id)!.folded, true);
});

test("taking an option, reopening a decision and finishing your task tell the chat at once", () => {
  const store = emptyStore("c", "A chat");
  const add = (id: string, type: Item["type"], state: string, more = {}) =>
    store.items.set(id, {
      id,
      type,
      state,
      title: `The ${type}`,
      body: "",
      quote: "",
      src: [1],
      parent: null,
      basis: "said",
      links: [],
      writers: {},
      ...more,
    });
  add("i1", "question", "open");
  add("i2", "option", "offered", { parent: "i1" });
  add("i3", "decision", "decided");
  add("i4", "task", "to-do", { owner: "you" });
  add("i5", "task", "doing", { owner: "claude" });
  add("i6", "assumption", "assumed");
  const s = {
    conv: {} as Conv,
    store,
    meta: new Map(),
  };
  const tell = (item: string, state: string) =>
    applyAction(s, { type: "state", item, state }, 1).tell;
  assert.equal(
    tell("i2", "taken"),
    'On the map, the user took the option "The option" for "The question".',
  );
  assert.match(tell("i3", "reopened")!, /reopened the decision "The decision"/);
  assert.match(tell("i4", "done")!, /marked their task "The task" done/);
  assert.equal(tell("i5", "done"), undefined, "Claude's own task: no");
  assert.equal(tell("i6", "confirmed"), undefined);
});

// ---- what changed ------------------------------------------------------------

test("a snapshot when following starts and after each sealed turn; what differs is filed against the turn", async () => {
  const snaps: string[] = [];
  const compared: [string, string, number][] = [];
  const c = chat();
  const t = setup(filing, undefined, {
    shadowFor: () => ({ root: tmp, gitDir: tmp }),
    snapshot: (_sh, label) => {
      snaps.push(label);
      return `c${snaps.length}`;
    },
    compare: (_sh, a, b, turn) => {
      compared.push([a, b, turn]);
      return {
        changed: [{ file: "app/server/x.ts", status: "M", readable: true }],
        statements: [
          {
            op: "added",
            kind: "import-edge",
            key: "app/server→app/layer",
            text: "app/server imports app/layer",
            from: "app/server",
            to: "app/layer",
            files: ["app/server/x.ts"],
            evidence: [{ file: "app/server/x.ts", turn }],
          },
        ],
      };
    },
  });
  const root = t.link(c);
  await t.ledger.tick();
  assert.deepEqual(snaps, ["start"]);
  c.turn("Wire the layer in.", "Done: the server now imports the layer.");
  // read as it grows, sealed once the file has been still 5 s
  await t.ledger.tick();
  assert.deepEqual(snaps, ["start"]);
  t.advance(6000);
  await t.ledger.tick();
  assert.deepEqual(snaps, ["start", "after turn 1"]);
  assert.deepEqual(compared, [["c1", "c2", 1]]);
  const v = t.ledger.view(root)!;
  assert.equal(v.changes.length, 1);
  assert.deepEqual(
    { ...v.changes[0], id: "" },
    {
      id: "",
      change: "added",
      kind: "import-edge",
      text: "app/server imports app/layer",
      module: "app/server",
      file: "app/server/x.ts",
      turn: 1,
      low: false,
    },
  );
  // the same turn read again files nothing twice
  await t.ledger.tick();
  assert.equal(t.ledger.view(root)!.changes.length, 1);
});

test("what waits on you and goes quiet is swept: checked again against the turns since", async () => {
  const c = chat();
  const sweeps: ExtractRequest[] = [];
  const t = setup((req) => {
    if (req.system !== SWEEP_SYSTEM) return filing(req);
    sweeps.push(req);
    const id = /- (i\d+) question/.exec(req.message)?.[1];
    const n = Number(/TURN (\d+) · YOU:\nI chose/.exec(req.message)?.[1] ?? 0);
    return {
      ok: true,
      value: {
        topics: [],
        ops: [
          {
            op: "update",
            item: id,
            state: "answered",
            turn: n,
            quote: "I chose",
          },
        ],
      },
      ms: 1,
      usage: null,
    };
  });
  const root = t.link(c);
  // the file is old: every turn is sealed when first read
  c.turn("Postgres or Mongo?", "Which do you want?");
  for (let k = 0; k < 11; k++)
    c.turn(k === 4 ? "I chose Postgres, go on." : "next", "Done.");
  const ago = (Date.now() - 3_600_000) / 1000;
  fs.utimesSync(c.file, ago, ago);
  for (let k = 0; k < 8 && t.ledger.view(root)!.read < 12; k++) {
    t.advance(60_000);
    await t.ledger.tick();
  }
  assert.ok(sweeps.length >= 1, "a sweep ran");
  const v = t.ledger.view(root)!;
  assert.deepEqual(v.strip.waiting, []);
}, 30_000);

test("the view says which turns are being filed, and how long after a turn sealed it landed", async () => {
  const c = chat();
  const release: (() => void)[] = [];
  const t = setup(
    (req) => new Promise((done) => release.push(() => done(filing(req)))),
  );
  const root = t.link(c);
  c.turn("Which database should we use?", "Postgres or Mongo, which one?");
  await t.ledger.tick();
  // ended, not yet sealed: no run, nothing being filed
  assert.equal(t.ledger.view(root)!.health.filing, undefined);
  t.advance(6000);
  const round = t.ledger.tick();
  await until(() => t.calls.length === 1);
  const during = t.ledger.view(root)!.health;
  assert.deepEqual(during.filing, { turns: [1], since: t.advance(0) });
  assert.equal(during.lag, undefined, "no run has finished yet");
  assert.ok(
    t.events.some((e) => e.type === "ledger" && !!e.view.health.filing),
    "pushed to the page when the run started",
  );
  // the model takes 3 s
  t.advance(3000);
  release.shift()!();
  await round;
  const after = t.ledger.view(root)!.health;
  assert.equal(after.filing, undefined);
  assert.deepEqual(after.lag, { turn: 1, ms: 3000, modelMs: 5 });
  assert.equal(after.behind, 0);
  // the next turn: sealed by the prompt after it and run in the same
  // tick; the lag counts from the seal
  c.turn("Postgres.", "Done.");
  c.you("Now the tests");
  t.advance(1000);
  const next = t.ledger.tick();
  await until(() => t.calls.length === 2);
  assert.deepEqual(t.ledger.view(root)!.health.filing?.turns, [2]);
  t.advance(2000);
  release.shift()!();
  await next;
  assert.deepEqual(t.ledger.view(root)!.health.lag, {
    turn: 2,
    ms: 2000,
    modelMs: 5,
  });
});

test("your word on an item the map closed without a quote settles it", () => {
  for (const [action, state] of [
    [{ type: "state", item: "i1", state: "open" }, "open"],
    [{ type: "state", item: "i1", state: "answered" }, "answered"],
    [{ type: "answer", item: "i1", text: "Postgres" }, "answered"],
  ] as const) {
    const store = emptyStore("c1", "A chat");
    store.items.set("i1", {
      id: "i1",
      type: "question",
      state: "answered",
      title: "Which store?",
      body: "",
      quote: "",
      src: [1],
      parent: null,
      owner: "you",
      basis: "said",
      links: [],
      writers: { state: "extractor" },
      unconfirmed: { from: "open", to: "answered", turn: 1 },
    });
    const s = { conv: {} as Conv, store, meta: new Map() };
    const item = store.items.get("i1")!;
    applyAction(s, action, 1);
    assert.equal(item.state, state);
    assert.equal(item.unconfirmed, undefined);
    assert.equal(item.writers.state, "you");
  }
});

test("what Claude adds to a filed turn after a background task finishes is filed as more of that turn, once", async () => {
  const c = chat();
  const t = setup();
  const root = t.link(c);
  c.turn("Redis or Postgres for sessions?", "Which one do you want?");
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1);
  // the map's listener ends; Claude goes on in the same turn
  c.notice('Background command "Listen for messages from the map" completed');
  c.claude(
    'From your map: you answered "Redis or Postgres?" with "Postgres". Going with Postgres.',
  );
  await t.ledger.tick();
  assert.equal(t.calls.length, 1, "not before the turn is over and still");
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 2, "the new part is filed");
  const m = t.calls[1]!.message;
  assert.match(
    m,
    /TURN 1 · YOU:\n\(No new message from you\. This is more of turn 1/,
  );
  assert.match(m, /TURN 1 · CLAUDE:\nFrom your map: you answered/);
  assert.doesNotMatch(m, /Which one do you want\?/, "only what is new");
  assert.equal(t.ledger.view(root)!.turns, 1, "still one turn");
  // filed once: nothing more to do
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 2);
  // a server that starts again knows how far it read
  const again = setup(filing, t.file);
  again.link(c);
  again.advance(6000);
  await again.ledger.tick();
  await again.ledger.tick();
  assert.equal(again.calls.length, 0);
});

test("a map filed before this was kept starts from where the turn is, and files only what comes after", async () => {
  const c = chat();
  const t = setup();
  const root = t.link(c);
  c.turn("Which region?", "EU or US?");
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1);
  // as an older version left it: no extent stored, and the turn grew since
  c.notice("a build finished");
  c.claude("The build passed.");
  const s = t.db.load(root)!;
  delete s.conv.readExtent;
  t.db.commit(s, [], 0);
  const again = setup(filing, t.file);
  again.link(c);
  again.advance(6000);
  await again.ledger.tick();
  await again.ledger.tick();
  assert.equal(again.calls.length, 0, "what was there is not filed twice");
  c.notice("tests finished");
  c.claude("All tests pass.");
  await again.ledger.tick();
  again.advance(6000);
  await again.ledger.tick();
  assert.equal(again.calls.length, 1);
  assert.match(again.calls[0]!.message, /TURN 1 · CLAUDE:\nAll tests pass\./);
});

test("the handover is rewritten when a turn is filed and when you act, and a failing one holds nothing up", async () => {
  const seen: string[] = [];
  const c = chat();
  const t = setup(filing, undefined, undefined, (s, v) => {
    seen.push(
      v.items
        .filter((i) => i.type === "question")
        .map((i) => `${i.title}:${i.state}`)
        .join(","),
    );
    if (seen.length > 3) throw new Error("disk full");
    void s;
  });
  const root = t.link(c);
  c.turn("Should we use Postgres?", "Postgres? Yes or no?");
  t.advance(6000);
  await t.ledger.tick();
  assert.ok(seen.includes("Should we use Postgres?:open"), "filed");
  const q = t.ledger.view(root)!.items.find((i) => i.type === "question")!;
  t.ledger.act(root, { type: "answer", item: q.id, text: "Yes" });
  assert.equal(seen.at(-1), "Should we use Postgres?:answered", "you acted");
  // the writer failing leaves the map and your action standing
  const r = t.ledger.act(root, { type: "fold", item: q.id, folded: false });
  for (let k = 0; k < 3; k++)
    t.ledger.act(root, { type: "fold", item: q.id, folded: k % 2 === 0 });
  assert.equal(r.error, undefined);
  assert.equal(
    t.ledger.view(root)!.items.find((i) => i.id === q.id)!.state,
    "answered",
  );
});
