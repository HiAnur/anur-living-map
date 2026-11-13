// The living-map skill: written with this copy's folder and port, and never
// over a SKILL.md this app did not write.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { installSkill, skillText } from "./install.ts";

test("the skill is installed with this app's folder and port, refreshed only over its own copy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-"));
  const file = path.join(dir, "living-map", "SKILL.md");
  assert.equal(installSkill(4317, { file }), "skipped", "not installed: left");
  assert.equal(installSkill(4317, { file, force: true }), "installed");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^---\nname: living-map\n/);
  assert.doesNotMatch(text, /\{\{/);
  assert.match(text, /localhost:4317\/api\/link/);
  assert.equal(installSkill(4317, { file }), "unchanged");
  assert.equal(installSkill(4400, { file }), "updated");
  fs.writeFileSync(file, "my own skill");
  assert.equal(installSkill(4317, { file }), "skipped");
  assert.equal(fs.readFileSync(file, "utf8"), "my own skill");
});

test("the skill says the chat map is retired, no longer updates, and how to remove it and move on", () => {
  const text = skillText(4455);
  const front = text.split("---\n")[1];
  assert.match(front, /description: Retired and no longer updated/);
  assert.match(
    text,
    /\*\*Living Map \(chat\) is retired and no longer updates\.\*\*/,
  );
  assert.match(text, /Use Anur Living Map: `\/anur-living-map`/);
  const uninstall = path.resolve(import.meta.dirname, "uninstall.ts");
  assert.ok(text.includes(`PORT=4455 node "${uninstall}"`), uninstall);
  assert.match(
    text,
    /If they want to move, remove this one, then use `\/anur-living-map`/,
  );
  // the hook brings nothing from the map now, so the skill never says it does
  assert.doesNotMatch(text, /arrives with the user's next message/);
});
