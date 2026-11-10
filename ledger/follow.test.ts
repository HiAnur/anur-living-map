// Following a chat live, on synthetic transcripts in a temp folder, a
// scripted model and a clock the test moves: when turns seal and when a run
// starts, one run per chat and two overall, backoff after a failure, a long
// chat linked late, and a crash between saving an answer and applying it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";

import { readMore } from "../server/providers/claude-transcript.ts";
import { openDb } from "./db.ts";
import { PROMPT_ID, SYSTEM } from "./extract.ts";
import {
  chat,
  filing,
  next,
  settle,
  setup,
  tmp,
  turnsOf,
  until,
} from "./follow.harness.ts";
import { backoff, createLedger } from "./follow.ts";
// ---- sealing and triggers ---------------------------------------------------

test("a turn seals after 2 s still, and runs at once", async () => {
  const c = chat();
  const t = setup();
  const root = t.link(c);
  c.turn("Which database should we use?", "Postgres or Mongo, which one?");
  await t.ledger.tick();
  // Claude ended it, but the file was written just now: not sealed yet
  assert.equal(t.calls.length, 0);
  assert.equal(t.ledger.view(root)!.turns, 1);
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1, "asks something: filed at once");
  const v = t.ledger.view(root)!;
  assert.equal(v.read, 1);
  assert.equal(v.health.behind, 0);
  assert.deepEqual(
    v.items.map((i) => [i.type, i.title]),
    [
      ["topic", "About Which database should we use?"],
      ["question", "Which database should we use?"],
    ],
  );
  assert.deepEqual(v.strip.waiting, [v.items[1]!.id]);
  assert.ok(v.items.every((i) => i.isNew));
  assert.ok(t.events.some((e) => e.type === "ledger" && e.view.read === 1));
});

test("a later prompt seals a turn; what is sealed runs at once, three turns at a time", async () => {
  const c = chat();
  const t = setup();
  const root = t.link(c);
  c.turn("Rename the module", "Done.");
  c.turn("Now the tests", "Updated.");
  c.you("And the docs");
  await t.ledger.tick();
  // two sealed by the prompts after them: filed now, nothing asked or not
  assert.equal(t.calls.length, 1);
  assert.deepEqual(
    turnsOf(t.calls[0]!.message).map((x) => x.n),
    [1, 2],
  );
  assert.equal(t.ledger.view(root)!.health.behind, 0);
  c.claude("Docs too.");
  c.turn("Last, the changelog", "Written.");
  c.turn("And a release note", "Noted.");
  c.turn("Tag it", "Tagged.");
  // turns 3, 4 and 5 sealed by the prompts after them: one batch of three
  t.advance(1000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 2);
  assert.deepEqual(
    turnsOf(t.calls[1]!.message).map((x) => x.n),
    [3, 4, 5],
  );
  // turn 6 is still open until the file has been still for 2 s
  t.advance(1000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 2);
  t.advance(1500);
  await t.ledger.tick();
  assert.equal(t.calls.length, 3);
  assert.equal(t.ledger.view(root)!.read, 6);
});

