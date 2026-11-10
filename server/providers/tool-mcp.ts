// The MCP server behind a chat's propose tool (ChatRequest.propose), run by
// Claude Code over stdio. The tool comes as JSON in LM_TOOL. A call does
// nothing here: the provider reads its input from the chat's stream.

import readline from "node:readline";

const tool = JSON.parse(process.env.LM_TOOL ?? "{}") as {
  name?: string;
  description?: string;
  schema?: unknown;
};
const tools = [
  { name: tool.name, description: tool.description, inputSchema: tool.schema },
];
const send = (m: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);

for await (const raw of readline.createInterface({ input: process.stdin })) {
  let m: { id?: unknown; method?: string; params?: { name?: string } };
  try {
    m = JSON.parse(raw) as typeof m;
  } catch {
    continue;
  }
  if (m.id === undefined) continue;
  if (m.method === "initialize")
    send({
      id: m.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "living-map", version: "1.0.0" },
      },
    });
  else if (m.method === "ping") send({ id: m.id, result: {} });
  else if (m.method === "tools/list") send({ id: m.id, result: { tools } });
  else if (m.method === "tools/call" && m.params?.name === tool.name)
    send({
      id: m.id,
      result: {
        content: [
          {
            type: "text",
            text: "Shown to the user, who applies it or not. Say in a line what it changes; do not repeat it as JSON.",
          },
        ],
      },
    });
  else
    send({
      id: m.id,
      error: { code: -32601, message: "Method not found" },
    });
}
