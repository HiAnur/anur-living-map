// A meeting's file read as the map's entries: turns start after a pause and
// every minute or so of talk, a pause or the end lets the last one seal, and
// only whole lines are read.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { emptyTranscript, SEAL_IDLE_MS, view } from "../transcript.ts";
import {
  CHUNK_MS,
  CHUNK_WORDS,
  IMPORT_CHUNK_WORDS,
  isMeeting,
  isMeetingFile,
  readMeeting,
  type Line,
} from "./file.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-meeting-file-"));
let n = 0;
const T0 = 1_700_000_000_000;

function meeting(imported = false) {
  const file = path.join(tmp, `m${++n}.meeting.jsonl`);
  const write = (...lines: Line[]) =>
    fs.appendFileSync(
      file,
      lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
    );
  write({
    type: "meeting",
    id: `meeting-${n}`,
    title: "Weekly",
    ts: T0,
    imported,
  });
  const t = emptyTranscript();
  return {
    file,
    t,
    write,
    say: (at: number, text: string, speaker: "you" | "others" = "others") =>
      write({
        type: "segment",
        speaker,
        text,
        start: T0 + at,
        end: T0 + at + 1000,
      }),
    read: () => readMeeting(t, file),
  };
}

test("meetings are told apart by id and file", () => {
  assert.ok(isMeeting("meeting-20261113-abc"));
  assert.ok(!isMeeting("4f0c-chat"));
  assert.ok(isMeetingFile("/x/meeting-1.meeting.jsonl"));
  assert.ok(!isMeetingFile("/x/chat.jsonl"));
});

test("what is said becomes one turn, labelled by who spoke, until a pause seals it", async () => {
  const m = meeting();
  m.say(0, "Let's pick the launch date.", "you");
  m.say(5_000, "Friday works for design.");
  m.say(9_000, "Then Friday it is.", "you");
  await m.read();
  let v = view(m.t, 60_000);
  assert.equal(v.turns.length, 1);
  assert.equal(v.turns[0]!.text, "You: Let's pick the launch date.");
  assert.equal(
    v.turns[0]!.reply,
    "Others: Friday works for design.\n\nYou: Then Friday it is.",
  );
  // still talking: the turn is open however long the file is still
  assert.equal(v.sealed, 0);

  m.write({ type: "pause", ts: T0 + 25_000 });
  await m.read();
  assert.equal(view(m.t, 0).sealed, 0, "seals only once the file is still");
  v = view(m.t, SEAL_IDLE_MS);
  assert.equal(v.sealed, 1);

  // talk after the pause is a new turn; the sealed one never grows
  m.say(40_000, "Next, the budget.");
  await m.read();
  v = view(m.t, SEAL_IDLE_MS);
  assert.equal(v.turns.length, 2);
  assert.equal(v.turns[1]!.text, "Others: Next, the budget.");
  assert.equal(v.sealed, 1);
  assert.equal(v.turns[0]!.reply.includes("budget"), false);
});

test("a minute of talk starts a new turn, which seals the one before it", async () => {
  const m = meeting();
  for (let s = 0; s <= 130; s += 10) m.say(s * 1000, `Point ${s}.`);
  await m.read();
  const v = view(m.t, 0);
  assert.equal(v.turns.length, 3);
  assert.equal(v.sealed, 2);
  assert.equal(v.turns[1]!.text, `Others: Point ${CHUNK_MS / 1000}.`);
});

test("a long monologue is cut by words too", async () => {
  const m = meeting();
  const long = Array.from({ length: CHUNK_WORDS }, (_, i) => `w${i}`).join(" ");
  m.say(0, long);
  m.say(1000, "and more");
  await m.read();
  assert.equal(view(m.t, 0).turns.length, 2);
});

test("an imported transcript has no times and larger turns, and its end seals the last", async () => {
  const m = meeting(true);
  const line = Array.from({ length: 100 }, () => "word").join(" ");
  for (let i = 0; i < 13; i++)
    m.write({
      type: "segment",
      speaker: "others",
      name: "Priya",
      text: line,
      start: 0,
      end: 0,
    });
  m.write({ type: "end", ts: T0 });
  await m.read();
  const v = view(m.t, SEAL_IDLE_MS);
  assert.equal(v.turns.length, Math.ceil(1300 / IMPORT_CHUNK_WORDS));
  assert.equal(v.sealed, v.turns.length);
  assert.ok(v.turns[0]!.text.startsWith("Priya: word"));
});

test("only whole lines are read; a shorter file is read again", async () => {
  const m = meeting();
  m.say(0, "First.");
  fs.appendFileSync(m.file, '{"type":"segment","speaker":"you","te');
  let r = await m.read();
  assert.equal(r.added, 2); // the meeting line and "First."
  fs.appendFileSync(m.file, 'xt":"Second.","start":1,"end":2}\n');
  r = await m.read();
  assert.equal(r.added, 1);
  assert.equal(view(m.t, 0).turns[0]!.reply, "You: Second.");

  fs.writeFileSync(m.file, "");
  m.say(0, "Again.");
  r = await m.read();
  assert.equal(r.reset, true);
  assert.equal(view(m.t, 0).turns[0]!.text, "Others: Again.");
});

test("a bad line is counted and skipped; empty words and lone pauses add nothing", async () => {
  const m = meeting();
  fs.appendFileSync(m.file, "not json\n");
  m.write({ type: "pause", ts: T0 });
  m.say(0, "   ");
  m.say(1000, "Real words.");
  await m.read();
  assert.equal(m.t.bad, 1);
  assert.equal(view(m.t, 0).turns.length, 1);
});
