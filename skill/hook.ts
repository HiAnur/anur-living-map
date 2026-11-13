// The living-map hook, run by your Claude Code each time you send a message
// (UserPromptSubmit). The chat map is retired, so the hook only shows you
// how to remove it, at most once per chat, and otherwise does nothing. It
// never calls the server and reads no file of yours, so a prompt is never
// held up, whether or not the server runs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.argv[2] ?? process.env.PORT ?? "4317";

const hint = (dir: string, p: string) =>
  `Living Map (chat) is retired and no longer updates. Use Anur Living Map: /anur-living-map. To remove this one: PORT=${p} node "${path.join(dir, "skill", "uninstall.ts")}"`;

// One empty file per chat that has been told. They go in the chat map's data
// folder while it exists; once it is gone, in the temporary folder, so the
// hook never brings the data folder back.
function toldDir(): string {
  const home =
    process.env.LIVING_MAP_HOME ?? path.join(os.homedir(), ".living-map");
  return fs.existsSync(home)
    ? path.join(home, "hook-told")
    : path.join(os.tmpdir(), "living-map-hook-told");
}

// true the first time it is asked for a chat, false ever after; creating
// the file fails when it is there, so two prompts at once tell only one
function firstTime(session: string): boolean {
  try {
    const dir = toldDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, session), "", { flag: "wx" });
    return true;
  } catch {
    // already told, or nowhere to note it: stay quiet rather than repeat
    return false;
  }
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let session: string;
  try {
    session = String(JSON.parse(input).session_id ?? "");
  } catch {
    return;
  }
  // a session id names a file here, so only a plain one is used
  if (!/^[\w-]{1,128}$/.test(session) || !firstTime(session)) return;
  process.stdout.write(JSON.stringify({ systemMessage: hint(APP_DIR, port) }));
}

// a prompt never waits on this hook, even if its input never ends
setTimeout(() => process.exit(0), 2000).unref();
void main();