test("a failure is tried again later and later, its error shown until one works", async () => {
  const c = chat();
  let fail = 2;
  const t = setup((req) =>
    fail-- > 0
      ? { ok: false, error: "rate limited", ms: 1, usage: null }
      : filing(req),
  );
  const root = t.link(c);
  c.turn("Should we ship it?", "Ready when you are. Ship it?");
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1);
  assert.equal(t.ledger.view(root)!.health.error, "rate limited");
  t.advance(backoff(1) - 1000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1, "waits 30 s");
  t.advance(1000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 2);
  t.advance(backoff(1));
  await t.ledger.tick();
  assert.equal(t.calls.length, 2, "then a minute");
  t.advance(backoff(2) - backoff(1));
  await t.ledger.tick();
  assert.equal(t.calls.length, 3);
  const v = t.ledger.view(root)!;
  assert.equal(v.health.error, undefined);
  assert.equal(v.read, 1);
  assert.equal(v.spend.calls, 3);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map(backoff),
    [30_000, 60_000, 120_000, 240_000, 480_000, 600_000],
  );
});
test("one run per chat at a time, two at most overall", async () => {
  const chats = [chat(), chat(), chat()];
  // which two chats run first depends on which reads finish first, so the
  // test checks the rules, not an order: never two runs for one chat, never
  // more than two at once, and every turn filed in the end
  let running = 0;
  let most = 0;
  const release: (() => void)[] = [];
  const t = setup((req) => {
    running++;
    most = Math.max(most, running);
    return new Promise((done) =>
      release.push(() => {
        running--;
        done(filing(req));
      }),
    );
  });
  const roots = chats.map((c) => {
    const root = t.link(c);
    c.turn("Pick one?", "A or B?");
    // written long ago: sealed on first read, whatever the machine's load
    const ago = (Date.now() - 3_600_000) / 1000;
    fs.utimesSync(c.file, ago, ago);
    return root;
  });
  const round = t.ledger.tick();
  await until(() => t.calls.length >= 2);
  await settle();
  assert.equal(t.calls.length, 2, "the third chat waits");
  // a chat's next turn arrives while runs are out
  chats[0]!.turn("And then?", "C?");
  t.advance(60_000);
  void t.ledger.tick();
  await settle();
  assert.equal(t.calls.length, 2, "nothing more starts while two run");
  for (const r of release.splice(0)) r();
  await round;
  // drain: whatever waits runs, two at a time, until every turn is filed
  for (let k = 0; k < 6; k++) {
    t.advance(60_000);
    const next = t.ledger.tick();
    await settle();
    for (const r of release.splice(0)) r();
    await next;
    if (roots.every((r, n) => t.ledger.view(r)!.read === (n === 0 ? 2 : 1)))
      break;
  }
  assert.ok(most <= 2, `at most two at once, saw ${most}`);
  assert.deepEqual(
    roots.map((r) => t.ledger.view(r)!.read),
    [2, 1, 1],
  );
}, 30_000);

test("a long chat linked late reads its newest 40 turns first", async () => {
  const c = chat();
  for (let i = 1; i <= 50; i++) c.turn(`Step ${i}`, `Did step ${i}.`);
  // written an hour ago: every turn is sealed when it is first read
  const ago = (Date.now() - 3_600_000) / 1000;
  fs.utimesSync(c.file, ago, ago);
  const t = setup();
  const root = t.link(c);
  await t.ledger.tick();
  // the first batch reads turns 11-13; the rest show as reading
  assert.deepEqual(
    turnsOf(t.calls[0]!.message).map((x) => x.n),
    [11, 12, 13],
  );
  const v = t.ledger.view(root)!;
  assert.deepEqual(v.health.reading, { done: 3, total: 40 });
  for (let i = 0; i < 20; i++) await t.ledger.tick();
  const done = t.ledger.view(root)!;
  assert.equal(done.read, 50);
  assert.equal(done.health.reading, undefined);
  assert.equal(t.calls.length, 14);
  assert.equal(t.db.findConv([root])!.skipped, 10);
});

test("a chat carried on in another file is read again from that file's start", async () => {
  const a = chat();
  a.turn("first question?", "An answer.");
  const b = chat();
  b.turn("first question?", "An answer.");
  b.turn("second thing", "Done.");
  const h = setup();
  const root = h.link(a);
  h.advance(3000);
  await h.ledger.tick();
  assert.equal(h.ledger.turnsOf(root)?.length, 1);
  // the same chat, linked again from the file it went on in
  h.ledger.follow({ id: a.id, file: b.file, cwd: tmp, title: "A chat" });
  h.advance(3000);
  await h.ledger.tick();
  assert.deepEqual(
    h.ledger.turnsOf(root)?.map((t) => t.text),
    ["first question?", "second thing"],
  );
});

