// The model behind the map is your own Claude Code: the map's background
// calls (filing a chat's new turns) are one stateless `claude -p` each, and
// your chats are found on disk where Claude Code keeps them.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findConversation } from "./claude-sessions.ts";
import type {
  Chat,
  ChatEvent,
  ChatRequest,
  ChatTool,
  ExtractRequest,
  ExtractResult,
  Agent,
  ModelUsage,
} from "./types.ts";

// low effort unless a call asks for more: filing a turn is a small, bounded job
const DEFAULT_EFFORT = "low";

export type Spawn = (
  command: string,
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
) => ChildProcess;

type Tokens = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

type CliResult = {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: Tokens & { iterations?: Tokens[] };
  modelUsage?: Record<string, { outputTokens?: number; costUSD?: number }>;
};

// What a Claude Code session started by your chat inherits that ties it to
// that chat: started with them, every move ran as part of the chat's session.
const SESSION_VARS = [
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_REMOTE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_WORKER_EPOCH",
  "CLAUDE_AFTER_LAST_COMPACT",
  "CLAUDE_EFFORT",
  // the app renews its chats' sign-in over the line dropped above; a child
  // cut off from that line renews its own
  "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
  "CLAUDE_CODE_HOST_AUTH_REFRESH_TIMEOUT_MS",
  "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
  "CLAUDE_CODE_SDK_HAS_SESSIONS_OAUTH_REFRESH",
];
export function childEnv(env: NodeJS.ProcessEnv = process.env) {
  const out = { ...env };
  for (const k of SESSION_VARS) delete out[k];
  return out;
}

// Claude Code keeps a sign-in of its own, apart from the Claude app's; when
// that one can no longer be renewed, every claude -p fails until it is signed
// in again, however signed in the app is
export const SIGNED_OUT =
  "Claude Code on this Mac is signed out, so it can't answer. Open Terminal, run `claude auth login`, sign in in the browser, then ask again.";
export const signedOut = (text: unknown) =>
  /authenticat|oauth|\/login|not logged in|invalid api key/i.test(
    String(text ?? ""),
  );

// $ per million tokens (input, output) and a cache read's share of input. A
// resumed conversation's CLI total also counts everything it cost before, so
// a move on a linked map is priced from its own tokens.
const PRICES: [RegExp, number, number, number][] = [
  [/(fable|mythos)-5-1/, 10, 50, 0.025],
  [/(fable|mythos)-5/, 10, 50, 0.1],
  [/opus-5-5/, 4, 20, 0.05],
  [/opus-(5|4)/, 5, 25, 0.1],
  [/sonnet-5/, 2, 10, 0.1],
  [/sonnet-4/, 3, 15, 0.1],
  [/haiku-5/, 0.1, 0.5, 0.1],
  [/haiku-4/, 1, 5, 0.1],
];
export function priceOf(model: string, usage: CliResult["usage"]): number {
  const price = PRICES.find(([re]) => re.test(model));
  if (!price || !usage) return 0;
  const [, input, output, read] = price;
  const parts = usage.iterations?.length ? usage.iterations : [usage];
  let usd = 0;
  for (const u of parts) {
    const written = u.cache_creation_input_tokens ?? 0;
    const hour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    usd +=
      ((u.input_tokens ?? 0) * input +
        // a write costs 2x input for the hour-long cache, 1.25x for 5 minutes
        hour * input * 2 +
        (written - hour) * input * 1.25 +
        (u.cache_read_input_tokens ?? 0) * input * read +
        (u.output_tokens ?? 0) * output) /
      1e6;
  }
  return usd;
}

// A chat's tools: read-only, and nothing that reaches the network or runs
// anything
export const CHAT_TOOLS = "Read,Grep,Glob";
const NEVER = "WebFetch,WebSearch,Bash,Edit,Write,NotebookEdit";

// A chat's propose tool, served by tool-mcp.ts, as Claude Code names it
const TOOL_MCP = fileURLToPath(new URL("./tool-mcp.ts", import.meta.url));
export const proposeName = (t: ChatTool) => `mcp__living_map__${t.name}`;
const proposeMcp = (t: ChatTool) =>
  JSON.stringify({
    mcpServers: {
      living_map: {
        command: process.execPath,
        args: [TOOL_MCP],
        env: { LM_TOOL: JSON.stringify(t) },
      },
    },
  });

