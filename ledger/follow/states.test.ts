// The follower's two machines written out whole: every state against every
// event, and what each state allows.

import assert from "node:assert/strict";
import { test } from "vitest";

import { backoff } from "./follower.ts";
import {
  fileState,
  hasRead,
  mayRead,
  onFile,
  onRead,
  readState,
  type FileState,
  type ReadEvent,
  type ReadState,
} from "./states.ts";

const reading: Record<ReadState, { readOnce: boolean; readBusy: boolean }> = {
  "not read": { readOnce: false, readBusy: false },
  "reading first": { readOnce: false, readBusy: true },
  read: { readOnce: true, readBusy: false },
  reading: { readOnce: true, readBusy: true },
};
const EVENTS: ReadEvent[] = ["start", "first view", "end", "restart"];

test("reading: every state against every event", () => {
  const table: Record<ReadState, Record<ReadEvent, ReadState>> = {
    "not read": {
      start: "reading first",
      "first view": "read",
      end: "not read",
      restart: "not read",
    },
    "reading first": {
      start: "reading first",
      "first view": "reading",
      end: "not read",
      restart: "reading first",
    },
    read: {
      start: "reading",
      "first view": "read",
      end: "read",
      restart: "not read",
    },
    reading: {
      start: "reading",
      "first view": "reading",
      end: "read",
      restart: "reading first",
    },
  };
  for (const [from, row] of Object.entries(table) as [
    ReadState,
    Record<ReadEvent, ReadState>,
  ][])
    for (const e of EVENTS) {
      const f = { ...reading[from] };
      assert.equal(readState(f), from);
      onRead(f, e);
      assert.equal(readState(f), row[e], `${from} + ${e}`);
    }
});

test("reading: a read waits for the one under way, and filing waits for the first", () => {
  const allows = (s: ReadState) => [mayRead(reading[s]), hasRead(reading[s])];
  assert.deepEqual(allows("not read"), [true, false]);
  assert.deepEqual(allows("reading first"), [false, false]);
  assert.deepEqual(allows("read"), [true, true]);
  assert.deepEqual(allows("reading"), [false, true]);
});

test("filing: a run, then success or a wait that grows with each failure in a row", () => {
  const now = 1_000_000;
  const f = { running: null as Promise<void> | null, failures: 0, retryAt: 0 };
  const at = (t: number): FileState => fileState(f, t);
  assert.equal(at(now), "idle");
  f.running = Promise.resolve();
  assert.equal(at(now), "filing");
  f.running = null;
  onFile(f, "failed", now);
  assert.equal(at(now), "backing off");
  assert.equal(at(now + backoff(1) - 1), "backing off");
  assert.equal(at(now + backoff(1)), "idle");
  onFile(f, "failed", now);
  assert.equal(f.failures, 2);
  assert.equal(f.retryAt, now + backoff(2));
  assert.ok(backoff(2) > backoff(1), "each failure in a row waits longer");
  f.running = Promise.resolve();
  assert.equal(
    at(now),
    "filing",
    "a run under way is filing, whatever came before",
  );
  f.running = null;
  onFile(f, "succeeded", now);
  assert.deepEqual([f.failures, f.retryAt, at(now)], [0, 0, "idle"]);
});
