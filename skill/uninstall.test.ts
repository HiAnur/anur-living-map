// The uninstall, in temporary homes only: it takes away exactly what the
// install put there, stops only this app's server, and keeps your data
// unless you say otherwise.

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

// these start real node processes, which take far longer than the default
// 5 s on a busy machine (the pre-commit hook runs every test file at once)
const SPAWNS = 30_000;

import { hookCommand, installHook, installSkill } from "./install.ts";
import {
  pickTarget,
  removeData,
  removeHook,
  removeSkill,
  stopDeps,
  stopServer,
  type Proc,
  type StopDeps,
} from "./uninstall.ts";

const SCRIPT = fileURLToPath(new URL("./uninstall.ts", import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "lm-uninstall-"));

test("the skill goes only when this app wrote it, and files of yours beside it stay", () => {
  const file = path.join(tmp(), "living-map", "SKILL.md");
  assert.equal(removeSkill({ file }), "not-installed");
  installSkill(4317, { file, force: true });
  assert.equal(removeSkill({ file }), "removed");
  assert.equal(fs.existsSync(path.dirname(file)), false);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "my own skill");
  assert.equal(removeSkill({ file }), "not-ours");
  assert.equal(fs.readFileSync(file, "utf8"), "my own skill");

  installSkill(4317, { file, force: true });
  fs.writeFileSync(path.join(path.dirname(file), "notes.md"), "mine");
  assert.equal(removeSkill({ file }), "kept-your-files");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["notes.md"]);
});

test("only the living-map hooks leave the settings; the rest, MCP servers included, stays as it was", () => {
  const file = path.join(tmp(), "settings.json");
  assert.equal(removeHook({ file }), "none", "no settings file");
  const other = { type: "command", command: "echo mine", timeout: 5 };
  const before = {
    permissions: { allow: ["Bash(ls:*)"] },
    mcpServers: { "living-map": { command: "npx", args: ["anur-living-map"] } },
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      UserPromptSubmit: [
        { hooks: [other] },
        {
          hooks: [{ type: "command", command: hookCommand(4317), timeout: 10 }],
        },
      ],
    },
  };
  fs.writeFileSync(file, JSON.stringify(before));
  // another copy on another port added its own, beside yours
  installHook(4400, { file });
  const withTwo = JSON.parse(fs.readFileSync(file, "utf8"));
  withTwo.hooks.UserPromptSubmit.push({
    hooks: [{ type: "command", command: hookCommand(4317) }, other],
  });
  fs.writeFileSync(file, JSON.stringify(withTwo));

  assert.equal(removeHook({ file }), "removed");
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(after.permissions, before.permissions);
  assert.deepEqual(after.mcpServers, before.mcpServers);
  assert.deepEqual(after.hooks.Stop, before.hooks.Stop);
  assert.deepEqual(after.hooks.UserPromptSubmit, [
    { hooks: [other] },
    { hooks: [other] },
  ]);
  assert.equal(removeHook({ file }), "none");
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)),
    ["settings.json"],
    "nothing left beside it",
  );
});

test("hooks left empty are taken away with it, and unreadable settings are never written", () => {
  const file = path.join(tmp(), "settings.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      model: "opus",
      hooks: {
        UserPromptSubmit: [{ hooks: [{ command: hookCommand(4317) }] }],
      },
    }),
  );
  assert.equal(removeHook({ file }), "removed");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    model: "opus",
  });
  fs.writeFileSync(file, "{ not json");
  assert.throws(() => removeHook({ file }));
  assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
});

test("the process to stop is this app's server, or the launcher that runs it", () => {
  const server: Proc = {
    pid: 20,
    ppid: 10,
    command: "/usr/local/bin/node /Users/me/living-map/server/index.ts",
  };
  const launcher: Proc = {
    pid: 10,
    ppid: 1,
    command: "/usr/local/bin/node /Users/me/living-map/server/launcher.ts",
  };
  const shell: Proc = { pid: 10, ppid: 1, command: "-zsh" };
  assert.equal(pickTarget(server, launcher), 10);
  assert.equal(pickTarget(server, shell), 20);
  assert.equal(pickTarget(server, null), 20);
  assert.equal(
    pickTarget({ ...server, command: "python3 -m http.server 4317" }, shell),
    null,
  );
  assert.equal(
    pickTarget({ ...server, command: "node /x/team/live/server.js" }, shell),
    null,
  );
  assert.equal(pickTarget(null, null), null);
});

