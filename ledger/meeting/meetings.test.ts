// The meetings the recorder sends: started and followed at once, segments
// checked before they are written, a pause written after silence, an end,
// and transcripts pasted after the meeting read in the formats notes apps
// write.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, test } from "vitest";

import type { Conversation } from "../../server/providers/types.ts";
import type { Line } from "./file.ts";
import { createMeetings, parseTranscript } from "./meetings.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-meetings-"));
const followed: Conversation[] = [];
const meetings = createMeetings({
  home,
  follow: (c) => {
    followed.push(c);
    return c.id;
  },
  pauseMs: 30,
});
afterAll(() => meetings.close());

const linesOf = (conv: string) =>
  fs
    .readFileSync(
      path.join(meetings.dir, conv, "transcript.meeting.jsonl"),
      "utf8",
    )
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Line);

test("a started meeting has its own file and is followed at once", () => {
  const { conv, title } = meetings.start({
    title: "Design review",
    app: "zoom",
  });
  assert.match(conv, /^meeting-\d{14}-[0-9a-f]{6}$/);
  assert.equal(title, "Design review");
  assert.equal(followed.at(-1)!.id, conv);
  assert.equal(followed.at(-1)!.cwd, path.join(meetings.dir, conv));
  assert.equal(
    followed.at(-1)!.file,
    path.join(meetings.dir, conv, "transcript.meeting.jsonl"),
  );
  assert.deepEqual(
    linesOf(conv).map((l) => l.type),
    ["meeting"],
  );
  assert.ok(meetings.has(conv));
});

test("an untitled meeting is named after the app and the time", () => {
  const { title } = meetings.start({ app: "Zoom" });
  assert.match(title, /^Meeting on Zoom, /);
});

test("segments are checked: words kept, speakers known, empty ones dropped", () => {
  const { conv } = meetings.start({});
  const r = meetings.append(conv, [
    { text: " Hello all ", speaker: "you", start: 10, end: 20 },
    { text: "", speaker: "others" },
    { text: "Hi", speaker: "someone", start: -5 },
    "nonsense",
  ]);
  assert.equal(r.count, 2);
  const segs = linesOf(conv).filter((l) => l.type === "segment");
  assert.equal(segs.length, 2);
  assert.deepEqual(
    segs.map((s) => s.type === "segment" && [s.speaker, s.text]),
    [
      ["you", "Hello all"],
      ["others", "Hi"],
    ],
  );
  const hi = segs[1]!;
  assert.ok(hi.type === "segment" && hi.start > 1_000_000, "a bad time is now");
});

test("an unknown meeting, a bad list and an ended meeting are refused", () => {
  assert.ok(meetings.append("meeting-nope", []).error);
  assert.ok(meetings.append("../../etc/passwd", []).error);
  const { conv } = meetings.start({});
  assert.ok(meetings.append(conv, "words").error);
  assert.deepEqual(meetings.end(conv), {});
  assert.ok(meetings.append(conv, [{ text: "late", speaker: "you" }]).error);
  // ending twice writes one end
  meetings.end(conv);
  assert.equal(linesOf(conv).filter((l) => l.type === "end").length, 1);
});

test("after silence a pause is written once; talking again needs a new one", async () => {
  const { conv } = meetings.start({});
  meetings.append(conv, [{ text: "One", speaker: "you" }]);
  meetings.append(conv, [{ text: "Two", speaker: "you" }]);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(
    linesOf(conv).map((l) => l.type),
    ["meeting", "segment", "segment", "pause"],
  );
  meetings.append(conv, [{ text: "Three", speaker: "others" }]);
  meetings.end(conv);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(
    linesOf(conv)
      .map((l) => l.type)
      .slice(-2),
    ["segment", "end"],
  );
});

test("an imported transcript is written whole and ended", () => {
  const r = meetings.importText({
    title: "Pasted",
    text: "Priya: We ship Friday.\nHarshit: I'll write the notes.\n",
    me: "Harshit",
  });
  assert.equal(r.error, undefined);
  const lines = linesOf(r.conv);
  assert.equal(lines[0]!.type === "meeting" && lines[0]!.imported, true);
  assert.equal(lines.at(-1)!.type, "end");
  assert.ok(meetings.importText({ text: "  \n " }).error);
});

test("transcripts in the formats notes apps write", () => {
  assert.deepEqual(
    parseTranscript(
      [
        "[00:01:02] Priya Shah: We should ship Friday.",
        "(1:05) Me: Agreed.",
        "Speaker 2 (00:12): What about QA?",
        "",
        "Harshit  0:20",
        "I'll take QA.",
        "And the release notes.",
        "Okay",
        "Dan:",
        "Sounds good.",
      ].join("\n"),
      "harshit",
    ),
    [
      { speaker: "others", name: "Priya Shah", text: "We should ship Friday." },
      { speaker: "you", text: "Agreed." },
      { speaker: "others", name: "Speaker 2", text: "What about QA?" },
      { speaker: "you", text: "I'll take QA." },
      { speaker: "you", text: "And the release notes." },
      { speaker: "you", text: "Okay" },
      { speaker: "others", name: "Dan", text: "Sounds good." },
    ],
  );
  // no names at all: every line is someone else's
  assert.deepEqual(parseTranscript("we agreed.\nfine by me"), [
    { speaker: "others", text: "we agreed." },
    { speaker: "others", text: "fine by me" },
  ]);
});