// The arguments of every chat's process. Kept apart so a test can prove
// what a chat may and may not do.
export function chatArgs(o: {
  dir: string; // the one folder it may read beside the one it runs in
  emptyMcp: string;
  model?: string;
  propose?: ChatTool;
}): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools",
    CHAT_TOOLS,
    "--allowedTools",
    o.propose ? `${CHAT_TOOLS},${proposeName(o.propose)}` : CHAT_TOOLS,
    "--disallowedTools",
    NEVER,
    "--restricted",
    "--add-dir",
    o.dir,
    "--no-session-persistence",
    "--strict-mcp-config",
    "--mcp-config",
    o.propose ? proposeMcp(o.propose) : o.emptyMcp,
    "--setting-sources",
    "",
  ];
  if (o.model) args.push("--model", o.model);
  return args;
}

// every chat's process, ended when the server exits
const CHATS = new Set<ChildProcess>();
let exitHook = false;
function track(p: ChildProcess) {
  CHATS.add(p);
  p.once("close", () => CHATS.delete(p));
  if (!exitHook) {
    exitHook = true;
    process.once("exit", () => {
      for (const x of CHATS) x.kill("SIGTERM");
    });
  }
}

export function claudeCode({
  home,
  spawn = nodeSpawn as Spawn,
}: {
  home: string;
  spawn?: Spawn;
}): Agent {
  // An empty MCP config keeps the user's MCP servers (and their ~280k tokens of
  // tool definitions) out of every call.
  const emptyMcp = path.join(home, "empty-mcp.json");
  if (!fs.existsSync(emptyMcp)) fs.writeFileSync(emptyMcp, '{"mcpServers":{}}');

  // A fresh `claude -p` per answer: its own system prompt in place of Claude
  // Code's (so the call isn't mostly Claude Code's instructions and tools), no
  // tools, no settings or MCP servers (your hooks never fire on it), an empty
  // folder, and no prompt cache (the default hour-long cache write costs
  // twice the input, and an extraction is never asked twice). The answer
  // arrives as a structured-output tool call, not text.
  const quiet = path.join(home, "extract");
  function extract(req: ExtractRequest): Promise<ExtractResult> {
    const started = Date.now();
    fs.mkdirSync(quiet, { recursive: true });
    const effort = req.effort || DEFAULT_EFFORT;
    const args = [
      "-p",
      "--output-format",
      "json",
      "--system-prompt",
      req.system,
      "--tools",
      "",
      "--json-schema",
      JSON.stringify(req.schema),
      "--no-session-persistence",
      "--strict-mcp-config",
      "--mcp-config",
      emptyMcp,
      "--setting-sources",
      "",
      "--effort",
      effort,
    ];
    if (req.model) args.push("--model", req.model);
    const env: NodeJS.ProcessEnv = {
      ...childEnv(),
      DISABLE_PROMPT_CACHING: "1",
    };
    if (req.maxOutputTokens)
      env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(req.maxOutputTokens);
    const proc = spawn("claude", args, { cwd: quiet, env });
    return new Promise((resolve) => {
      let out = "";
      let settled = false;
      const end = (r: Omit<ExtractResult, "ms">) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...r, ms: Date.now() - started });
      };
      // the CLI's own retries can wait minutes on a rate limit: past this,
      // the call is given up and tried again later by its caller
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        end({ ok: false, error: "timed out", usage: null });
      }, req.timeoutMs ?? 120_000);
      timer.unref?.();
      proc.on("error", () =>
        end({ ok: false, error: "could not start claude", usage: null }),
      );
      proc.stderr?.on("data", () => {});
      // as text, so a character split across two chunks stays whole
      proc.stdout?.setEncoding("utf8");
      proc.stdout?.on("data", (chunk: string) => {
        out += chunk;
      });
      proc.on("close", () => {
        let r: CliResult | null;
        try {
          r = JSON.parse(out) as CliResult;
        } catch {
          r = null;
        }
        if (!r) return end({ ok: false, error: "no result", usage: null });
        // the model that did the work: the one the call spent most on, so a
        // small helper call on a cheaper model that wrote more output is not
        // taken for it; by output when the CLI gives no cost
        const model =
          Object.entries(r.modelUsage ?? {}).sort(
            (a, b) =>
              (b[1].costUSD ?? 0) - (a[1].costUSD ?? 0) ||
              (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0),
          )[0]?.[0] ??
          req.model ??
          "";
        const u = r.usage ?? {};
        const usage: ModelUsage = {
          input:
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
          output: u.output_tokens ?? 0,
          costUsd: r.total_cost_usd ?? priceOf(model, r.usage),
          model,
          effort,
        };
        if (r.is_error || r.structured_output === undefined)
          return end({
            ok: false,
            error: r.subtype ?? "no structured answer",
            usage,
          });
        end({ ok: true, value: r.structured_output, usage });
      });
      proc.stdin?.on("error", () => {});
      proc.stdin?.end(req.message);
    });
  }

  // One long-lived `claude -p` (stream-json in and out): further messages go
  // to the same process, so its prompt cache keeps what it read. Its output
  // is one event a line; what a side chat needs of each is passed on.
  function openChat(
    req: ChatRequest,
    on: { event(e: ChatEvent): void; close(): void },
  ): Chat {
    const proc = spawn(
      "claude",
      chatArgs({
        dir: req.dir,
        emptyMcp,
        model: req.model,
        propose: req.propose,
      }),
      { cwd: req.cwd, env: childEnv() },
    );
    track(proc);
    let cost = 0; // the CLI's running total for this process
    let model = ""; // the model answering the message under way
    proc.on("error", () => {});
    proc.stderr?.on("data", () => {});
    proc.stdin?.on("error", () => {});
    // as text, so a character split across two chunks stays whole
    proc.stdout?.setEncoding("utf8");
    let buf = "";
    proc.stdout?.on("data", (chunk: string) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let d: Record<string, unknown>;
        try {
          d = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (!d || typeof d !== "object") continue;
        if (d.type === "stream_event") {
          const e = d.event as {
            type?: string;
            message?: { model?: string };
            delta?: { text?: string };
          };
          if (e?.type === "message_start") {
            if (typeof e.message?.model === "string") model = e.message.model;
            on.event({ type: "start" });
          }
          if (e?.type === "content_block_delta" && e.delta?.text)
            on.event({ type: "text", text: e.delta.text });
        } else if (d.type === "assistant") {
          const content = (d.message as { content?: unknown[] })?.content;
          for (const c of Array.isArray(content) ? content : []) {
            const b = c as {
              type?: string;
              name?: string;
              input?: Record<string, unknown>;
            };
            if (b.type !== "tool_use") continue;
            if (req.propose && b.name === proposeName(req.propose)) {
              on.event({ type: "propose", input: b.input });
              continue;
            }
            on.event({
              type: "tool",
              name: `${b.name}`,
              target: String(
                b.input?.file_path ?? b.input?.pattern ?? b.input?.path ?? "",
              ),
            });
          }
        } else if (d.type === "result") {
          const u = (d.usage ?? {}) as Tokens;
          const total =
            typeof d.total_cost_usd === "number" ? d.total_cost_usd : 0;
          // the CLI's total runs on over the process's life: this answer's
          // share is what it grew by
          const usd = total ? Math.max(0, total - cost) : priceOf(model, u);
          if (total) cost = total;
          on.event({
            type: "result",
            ok: !d.is_error,
            ...(d.is_error && signedOut(d.result) ? { error: SIGNED_OUT } : {}),
            usage: {
              usd,
              input:
                (u.input_tokens ?? 0) +
                (u.cache_creation_input_tokens ?? 0) +
                (u.cache_read_input_tokens ?? 0),
              output: u.output_tokens ?? 0,
              model,
            },
          });
        }
      }
    });
    proc.on("close", () => on.close());
    return {
      send(message) {
        model = "";
        proc.stdin?.write(
          `${JSON.stringify({ type: "user", message: { role: "user", content: message } })}\n`,
        );
      },
      stop() {
        proc.kill("SIGTERM");
      },
      get alive() {
        return proc.exitCode === null && !proc.killed;
      },
    };
  }

  // Judgment (what waits on you, what was decided, a side chat's findings)
  // never runs on Haiku: Claude Code's default model instead, said once.
  let warnedHaiku = false;
  function judgmentModel(asked: string): string {
    if (!/haiku/i.test(asked)) return asked;
    if (!warnedHaiku)
      console.warn(
        `[ledger] ledgerModel "${asked}" ignored: the map never files on Haiku`,
      );
    warnedHaiku = true;
    return "";
  }

  return {
    name: "Claude Code",
    extract,
    findConversation: (hint) => findConversation(hint),
    openChat,
    judgmentModel,
  };
}
