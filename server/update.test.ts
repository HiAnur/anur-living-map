// The frozen updater, with a scripted git: no real repository or network.

import assert from "node:assert/strict";
import { test } from "vitest";

import { checkForUpdate, RETIRED, runUpdate, type Run } from "./update.ts";

// a fake git: answers by command line, records what ran
function fakeGit(answers: Record<string, string | Error>) {
  const ran: string[] = [];
  const git: Run = async (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    ran.push(line);
    const key = Object.keys(answers).find((k) => line.startsWith(k));
    const a = key === undefined ? "" : answers[key];
    if (a instanceof Error) throw a;
    return a;
  };
  return { git, ran };
}

test("the check never offers an update, and says the chat map is retired and how to remove it", async () => {
  const { git, ran } = fakeGit({
    "git rev-parse HEAD": "abc1234def",
    "git describe": "v0.1.27-3-gabc1234",
    // what a copy behind a later release would have answered
    "git rev-list --count": "12",
  });
  const info = await checkForUpdate({ git });
  assert.equal(info.available, false);
  assert.equal(info.behind, 0);
  assert.equal(info.latest, null);
  assert.equal(info.canUpdate, false);
  assert.equal(info.reason, RETIRED);
  assert.match(info.reason, /retired and no longer updates/);
  assert.match(info.reason, /\/anur-living-map/);
  assert.match(info.reason, /node skill\/uninstall\.ts/);
  assert.ok(
    !ran.some((l) => /fetch|pull|merge|rev-list/.test(l)),
    "nothing is fetched or compared",
  );
});

test("the check still says which commit runs, so a page open across the last update reloads into it", async () => {
  const { git } = fakeGit({
    "git rev-parse HEAD": "abc1234def",
    "git describe": "v0.1.27",
  });
  const info = await checkForUpdate({ git });
  assert.deepEqual(info.current, { version: "v0.1.27", sha: "abc1234def" });

  const untagged = fakeGit({
    "git rev-parse HEAD": "abc1234def",
    "git describe": new Error("No names found"),
  });
  assert.equal(
    (await checkForUpdate({ git: untagged.git })).current.version,
    "abc1234",
  );
});

test("outside a git checkout the check answers the same, with no version", async () => {
  const { git } = fakeGit({
    "git rev-parse HEAD": new Error("not a git repository"),
  });
  const info = await checkForUpdate({ git });
  assert.deepEqual(info.current, { version: "", sha: "" });
  assert.equal(info.available, false);
  assert.equal(info.reason, RETIRED);
});

test("an update is refused with the same words", async () => {
  const r = await runUpdate();
  assert.deepEqual(r, { ok: false, error: RETIRED });
});
