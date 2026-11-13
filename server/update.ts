// The chat map is retired, and a copy running this code never updates again:
// the check always answers that nothing new is out, and an update refuses.
// Later releases carry only the team map, so they must never reach a copy of
// the chat map; this version is the last one such a copy takes.
//
// The check still reports the commit that runs here: a page left open during
// the update that brought this version reloads once it sees a new commit.

import { execFile } from "node:child_process";

import type { UpdateInfo } from "../shared/model.ts";
import { APP_DIR, UNDER_LAUNCHER } from "./config.ts";

export type Run = (cmd: string, args: string[]) => Promise<string>;

const run: Run = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: APP_DIR, timeout: 10_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });

export const RETIRED =
  "Living Map (chat) is retired and no longer updates. Use Anur Living Map: /anur-living-map. To remove this one: node skill/uninstall.ts";

// Nothing is ever available. Only the local checkout is asked, never GitHub.
export async function checkForUpdate({
  git = run,
}: { git?: Run } = {}): Promise<UpdateInfo> {
  const sha = await git("git", ["rev-parse", "HEAD"]).catch(() => "");
  const version = sha
    ? await git("git", ["describe", "--tags", "--always"]).catch(() =>
        sha.slice(0, 7),
      )
    : "";
  return {
    current: { version, sha },
    latest: null,
    available: false,
    behind: 0,
    canUpdate: false,
    reason: RETIRED,
    restarts: UNDER_LAUNCHER,
  };
}

// Refuses, touching nothing: no fetch, no install, no build, no restart.
export async function runUpdate(): Promise<{ ok: false; error: string }> {
  return { ok: false, error: RETIRED };
}
