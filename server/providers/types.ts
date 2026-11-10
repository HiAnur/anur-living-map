// The one seam between Living Map and the model behind it: to use another
// model (the Anthropic API, another vendor, a local model), add a file next
// to claude-code.ts that implements it and register it in index.ts.

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
};

// What a chat says as it answers, in the order it happens.
export type ChatEvent =
  | { type: "start" } // a new message begins: a new paragraph, if words follow
  | { type: "text"; text: string }
  | { type: "tool"; name: string; target: string } // what it reads or looks for
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

export interface ModelProvider {
  readonly name: string;
  // Optional: one structured answer (see ExtractRequest). A provider without
  // it can't run the map's extractor.
  extract?(request: ExtractRequest): Promise<ExtractResult>;
  // Optional: find one of your conversations to link a map to, by its id or
  // else the newest one in a folder. A provider without it links nothing.
  findConversation?(hint: { id?: string; cwd?: string }): Conversation | null;
  // Optional: open a read-only chat (see ChatRequest). `close` is called once
  // it has ended, however it ended. A provider without it runs no side chats.
  openChat?(
    request: ChatRequest,
    on: { event(e: ChatEvent): void; close(): void },
  ): Chat;
}