test("a chat you resumed is followed into its new file, under its new id", async () => {
  const before = chat();
  before.turn("Which queue should we use?", "Redis or Kafka?");
  const after = chat();
  after.turn("Which queue should we use?", "Redis or Kafka?");
  const asked: [string, string][] = [];
  const t = setup(filing, undefined, undefined, undefined, (file, id) => {
    asked.push([file, id]);
    return { file: after.file, id: "resumed-1" };
  });
  const root = t.link(before);
  t.advance(6000);
  await t.ledger.tick();
  assert.deepEqual(asked, [], "a chat still growing is not looked past");
  t.advance(16_000);
  await t.ledger.tick();
  assert.deepEqual(asked, [[before.file, before.id]]);
  const conv = t.db.conversations().find((c) => c.root === root)!;
  assert.deepEqual(conv.ids, [before.id, "resumed-1"]);
  assert.equal(conv.file, after.file);
});

test("the map files with the model it is given, or the agent's default", async () => {
  for (const [asked, used] of [
    ["", ""],
    ["sonnet", "sonnet"],
  ]) {
    const c = chat();
    let clock = Date.now();
    const models: (string | undefined)[] = [];
    const ledger = createLedger({
      read: readMore,
      db: openDb(path.join(tmp, `m-${next()}.db`)),
      extract: async (req) => {
        models.push(req.model);
        return filing(req);
      },
      emit: () => {},
      model: () => asked!,
      now: () => clock,
      everyMs: 0,
    });
    ledger.follow({ id: c.id, file: c.file, cwd: tmp, title: "x" });
    c.turn("Go?", "Go?");
    clock += 6000;
    await ledger.tick();
    assert.deepEqual(models, [used]);
  }
});

// ---- crash safety -----------------------------------------------------------

test("an answer saved but never applied is applied once on restart, never twice", async () => {
  const c = chat();
  c.turn("Which cache should we use?", "Redis or memcached?");
  // the first server saves the answer and stops before applying it
  const first = setup();
  const root = first.link(c);
  const answer = filing({
    system: "",
    schema: {},
    message: "TURN 1 · YOU:\nWhich cache should we use?",
  });
  first.db.saveRun(
    root,
    {
      turns: [1],
      base: 0,
      answer: answer.value,
      usage: { usd: 0.01, input: 1, output: 1, model: "x" },
      ms: 1,
    },
    1,
  );
  first.ledger.close();
  first.db.close();

  // restarted: the follower picks the chat up and applies the saved answer
  const second = setup(filing, first.file);
  second.ledger.resume();
  assert.deepEqual(second.ledger.following(), [root]);
  await second.ledger.tick();
  const v = second.ledger.view(root)!;
  assert.equal(v.read, 1);
  assert.equal(v.items.length, 2);
  assert.equal(second.calls.length, 0, "no new call: the answer was saved");
  second.ledger.close();
  second.db.close();

  // and restarted again: nothing applies twice
  const third = setup(filing, first.file);
  third.ledger.resume();
  third.advance(60_000);
  await third.ledger.tick();
  const again = third.ledger.view(root)!;
  assert.equal(again.items.length, 2);
  assert.equal(third.calls.length, 0);
  assert.equal(
    third.db.log(root).filter((l) => l.writer === "extractor").length,
    2,
  );
  assert.throws(
    () => third.db.commit(third.db.load(root)!, [], 1, { id: 1, rejected: [] }),
    /not waiting/,
  );
});

test("every run keeps the id of the instructions it was filed with", async () => {
  const c = chat();
  const t = setup();
  t.link(c);
  c.turn("Which queue should we use?", "Redis or Kafka?");
  t.advance(6000);
  await t.ledger.tick();
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0]!.system, SYSTEM);
  const runs = t.db.db.prepare("SELECT prompt FROM runs").all() as {
    prompt: string | null;
  }[];
  assert.deepEqual(
    runs.map((r) => r.prompt),
    [PROMPT_ID],
  );
});
