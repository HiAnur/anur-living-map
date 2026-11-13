// The living-map skill, for your own Claude Code: it starts this app, links
// the conversation it is used in, and opens the map beside it. `npm run skill`
// installs it in ~/.claude/skills; a server that starts with it installed
// writes it again, so an update reaches it too. `npm run skill -- --hook`
// also adds the hook that tells a conversation what its map did (side
// chats, ticks) each time you write there.
//
// `npm run skill` also installs the team map's skill, anur-living-map,
// copied as it is from team/skill: one command sets up both.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(APP_DIR, "skill", "SKILL.md");
// marks a file this app wrote, so one you made yourself is never replaced
export const MARK = "living-map-skill:";

const claudeDir = () =>
  process.env.CLAUDE_CONFIG_DIR
    ? path.resolve(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), ".claude");

export const skillFile = () =>
  path.join(claudeDir(), "skills", "living-map", "SKILL.md");

// the team map's skill: its SKILL.md and the script it runs
const TEAM_SKILL = path.join(APP_DIR, "team", "skill", "anur-living-map");
export const teamSkillDir = () =>
  path.join(claudeDir(), "skills", "anur-living-map");

export const settingsFile = () => path.join(claudeDir(), "settings.json");

// the marker at its end says the hook is this app's, whichever copy or port
// wrote it; no other hook of yours carries it
export const HOOK_MARK = "# living-map-hook";
export const hookCommand = (port: number | string) =>
  `node "${path.join(APP_DIR, "skill", "hook.ts")}" ${port} ${HOOK_MARK}`;

export type Hook = { type?: string; command?: string; timeout?: number };
export type HookGroup = { matcher?: string; hooks?: Hook[] };

// Adds the hook to your Claude Code settings, keeping everything else in
// them as it was; a living-map hook from another copy or port is replaced.
export function installHook(
  port: number | string,
  { file = settingsFile() } = {},
): "installed" | "updated" | "unchanged" {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    // a settings file that is there but unreadable is never overwritten
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const groups = hooks.UserPromptSubmit ?? [];
  const command = hookCommand(port);
  const ours = (h: Hook) => !!h.command?.endsWith(HOOK_MARK);
  if (groups.some((g) => g.hooks?.some((h) => h.command === command)))
    return "unchanged";
  const had = groups.some((g) => g.hooks?.some(ours));
  const kept = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ours(h)) }))
    .filter((g) => g.hooks.length);
  hooks.UserPromptSubmit = [
    ...kept,
    { hooks: [{ type: "command", command, timeout: 10 }] },
  ];
  settings.hooks = hooks;
  writeSettings(file, settings);
  return had ? "updated" : "installed";
}

// Written whole beside it, then moved over it: a write cut short never
// leaves your settings half there.
export function writeSettings(file: string, settings: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.living-map-${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function skillText(port: number | string): string {
  return fs
    .readFileSync(TEMPLATE, "utf8")
    .replaceAll("{{APP_DIR}}", APP_DIR)
    .replaceAll("{{PORT}}", String(port));
}

// write it: always when asked (`force`), else only over a copy this app wrote
export function installSkill(
  port: number | string,
  { force = false, file = skillFile() } = {},
): "installed" | "updated" | "unchanged" | "skipped" {
  const text = skillText(port);
  let old: string | null;
  try {
    old = fs.readFileSync(file, "utf8");
  } catch {
    old = null;
  }
  if (old === text) return "unchanged";
  if (!force && (old === null || !old.includes(MARK))) return "skipped";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return old === null ? "installed" : "updated";
}

// The team map's skill, file for file. Each file is written beside its place
// and moved over it: the skill's script copies itself the same way, since a
// shell reading a script written in place would tear it mid-line.
export function installTeamSkill({
  dir = teamSkillDir(),
  from = TEAM_SKILL,
} = {}): "installed" | "updated" | "unchanged" {
  const had = fs.existsSync(dir);
  let changed = false;
  for (const d of fs.readdirSync(from, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!d.isFile()) continue;
    const src = path.join(d.parentPath, d.name);
    const dst = path.join(dir, path.relative(from, src));
    let same = false;
    try {
      same = fs.readFileSync(dst).equals(fs.readFileSync(src));
    } catch {
      // not there yet
    }
    if (same) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, `${dst}.new`);
    fs.renameSync(`${dst}.new`, dst);
    changed = true;
  }
  return !changed ? "unchanged" : had ? "updated" : "installed";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT ?? 4317;
  const said = (r: string) =>
    r === "unchanged"
      ? "Already installed"
      : r === "updated"
        ? "Updated"
        : "Installed";
  const r = installSkill(port, { force: true });
  console.log(
    `${said(r)}: ${skillFile()}\nIn any Claude Code conversation, say "/living-map" (or "map this") to open a map of it.`,
  );
  console.log(
    `${said(installTeamSkill())}: ${teamSkillDir()}\nIn a Claude Code chat inside any repo, say "/anur-living-map" to open the team's map of it.`,
  );
  if (process.argv.includes("--hook")) {
    const h = installHook(port);
    console.log(
      `${said(h)}: the living-map hook in ${settingsFile()}\nEach message you send now brings what your map did since (side chats, ticks).`,
    );
  }
}
