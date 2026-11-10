// The one seam between Living Map and the agent behind it: to use another
// agent (the Anthropic API, another vendor, a local model), add a file next
// to claude-code.ts that implements Agent and register it in index.ts.

import type { ReadMore } from "../../ledger/transcript.ts";

// One of your own conversations with the model: the chat a map follows.
export type Conversation = {
  id: string;
  cwd: string; // the folder it runs in
  title: string;
  file?: string; // where the provider keeps it, if on disk
  // the ids it had before it was resumed under a new one, oldest first
  previous?: string[];
};

export type ModelUsage = {
  input: number;
  output: number;
  costUsd: number;
  model: string;
  effort: string;
};

// One answer held to a JSON schema, for the map's own background work (the
// extractor): a fresh call with its own instructions and no tools, never a
// conversation, so it costs the same however long the chat gets.
export type ExtractRequest = {
  system: string; // replaces the provider's own instructions
  message: string;
  schema: Record<string, unknown>; // the JSON Schema the answer must follow
  model?: string; // a model name, or empty for the provider's default
  effort?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

export type ExtractResult = {
  ok: boolean;
  value?: unknown; // the answer, already parsed; check it before trusting it
  error?: string;
  ms: number;
  usage: ModelUsage | null;
};

// A chat that stays open and can only read: the folder it runs in, and one
// more it is given. One question after another goes to the same chat, so it
// keeps what it has read. Behind a side chat.
export type ChatRequest = {
  cwd: string; // the folder it runs in and may read
  dir: string; // one more folder it may read
  model?: string; // a model name, or empty for the provider's default
  propose?: ChatTool; // the one tool it may call to hand something back
};

// A tool the chat may call to hand back something structured (what a side
// chat proposes for the map). A call does nothing but arrive as a "propose"
// event with its input, which the caller checks before trusting.
export type ChatTool = {
  name: string; // letters, digits, _ and -
  description: string;
  schema: Record<string, unknown>; // the JSON Schema of its input
};

// What a chat says as it answers, in the order it happens.
export type ChatEvent =
  | { type: "start" } // a new message begins: a new paragraph, if words follow
  | { type: "text"; text: string }
  | { type: "tool"; name: string; target: string } // what it reads or looks for
  | { type: "propose"; input: unknown } // it called the request's propose tool
  | {
      type: "result"; // the answer is whole, or it failed
      ok: boolean;
      error?: string; // why, in words for you, when the provider knows
      usage: { input: number; output: number; usd: number; model: string };
    };

export interface Chat {
  send(message: string): void;
  stop(): void;
  readonly alive: boolean; // false once it has ended or been stopped
}

// What the map asks of the agent for its own work. Each part is optional; the
// map leaves out what the agent cannot do.
export interface AgentWorker {
  readonly name: string;
  // Optional: one structured answer (see ExtractRequest). Without it the map
  // can't run its extractor.
  extract?(request: ExtractRequest): Promise<ExtractResult>;
  // Optional: open a read-only chat (see ChatRequest). `close` is called once
  // it has ended, however it ended. Without it there are no side chats.
  openChat?(
    request: ChatRequest,
    on: { event(e: ChatEvent): void; close(): void },
  ): Chat;
  // Optional: the model to use for judgment (filing a chat, side chats) when
  // your settings ask for `asked`; empty for the agent's own default. An agent
  // may refuse a model too small to judge.
  judgmentModel?(asked: string): string;
}

// Your own conversations with the agent, as the map finds and follows them.
export interface AgentConversation {
  readonly name: string;
  // what was appended to a chat's transcript since `t.offset`, as the map's
  // entries; a transcript shorter than what was read is read again
  readMore: ReadMore;
  // where a chat goes on once you resumed it under a new id, if it has
  successor?(file: string, id: string): { file: string; id: string } | null;
  // Optional: find one of your conversations to link a map to, by its id or
  // else the newest one in a folder. Without it the map links nothing.
  findConversation?(hint: { id?: string; cwd?: string }): Conversation | null;
}

// An agent the map works with: both sides.
export type Agent = AgentWorker & AgentConversation;
