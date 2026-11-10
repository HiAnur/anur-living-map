// The propose tool's MCP server as Claude Code starts it from a chat's
// arguments: it lists the one tool it was given, answers a call to it
// without doing anything, and refuses anything else.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { test } from "vitest";

import { PROPOSE_TOOL } from "../../ledger/sides/proposal.ts";
import { chatArgs } from "./claude-code.ts";

type Server = { command: string; args: string[]; env: Record<string, string> };

async function talk(server: Server, messages: Record<string, unknown>[]) {
  const proc = spawn(server.command, server.args, {
    env: { ...process.env, ...server.env },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const replies: Record<string, unknown>[] = [];
  const wanted = messages.filter((m) => m.id !== undefined).length;
  const done = new Promise<void>((resolve) =>
    readline.createInterface({ input: proc.stdout }).on("line", (l) => {
      replies.push(JSON.parse(l) as Record<string, unknown>);
      if (replies.length === wanted) resolve();
    }),
  );
  for (const m of messages)
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  await done;
  proc.kill();
  return replies as {
    result?: { serverInfo?: { name: string }; tools?: unknown[] } & {
      content?: { text: string }[];
    };
    error?: { code: number };
  }[];
}

test("the propose tool's server offers that tool alone and does nothing on a call", async () => {
  const args = chatArgs({ dir: "/d", emptyMcp: "/e", propose: PROPOSE_TOOL });
  const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]!) as {
    mcpServers: { living_map: Server };
  };
  const [init, list, call, other] = await talk(config.mcpServers.living_map, [
    { id: 1, method: "initialize", params: {} },
    { method: "notifications/initialized" },
    { id: 2, method: "tools/list" },
    {
      id: 3,
      method: "tools/call",
      params: { name: "propose_change", arguments: { ops: [] } },
    },
    { id: 4, method: "tools/call", params: { name: "Bash", arguments: {} } },
  ]);
  assert.equal(init!.result!.serverInfo!.name, "living-map");
  assert.deepEqual(list!.result!.tools, [
    {
      name: PROPOSE_TOOL.name,
      description: PROPOSE_TOOL.description,
      inputSchema: PROPOSE_TOOL.schema,
    },
  ]);
  assert.match(call!.result!.content![0]!.text, /applies it or not/);
  assert.equal(other!.error!.code, -32601);
});