function deps(over: Partial<StopDeps>, killed: number[]): StopDeps {
  let up = true;
  return {
    healthy: async () => up,
    listener: async () => 20,
    proc: async (pid) =>
      pid === 20
        ? { pid: 20, ppid: 10, command: "node /a/server/index.ts" }
        : { pid: 10, ppid: 1, command: "node /a/server/launcher.ts" },
    kill: (pid) => {
      killed.push(pid);
      up = false;
    },
    pause: async () => {},
    ...over,
  };
}

test("a server that answers as Living Map is stopped; anything else is left running", async () => {
  const killed: number[] = [];
  assert.equal(await stopServer(deps({}, killed)), "stopped");
  assert.deepEqual(killed, [10], "the launcher, so it does not start it again");

  const none: number[] = [];
  assert.equal(
    await stopServer(deps({ healthy: async () => false }, none)),
    "not-running",
  );
  assert.equal(
    await stopServer(
      deps(
        { proc: async (pid) => ({ pid, ppid: 1, command: "ruby app.rb" }) },
        none,
      ),
    ),
    "cannot-stop",
  );
  assert.equal(
    await stopServer(deps({ listener: async () => null }, none)),
    "cannot-stop",
  );
  assert.deepEqual(none, [], "nothing was signalled");
});

test("data is deleted only where it cannot take your home with it", () => {
  const dir = path.join(tmp(), ".living-map");
  assert.equal(removeData(dir), "none");
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "ledger.db"), "x");
  assert.equal(removeData(dir), "removed");
  assert.equal(fs.existsSync(dir), false);
  assert.equal(removeData(os.homedir()), "refused");
  assert.equal(removeData(path.dirname(os.homedir())), "refused");
  assert.equal(removeData("/"), "refused");
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

function uninstall(home: string, port: number, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PORT: String(port),
  };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.LIVING_MAP_HOME;
  return new Promise<string>((resolve, reject) =>
    execFile(process.execPath, [SCRIPT, ...args], { env }, (err, out) =>
      err ? reject(err) : resolve(out),
    ),
  );
}

function installed(home: string) {
  const claude = path.join(home, ".claude");
  const skill = path.join(claude, "skills", "living-map", "SKILL.md");
  installSkill(4317, { file: skill, force: true });
  const settings = path.join(claude, "settings.json");
  fs.writeFileSync(
    settings,
    JSON.stringify({ mcpServers: { "living-map": { command: "npx" } } }),
  );
  installHook(4317, { file: settings });
  const data = path.join(home, ".living-map");
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, "ledger.db"), "private");
  return { skill, settings, data };
}

test(
  "node skill/uninstall.ts, in a test home: skill and hook gone, data kept unless asked",
  async () => {
    const port = await freePort();
    const home = tmp();
    const { skill, settings, data } = installed(home);
    // with no terminal to ask in, the data stays
    const out = await uninstall(home, port, []);
    assert.match(out, /Removed the living-map hook/);
    assert.match(out, /Removed the living-map skill/);
    assert.match(out, /Kept .*\.living-map/);
    assert.match(out, /\/anur-living-map/);
    assert.equal(fs.existsSync(path.dirname(skill)), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, "utf8")), {
      mcpServers: { "living-map": { command: "npx" } },
    });
    assert.equal(
      fs.readFileSync(path.join(data, "ledger.db"), "utf8"),
      "private",
    );

    await uninstall(home, port, ["--keep-data"]);
    assert.ok(fs.existsSync(data));
    const again = await uninstall(home, port, ["--delete-data"]);
    assert.match(again, /No living-map hook/);
    assert.match(again, /Deleted .*\.living-map/);
    assert.equal(fs.existsSync(data), false);
  },
  SPAWNS,
);

test(
  "a real server on a test port is stopped, and only once it answers as Living Map",
  async () => {
    const port = await freePort();
    const dir = path.join(tmp(), "server");
    fs.mkdirSync(dir);
    // a stand-in for the app's server: the same file name, the same answer
    const file = path.join(dir, "index.ts");
    fs.writeFileSync(
      file,
      `import http from "node:http";
http.createServer((_q, r) => r.end(JSON.stringify({ app: "living-map", ok: true }))).listen(${port}, "127.0.0.1");`,
    );
    const child = spawn(process.execPath, [file], { stdio: "ignore" });
    try {
      const d = stopDeps(port);
      for (let i = 0; i < 40 && !(await d.healthy()); i++) await d.pause(100);
      if (!(await d.listener())) return; // no lsof on this machine
      assert.equal(await stopServer(d), "stopped");
      assert.equal(await d.healthy(), false);
    } finally {
      child.kill();
    }
  },
  SPAWNS,
);
