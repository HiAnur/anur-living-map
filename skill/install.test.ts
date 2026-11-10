// The living-map skill: written with this copy's folder and port, and never
// over a SKILL.md this app did not write. The team map's skill goes in with
// it, file for file.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { installSkill, installTeamSkill } from "./install.ts";

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

test("the team map's skill is copied whole, its script still runnable, and again only when it differs", () => {
  const dir = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-")),
    "anur-living-map",
  );
  assert.equal(installTeamSkill({ dir }), "installed");
  assert.match(
    fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"),
    /^---\nname: anur-living-map\n/,
  );
  const script = path.join(dir, "scripts", "open-map.sh");
  assert.ok(fs.statSync(script).mode & 0o100, "the script can be run");
  assert.equal(installTeamSkill({ dir }), "unchanged");
  fs.writeFileSync(script, "an older copy");
  assert.equal(installTeamSkill({ dir }), "updated");
  assert.match(fs.readFileSync(script, "utf8"), /^#!\/bin\/bash/);
  assert.deepEqual(
    fs.readdirSync(path.join(dir, "scripts")),
    ["open-map.sh"],
    "nothing left beside it",
  );
});
