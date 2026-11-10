// One entry of a chat, in the map's own terms: its ids and links, its kind,
// its time, the words and, for edits, the patch. The agent turns its own
// transcript into these (AgentConversation.readMore); what each kind means is
// said by the agent's reader.

export type Kind =
  | "prompt" // you typed it
  | "queued" // you typed it while Claude worked
  | "command" // a slash command (a prompt once resolved, see `isPrompt`)
  | "shell" // `!` input run in your terminal
  | "assistant"
  | "tool_result"
  | "notice" // sent in your place: task notifications, agent messages
  | "meta" // expansions and notes the app adds
  | "summary" // a compaction's summary
  | "interrupt"
  | "local" // a local command's output
  | "hook" // hook context
  | "edited" // a file changed outside Claude's tools
  | "compact" // a compaction boundary
  | "attachment"
  | "system";

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

// what a tool call changed: the file, and its patch or what was written
export interface ToolChange {
  toolUseId: string;
  entry: string;
  tool?: string;
  filePath?: string;
  structuredPatch?: Hunk[];
  originalFile?: string | null;
  // a created file has no patch: what was written is the change
  content?: string;
  bashEditDiff?: { files: { filePath: string; hunks: Hunk[] }[] };
}

export interface Entry {
  uuid: string;
  // its place among the kept entries, in file order
  seq: number;
  parent: string | null;
  logicalParent: string | null;
  type: string;
  kind: Kind;
  ts: number;
  text?: string;
  origin?: string;
  stop?: string;
  hookEvent?: string;
  filePath?: string;
  change?: ToolChange;
  // changes to the agent's own task list, in order (see tasks.ts): they say
  // what it is on with no model
  tasks?: TaskStep[];
  // what Claude asked through its question tool, and what you picked: the
  // only words of either are in the tool call and its result
  asked?: Asked[];
  picked?: Picked[];
}

export type TaskStatus = "pending" | "doing" | "done";
// One change to the agent's task list: a whole new list, the next step
// started, steps done or started by number (from 1), the whole list done, a
// task added, or an added task's status by the number it was added with.
export type TaskStep =
  | { set: { content: string; status: TaskStatus }[] }
  | { advance: true }
  | { done: number[] }
  | { start: number }
  | { finish: true }
  | { add: string }
  | { update: string; status: TaskStatus };

export interface Asked {
  question: string;
  options: string[];
  many: boolean; // you could pick more than one
}

export interface Picked {
  question: string;
  answer: string;
}

export interface Transcript {
  offset: number;
  entries: Entry[];
  byId: Map<string, Entry>;
  // tool call id → tool name, to name what a result came from
  tools: Map<string, string>;
  lines: number;
  bad: number;
  duplicates: number;
  sidechain: number;
}

export const emptyTranscript = (): Transcript => ({
  offset: 0,
  entries: [],
  byId: new Map(),
  tools: new Map(),
  lines: 0,
  bad: 0,
  duplicates: 0,
  sidechain: 0,
});
