// A meeting end to end on a real server: the recorder starts it, sends what
// was said, and the ledger files it with the meeting's own instructions
// while it goes on; a pasted transcript is filed the same way. The routes
// need the token like every /api route.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import type { Agent, ExtractRequest } from "../../server/providers/types.ts";
import type { LedgerView } from "../../shared/ledger.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-meeting-routes-"));
process.env.LIVING_MAP_HOME = path.join(tmp, "living-map");

const { createAuth } = await import("../../server/auth.ts");
const { createApp } = await import("../../server/http.ts");
const { startLedger } = await import("../routes.ts");
const { MEETING_SYSTEM } = await import("./prompt.ts");

// a model that files each turn's first line as a topic and every line with
// "decide" in it as a decision, quoting it
const calls: ExtractRequest[] = [];
const provider: Agent = {
  name: "scripted",
  readMore: async () => ({ added: 0, reset: false }),
  extract: async (req) => {
    calls.push(req);
    const turns = [
      ...req.message.matchAll(
        /TURN (\d+) · MEETING[^\n]*:\n([\s\S]*?)(?=\n\nTURN |$)/g,
      ),
    ].map((m) => ({ n: Number(m[1]), lines: m[2]!.split("\n") }));
    const ops: unknown[] = [];
    const topics: { turn: number; topic: string }[] = [];
    for (const t of turns) {
      const ref = `new${topics.length + 1}`;
      topics.push({ turn: t.n, topic: ref });
      const first = t.lines[0]!.replace(/^[^:]+: /, "");
      ops.push({
        op: "create",
        ref,
        type: "topic",
        title: first,
        quote: first,
        turn: t.n,
      });
      for (const l of t.lines)
        if (/decide/i.test(l)) {
          const words = l.replace(/^[^:]+: /, "");
          ops.push({
            op: "create",
            type: "decision",
            title: words,
            quote: words,
            turn: t.n,
            parent: ref,
          });
        }
    }
    return {
      ok: true,
      value: { topics, ops },
      ms: 1,
      usage: {
        input: 1,
        output: 1,
        costUsd: 0.001,
        model: "scripted",
        effort: "low",
      },
    };
  },
};

const hub = { add() {}, remove() {}, emit() {} };
const map = startLedger(provider, hub, path.join(tmp, "ledger.db"));
const port = await new Promise<number>((done) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => done(p));
  });
});
const auth = createAuth({ home: process.env.LIVING_MAP_HOME, port });
const server = createApp(provider, hub, auth, map).listen(port, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
afterAll(async () => {
  map.meetings.close();
  map.ledger.close();
  await new Promise((r) => server.close(r));
});

function call(
  method: string,
  url: string,
  body?: unknown,
  token: string | null = auth.token,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((done, fail) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: url,
        headers: {
          host: `localhost:${port}`,
          "content-type": "application/json",
          ...(token ? { "x-lm-token": token } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          done({
            status: res.statusCode ?? 0,
            json: data ? JSON.parse(data) : {},
          }),
        );
      },
    );
    req.on("error", fail);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const view = async (conv: string) =>
  (await call("GET", `/api/ledger/view?conv=${conv}`))
    .json as unknown as LedgerView;

// these tests wait on the ledger's own one-second clock through a few
// seals and model calls: more than a test's default 5 s on a slow runner
const SLOW = 30_000;

async function until(cond: () => Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out");
}

test("without the token the recorder gets nothing", async () => {
  assert.equal((await call("POST", "/api/meetings", {}, null)).status, 401);
});

test(
  "a live meeting is mapped while it goes on, with the meeting's instructions",
  async () => {
    const start = await call("POST", "/api/meetings", {
      title: "Launch sync",
      app: "Zoom",
    });
    assert.equal(start.status, 200);
    const conv = start.json.conv as string;
    assert.match(
      start.json.url as string,
      new RegExp(`^/auth\\?n=.+&conv=${conv}$`),
    );

    const t = Date.now() - 200_000;
    const seg = (s: number, text: string, speaker = "others") => ({
      text,
      speaker,
      start: t + s * 1000,
      end: t + s * 1000 + 900,
    });
    // more than a minute of talk: the first turn seals while the meeting goes on
    let r = await call("POST", `/api/meetings/${conv}/segments`, {
      segments: [
        seg(0, "Launch date first.", "you"),
        seg(20, "Let's decide on Friday the 20th."),
        seg(65, "Now pricing."),
      ],
    });
    assert.deepEqual(r.json, { ok: true, count: 3 });
    await until(async () =>
      (await view(conv)).items?.some((i) => i.type === "decision"),
    );
    const v = await view(conv);
    assert.ok(
      v.items.some(
        (i) => i.type === "topic" && i.title === "Launch date first.",
      ),
    );
    assert.equal(calls.at(-1)!.system, MEETING_SYSTEM);
    assert.equal(
      v.items.some((i) => i.title === "Now pricing."),
      false,
      "the open turn waits",
    );

    // the end seals the last turn
    r = await call("POST", `/api/meetings/${conv}/end`, {});
    assert.deepEqual(r.json, { ok: true });
    await until(async () =>
      (await view(conv)).items.some((i) => i.title === "Now pricing."),
    );

    // read back as text, it says it is a meeting, not what Claude is on
    const outline = await new Promise<string>((done) =>
      http.get(
        {
          host: "127.0.0.1",
          port,
          path: `/api/outline?conv=${conv}`,
          headers: { host: `localhost:${port}`, "x-lm-token": auth.token },
        },
        (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => done(d));
        },
      ),
    );
    assert.match(outline, /A meeting: filed about once a minute of talk/);
    assert.doesNotMatch(outline, /Claude isn't on a task/);

    // the map can be opened again later; an ended meeting takes no more words
    const again = await call("POST", `/api/meetings/${conv}/open`, {});
    assert.match(again.json.url as string, /^\/auth\?n=/);
    r = await call("POST", `/api/meetings/${conv}/segments`, {
      segments: [seg(90, "late")],
    });
    assert.equal(r.status, 400);
  },
  SLOW,
);

test(
  "a pasted transcript is filed whole",
  async () => {
    const r = await call("POST", "/api/meetings/import", {
      title: "Yesterday's sync",
      text: "Priya: Budget review.\nPriya: We decide to cut the ads spend.\nMe: Fine by me.",
    });
    assert.equal(r.status, 200);
    const conv = r.json.conv as string;
    await until(async () =>
      (await view(conv)).items?.some((i) => i.type === "decision"),
    );
    const v = await view(conv);
    assert.equal(v.title, "Yesterday's sync");
    assert.ok(
      calls.some((c) =>
        c.message.includes(
          "Priya: We decide to cut the ads spend.\nYou: Fine by me.",
        ),
      ),
    );
  },
  SLOW,
);

test("unknown meetings and bad bodies are refused plainly", async () => {
  assert.equal(
    (
      await call("POST", "/api/meetings/meeting-nope/segments", {
        segments: [],
      })
    ).status,
    404,
  );
  assert.equal(
    (await call("POST", "/api/meetings/meeting-nope/end", {})).status,
    404,
  );
  assert.equal(
    (await call("POST", "/api/meetings/meeting-nope/open", {})).status,
    404,
  );
  assert.equal(
    (await call("POST", "/api/meetings/import", { text: "" })).status,
    400,
  );
});
