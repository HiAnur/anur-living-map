// What the extractor is told about a meeting: the reviewed text, the same
// kinds and schema as a chat, and turns shown as what was said.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";

import { PROMPT_ID } from "../extract.ts";
import { KINDS } from "../items.ts";
import type { Turn } from "../transcript.ts";
import {
  MEETING_PROMPT_ID,
  MEETING_SYSTEM,
  renderMeetingTurns,
} from "./prompt.ts";

test("the instructions are the reviewed text", () => {
  const pinned = fs.readFileSync(
    new URL("../fixtures/meeting-system.txt", import.meta.url),
    "utf8",
  );
  assert.equal(MEETING_SYSTEM, pinned);
});

test("every kind is explained, and runs are told apart from a chat's", () => {
  for (const k of KINDS)
    assert.match(MEETING_SYSTEM, new RegExp(`\\n- ${k}[ :(]`));
  assert.notEqual(MEETING_PROMPT_ID, PROMPT_ID);
  assert.doesNotMatch(MEETING_SYSTEM, /Claude Code/);
});

test("a turn is shown as the lines said in it", () => {
  const turn: Turn = {
    n: 4,
    prompt: "l1",
    via: "typed",
    text: "You: Let's decide.",
    ts: 0,
    end: 0,
    reply: "Others: Friday.\n\nYou: Done.",
    entries: [],
    changes: [],
    hooks: [],
  };
  assert.equal(
    renderMeetingTurns([turn]),
    "TURN 4 · MEETING:\nYou: Let's decide.\nOthers: Friday.\nYou: Done.",
  );
});
