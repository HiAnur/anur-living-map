// Removes Living Map (chat), which is retired, from this Mac: the server on
// its port, the living-map hook, the living-map skill and, only if you say
// so, its data folder. It removes only what this app put there: a skill or a
// hook you wrote yourself, the team map's skill and its `living-map` MCP
// server stay as they are. The app's own folder (this checkout) is left for
// you to delete.
//
//   node skill/uninstall.ts [--keep-data | --delete-data]
//
// PORT, LIVING_MAP_HOME, CLAUDE_CONFIG_DIR and HOME move what it looks at,
// as they move what install.ts and the server use.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  HOOK_MARK,
  MARK,
  settingsFile,
  skillFile,
  writeSettings,
  type HookGroup,
} from "./install.ts";

export const dataDir = () =>
  process.env.LIVING_MAP_HOME
    ? path.resolve(process.env.LIVING_MAP_HOME)
    : path.join(os.homedir(), ".living-map");

// The skill's folder goes only when its SKILL.md is the one install.ts
// wrote, and then only what install.ts put there: anything else you keep in
// that folder stays, and so does the folder.
export function removeSkill({ file = skillFile() } = {}):
  "removed" | "not-installed" | "not-ours" | "kept-your-files" {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return "not-installed";
  }
  if (!text.includes(MARK)) return "not-ours";
  fs.rmSync(file);
  const dir = path.dirname(file);
  if (fs.readdirSync(dir).length) return "kept-your-files";
  fs.rmdirSync(dir);
  return "removed";
}

// Every UserPromptSubmit hook marked as this app's goes; every other setting,
// hook and MCP server is written back as it was.
export function removeHook({ file = settingsFile() } = {}): "removed" | "none" {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    // a settings file that is there but unreadable is never overwritten
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "none";
    throw e;
  }
  const hooks = settings.hooks as Record<string, HookGroup[]> | undefined;
  const groups = hooks?.UserPromptSubmit;
  if (!hooks || !Array.isArray(groups)) return "none";
  const ours = (command?: string) => !!command?.endsWith(HOOK_MARK);
  if (!groups.some((g) => g.hooks?.some((h) => ours(h.command)))) return "none";
  const kept = groups
    .map((g) => ({
      ...g,
      hooks: (g.hooks ?? []).filter((h) => !ours(h.command)),
    }))
    .filter((g) => g.hooks.length);
  if (kept.length) hooks.UserPromptSubmit = kept;
  else delete hooks.UserPromptSubmit;
  if (!Object.keys(hooks).length) delete settings.hooks;
  writeSettings(file, settings);
  return "removed";
}

export type Proc = { pid: number; ppid: number; command: string };

// What to stop for the server listening on the port: the launcher that runs
// it, if one does (it would start the server again after an update), else
// the server itself. Anything that is not this app's server is never picked.
export function pickTarget(
  listener: Proc | null,
  parent: Proc | null,
): number | null {
  const runs = (p: Proc | null, file: string) =>
    !!p && new RegExp(`[/\\\\]server[/\\\\]${file}(\\s|$)`).test(p.command);
  if (!runs(listener, "index.ts")) return null;
  return runs(parent, "launcher.ts") ? parent!.pid : listener!.pid;
}

const sh = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout: 5_000 }, (err, out) =>
      resolve(err ? "" : out.trim()),
    ),
  );

async function proc(pid: number): Promise<Proc | null> {
  const out = await sh("ps", ["-o", "ppid=,command=", "-p", String(pid)]);
  const m = out.match(/^\s*(\d+)\s+(.*)$/);
  return m ? { pid, ppid: Number(m[1]), command: m[2] } : null;
}

export type StopDeps = {
  healthy: () => Promise<boolean>;
  listener: () => Promise<number | null>;
  proc: (pid: number) => Promise<Proc | null>;
  kill: (pid: number) => void;
  pause: (ms: number) => Promise<void>;
};

