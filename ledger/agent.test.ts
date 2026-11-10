// The chat map on an agent that is not Claude Code: a scripted one whose
// reader hands over the map's own entries (no JSONL, no `claude`), whose
// extractor files the chat, and whose chat answers a side chat and proposes
// through its propose tool. Following, filing, a side chat and applying its
// proposal all work through the seam alone.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import type {
  Agent,
  ChatEvent,
  ExtractRequest,
} from "../server/providers/types.ts";
import { openDb } from "./db.ts";
import { createLedger } from "./follow.ts";
import { until } from "./sides.harness.ts";
import { createSides } from "./sides.ts";
import type { Entry, ReadMore } from "./transcript.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-agent-"));

function scriptedAgent() {
  const entries: Entry[] = [];
  const say = (kind: "prompt" | "assistant", text: string) =>
    entries.push({
      uuid: `e${entries.length + 1}`,
      seq: entries.length,
      parent: entries.at(-1)?.uuid ?? null,
      logicalParent: null,
      type: kind === "prompt" ? "user" : "assistant",
      kind,
      ts: 1_700_000_000_000 + entries.length * 1000,
      text,
      ...(kind === "assistant" ? { stop: "end_turn" } : {}),
    });
  // what the agent has written since the map last read: the map's own entries
  const readMore: ReadMore = async (t) => {
    const fresh = entries.slice(t.offset);
    for (const e of fresh) {
      t.byId.set(e.uuid, e);
      t.entries.push(e);
    }
    t.offset = entries.length;
    return { added: fresh.length, reset: false };
  };
  const asked: ExtractRequest[] = [];
  const sent: string[] = [];
  const agent: Agent = {
    name: "Scripted",
    readMore,
    judgmentModel: (m) => m,
    extract: async (req) => {
      asked.push(req);
      return {
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
              title: "Kafka",
              quote: "Option B is Kafka.",
              turn: 1,
              parent: "new2",
            },
          ],
        },
      };
    },
    openChat: (_req, on) => {
      let alive = true;
      const emit = (e: ChatEvent) => on.event(e);
      return {
        send(message) {
          sent.push(message);
          // answers after the map has taken the reply under way
          setTimeout(() => {
            emit({ type: "start" });
            emit({ type: "text", text: "Kafka needs a broker you don't run." });
            const kafka = /(i\d+) option \(offered\): Kafka/.exec(message)?.[1];
            emit({
              type: "propose",
              input: { ops: [{ op: "update", item: kafka, state: "dropped" }] },
            });
            emit({
              type: "result",
              ok: true,
              usage: { input: 10, output: 5, usd: 0.01, model: "scripted" },
            });
          }, 0);
        },
        stop() {
          alive = false;
          on.close();
        },
        get alive() {
          return alive;
        },
      };
    },
  };
  return { agent, say, asked, sent };
}

test("the chat map follows, files and runs a side chat on another agent", async () => {
  const s = scriptedAgent();
  s.say("prompt", "Which queue should we use?");
  s.say(
    "assistant",
    "Option A is Redis. Option B is Kafka. Which one do you want?",
  );
  let clock = Date.now();
  const db = openDb(path.join(tmp, "ledger.db"));
  const ledger = createLedger({
    db,
    read: s.agent.readMore,
    extract: (req) => s.agent.extract!(req),
    model: () => s.agent.judgmentModel!(""),
    emit: () => {},
    now: () => clock,
    everyMs: 0,
  });
  const root = ledger.follow({
    id: "chat-1",
    file: "scripted:chat-1",
    cwd: tmp,
    title: "Queues",
  });
  await ledger.tick();
  clock += 6000;
  await ledger.tick();
  assert.equal(s.asked.length, 1, "the agent was asked to file the turn");
  const items = ledger.view(root)!.items;
  assert.deepEqual(
    items.map((i) => i.title),
    ["The queue", "Which queue?", "Kafka"],
  );
  const kafka = items.find((i) => i.title === "Kafka")!.id;

  const sides = createSides({
    db,
    ledger,
    read: s.agent.readMore,
    emit: () => {},
    home: tmp,
    openChat: s.agent.openChat,
  });
  const { side } = await sides.act(root, { type: "side-open", item: kafka });
  await sides.act(root, {
    type: "side-say",
    side: side!.id,
    text: "Does Kafka fit?",
  });
  await until(() => sides.get(root, side!.id)!.proposals.length === 1);
  const chat = sides.get(root, side!.id)!;
  assert.match(s.sent[0]!, /THE ITEM: i\d+ option \(offered\): Kafka/);
  assert.equal(
    chat.messages.at(-1)!.text,
    "Kafka needs a broker you don't run.",
  );
  assert.deepEqual(chat.proposals[0]!.ops, ['Mark "Kafka" dropped']);
  await sides.act(root, {
    type: "apply-proposal",
    side: side!.id,
    proposal: chat.proposals[0]!.id,
  });
  assert.equal(ledger.state(root)!.store.items.get(kafka)!.state, "dropped");
  sides.close();
});
