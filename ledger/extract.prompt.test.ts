// The extractor's instructions: the kinds and states it is told are the ones
// the store accepts (KINDS, STATES), and the whole text is pinned, so a change
// to what the model is told shows up as a diff of fixtures/extract-system.txt.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";

import {
  PROMPT_ID,
  promptId,
  SCHEMA,
  SWEEP_PROMPT_ID,
  SWEEP_SYSTEM,
  SYSTEM,
} from "./extract.ts";
import { KIND_GUIDE, KINDS, STATES } from "./items.ts";

test("the instructions are the reviewed text", () => {
  const pinned = fs.readFileSync(
    new URL("./fixtures/extract-system.txt", import.meta.url),
    "utf8",
  );
  assert.equal(SYSTEM, pinned);
});

test("every kind and state the store accepts is in the list, and nothing else", () => {
  const head =
    "Kinds and their states (the first is where a new one starts):\n";
  const list = SYSTEM.slice(
    SYSTEM.indexOf(head) + head.length,
    SYSTEM.indexOf("\n\nRules:"),
  ).split("\n");
  const listed = list.map((l) => {
    const m = /^- (\w+)(?: \(([^)]*)\))?: (.+)$/.exec(l);
    assert.ok(m, `not a kind line: ${l}`);
    return { kind: m[1]!, states: m[2]?.split(", ") ?? [""], guide: m[3] };
  });
  assert.deepEqual(
    listed.map((k) => k.kind),
    [...KINDS],
  );
  for (const k of listed) {
    assert.deepEqual(k.states, [...STATES[k.kind as keyof typeof STATES]]);
    assert.equal(k.guide, KIND_GUIDE[k.kind as keyof typeof KIND_GUIDE]);
  }
});

test("each prompt has an id that changes when its text or schema does", () => {
  assert.match(PROMPT_ID, /^[0-9a-f]{12}$/);
  assert.equal(PROMPT_ID, promptId(SYSTEM, SCHEMA));
  assert.notEqual(promptId(`${SYSTEM} `, SCHEMA), PROMPT_ID);
  assert.notEqual(promptId(SYSTEM, { ...SCHEMA, required: [] }), PROMPT_ID);
  assert.notEqual(SWEEP_PROMPT_ID, PROMPT_ID);
  assert.equal(SWEEP_PROMPT_ID, promptId(SWEEP_SYSTEM, SCHEMA));
});