export const stopDeps = (port: number): StopDeps => ({
  healthy: async () => {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return ((await r.json()) as { app?: string }).app === "living-map";
    } catch {
      return false;
    }
  },
  listener: async () => {
    const pid = Number(
      (await sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).split(
        "\n",
      )[0],
    );
    return pid > 0 ? pid : null;
  },
  proc,
  kill: (pid) => process.kill(pid, "SIGTERM"),
  pause: (ms) => new Promise((r) => setTimeout(r, ms)),
});

// Stops the server only when it answers as Living Map and the process on its
// port is its own server; otherwise it says so and touches nothing.
export async function stopServer(
  deps: StopDeps,
): Promise<"not-running" | "stopped" | "cannot-stop"> {
  if (!(await deps.healthy())) return "not-running";
  const pid = await deps.listener();
  const listener = pid ? await deps.proc(pid) : null;
  const parent = listener ? await deps.proc(listener.ppid) : null;
  const target = pickTarget(listener, parent);
  if (!target) return "cannot-stop";
  try {
    deps.kill(target);
  } catch {
    return "cannot-stop";
  }
  for (let i = 0; i < 20; i++) {
    await deps.pause(250);
    if (!(await deps.healthy())) return "stopped";
  }
  return "cannot-stop";
}

// Never a folder that holds your home: a LIVING_MAP_HOME set by mistake to
// ~ or / must not take everything with it.
export function removeData(dir = dataDir()): "removed" | "none" | "refused" {
  const home = path.resolve(os.homedir());
  const d = path.resolve(dir);
  if (d === path.parse(d).root || home === d || home.startsWith(d + path.sep))
    return "refused";
  if (!fs.existsSync(d)) return "none";
  fs.rmSync(d, { recursive: true, force: true });
  return "removed";
}

async function askToDelete(dir: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = await rl.question(
      `Delete ${dir}? It holds your chat maps and copies of what was said in those chats. [y/N] `,
    );
    return /^y(es)?$/i.test(a.trim());
  } finally {
    rl.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep-data");
  const del = args.includes("--delete-data");
  if (keep && del) {
    console.error("Pass --keep-data or --delete-data, not both.");
    process.exit(2);
  }
  const port = Number(process.env.PORT ?? 4317);

  const stopped = await stopServer(stopDeps(port));
  if (stopped === "stopped") console.log(`Stopped Living Map on port ${port}.`);
  else if (stopped === "cannot-stop")
    console.log(
      `Living Map answers on port ${port}, but this could not stop it safely. Stop it where you started it (Ctrl-C in its terminal), then run this again.`,
    );

  const hook = removeHook();
  console.log(
    hook === "removed"
      ? `Removed the living-map hook from ${settingsFile()}.`
      : "No living-map hook to remove.",
  );

  const skill = removeSkill();
  console.log(
    {
      removed: `Removed the living-map skill: ${path.dirname(skillFile())}`,
      "not-installed": "The living-map skill was not installed.",
      "not-ours": `Left ${skillFile()}: this app did not write it.`,
      "kept-your-files": `Removed the living-map skill's SKILL.md; other files you keep in ${path.dirname(skillFile())} are still there.`,
    }[skill],
  );

  const dir = dataDir();
  if (fs.existsSync(dir)) {
    const yes =
      del ||
      (!keep &&
        process.stdin.isTTY &&
        stopped !== "cannot-stop" &&
        (await askToDelete(dir)));
    if (yes && stopped === "cannot-stop")
      console.log(`Kept ${dir}: Living Map is still running and uses it.`);
    else if (yes) {
      const r = removeData(dir);
      console.log(
        r === "refused"
          ? `Kept ${dir}: it holds your home folder.`
          : `Deleted ${dir}.`,
      );
    } else
      console.log(
        `Kept ${dir}. To delete it later: node skill/uninstall.ts --delete-data`,
      );
  }

  console.log(
    "Living Map (chat) is retired. Use Anur Living Map: say /anur-living-map in a Claude Code chat inside a repo.",
  );
}
