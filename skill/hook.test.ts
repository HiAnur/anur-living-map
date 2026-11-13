// The retired hook, run as Claude Code runs it, in temporary folders only:
// it shows how to remove the chat map once per chat, then stays silent, and
// never waits on a server.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

// these start real node processes, which take far longer than the default
// 5 s on a busy machine (the pre-commit hook runs every test file at once)
const SPAWNS = 30_000;

const SCRIPT = fileURLToPath(new URL("./hook.ts", import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-hook-"));

// a port nothing listens on
async function freePort(): Promise<number> {
  const s = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const { port } = s.address() as net.AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

function hook(
  input: string,
  env: Record<string, string>,
  port: number,
): Promise<{ code: number | null; out: string; ms: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, String(port)], {
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out, ms: Date.now() - start }));
    child.stdin.end(input);
  });
}

const prompt = (session: string) =>
  JSON.stringify({
    session_id: session,
    prompt: "private words",
    hook_event_name: "UserPromptSubmit",
  });

test(
  "the hint shows once per chat, then the hook is silent, quick and never fails, with no server",
  async () => {
    const home = path.join(tmp(), ".living-map");
    fs.mkdirSync(home);
    const env = { LIVING_MAP_HOME: home, TMPDIR: tmp() };
    const port = await freePort();

    const first = await hook(prompt("chat-1"), env, port);
    assert.equal(first.code, 0);
    const said = JSON.parse(first.out) as { systemMessage: string };
    assert.match(said.systemMessage, /retired and no longer updates/);
    assert.match(said.systemMessage, /\/anur-living-map/);
    assert.ok(
      said.systemMessage.includes(
        `PORT=${port} node "${path.join(path.dirname(SCRIPT), "uninstall.ts")}"`,
      ),
      said.systemMessage,
    );
    assert.ok(!first.out.includes("private words"));

    for (let i = 0; i < 3; i++) {
      const again = await hook(prompt("chat-1"), env, port);
      assert.equal(again.code, 0);
      assert.equal(again.out, "");
      // far under the hook's own 10 s timeout, with nothing listening
      assert.ok(again.ms < 5000, `${again.ms} ms`);
    }

    const other = await hook(prompt("chat-2"), env, port);
    assert.match(other.out, /retired/);
    assert.deepEqual(fs.readdirSync(path.join(home, "hook-told")).sort(), [
      "chat-1",
      "chat-2",
    ]);
  },
  SPAWNS,
);

test(
  "a deleted data folder is never made again, and the hint still shows once",
  async () => {
    const home = path.join(tmp(), ".living-map");
    const temp = tmp();
    const env = { LIVING_MAP_HOME: home, TMPDIR: temp };
    const port = await freePort();
    assert.match((await hook(prompt("chat-1"), env, port)).out, /retired/);
    assert.equal((await hook(prompt("chat-1"), env, port)).out, "");
    assert.equal(fs.existsSync(home), false);
    assert.ok(fs.existsSync(path.join(temp, "living-map-hook-told", "chat-1")));
  },
  SPAWNS,
);

test(
  "input it cannot use, or a session id that is not plain, is passed over in silence",
  async () => {
    const home = path.join(tmp(), ".living-map");
    fs.mkdirSync(home);
    const env = { LIVING_MAP_HOME: home, TMPDIR: tmp() };
    const port = await freePort();
    for (const input of [
      "",
      "not json",
      JSON.stringify({}),
      prompt("../../etc/passwd"),
    ]) {
      const r = await hook(input, env, port);
      assert.equal(r.code, 0, input);
      assert.equal(r.out, "", input);
    }
    assert.equal(fs.existsSync(path.join(home, "hook-told")), false);
  },
  SPAWNS,
);

test(
  "input that never ends does not hold the prompt up",
  async () => {
    const home = path.join(tmp(), ".living-map");
    fs.mkdirSync(home);
    const start = Date.now();
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, "4317"], {
        env: { ...process.env, LIVING_MAP_HOME: home, TMPDIR: tmp() },
      });
      child.on("close", resolve);
      // stdin is left open
    });
    assert.equal(code, 0);
    assert.ok(Date.now() - start < 10_000);
  },
  SPAWNS,
);
