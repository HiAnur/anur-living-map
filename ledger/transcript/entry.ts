// One line of a transcript as an entry: its ids and links, its kind, its
// time, the words and, for edits, the patch.
//
// How a line becomes a prompt:
// - typed: a user entry with your text. Tool results, compaction summaries,
//   `isMeta` entries (skill expansions, image notes), interruptions, local
//   command output and anything the app sent in your place (task
//   notifications, agent messages: `origin.kind` other than "human") are not.
// - queued: what you typed while Claude worked arrives as an `attachment`
//   of type `queued_command`. It counts when `commandMode` is "prompt" and
//   its origin is you; task notifications ("task-notification") and agent
//   messages (`origin.kind` "peer", marked `isMeta`) do not.
// - command: a slash command counts when Claude is asked to act on it: a
//   skill or custom command, marked as yours or followed by its expansion.
//   A built-in that runs locally (/model, /compact) is followed by its own
//   output and is not a prompt.
// - `!` shell input runs in your terminal, not as a request: kept, not a prompt.
// - Hook context is its own `hook_additional_context` attachment line:
//   flagged on its turn, never a prompt.

// a transcript line: untrusted JSON, read field by field
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any;

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

// what a tool call changed, from the entry's top-level `toolUseResult`
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
  // calls to Claude's own task list, in order (see tasks.ts): kept whole,
  // as they are small and say what Claude is on with no model
  plan?: { tool: string; input: unknown }[];
  // what Claude asked through its question tool, and what you picked: the
  // only words of either are in the tool call and its result
  asked?: Asked[];
  picked?: Picked[];
}

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
  // tool_use id → tool name, to name what a result came from
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

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const blocks = (content: unknown): Raw[] =>
  Array.isArray(content)
    ? content.filter((b) => b && typeof b === "object")
    : [];

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : blocks(content)
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n");

const NOTICE =
  /^\s*(<task-notification[\s>]|<agent-message[\s>]|<[a-z-]+-event[\s>]|Another Claude session sent a message)/;
const LOCAL = /^\s*<(local-command-[a-z]+|bash-stdout|bash-stderr)>/;
const INTERRUPT = /^\[Request interrupted by user/;

const clean = (s: string) =>
  s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const tag = (s: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s)?.[1]?.trim() ?? "";

// what you wrote, and what kind of user line it is
function userKind(d: Raw): { kind: Kind; text?: string } {
  const content = d.message?.content;
  if (d.isCompactSummary === true) return { kind: "summary" };
  if (blocks(content).some((b) => b.type === "tool_result"))
    return { kind: "tool_result" };
  const origin = str(d.origin?.kind);
  if (origin && origin !== "human") return { kind: "notice" };
  if (d.isMeta === true) return { kind: "meta" };
  const t = clean(textOf(content));
  if (!t) return { kind: "meta" };
  if (INTERRUPT.test(t)) return { kind: "interrupt" };
  if (NOTICE.test(t)) return { kind: "notice" };
  if (t.includes("<bash-input>"))
    return { kind: "shell", text: tag(t, "bash-input") };
  if (LOCAL.test(t)) return { kind: "local" };
  if (t.includes("<command-name>")) {
    const text = `${tag(t, "command-name")} ${tag(t, "command-args")}`;
    return { kind: "command", text: text.trim() };
  }
  return { kind: "prompt", text: t };
}

function queued(a: Raw): { kind: Kind; text?: string } {
  const prompt = a.prompt;
  const text = clean(typeof prompt === "string" ? prompt : textOf(prompt));
  const origin = str(a.origin?.kind);
  const yours =
    a.commandMode === "prompt" &&
    a.isMeta !== true &&
    (origin ? origin === "human" : !NOTICE.test(text));
  return yours && text ? { kind: "queued", text } : { kind: "notice" };
}

function toolChange(d: Raw, entry: string, tools: Map<string, string>) {
  const r = d.toolUseResult;
  if (!r || typeof r !== "object" || Array.isArray(r)) return undefined;
  const patch = Array.isArray(r.structuredPatch);
  const bash = r.bashEditDiff && typeof r.bashEditDiff === "object";
  if (!patch && !bash) return undefined;
  const id = str(
    blocks(d.message?.content).find((b) => b.type === "tool_result")
      ?.tool_use_id,
  );
  if (!id) return undefined;
  const c: ToolChange = { toolUseId: id, entry };
  const tool = tools.get(id);
  if (tool) c.tool = tool;
  if (typeof r.filePath === "string") c.filePath = r.filePath;
  if (patch) c.structuredPatch = r.structuredPatch;
  if (typeof r.originalFile === "string" || r.originalFile === null)
    c.originalFile = r.originalFile;
  if (r.type === "create" && typeof r.content === "string")
    c.content = r.content;
  if (bash) c.bashEditDiff = r.bashEditDiff;
  return c;
}

// the tools that hold Claude's task list: the desktop app's plan (and its
// wrap-up, which ticks it off), TodoWrite, and the Task tools
export const PLAN_TOOL =
  /(?:^|__)(?:update_plan|wrap_up)$|^TodoWrite$|^Task(?:Create|Update)$/;

// Claude Code's question tool: the questions are in its input, and your
// picks in its result's `toolUseResult.answers`, keyed by question
export const ASK_TOOL = /^AskUserQuestion$/;

function askedOf(input: unknown): Asked[] {
  const qs = (input as { questions?: unknown })?.questions;
  if (!Array.isArray(qs)) return [];
  return qs.flatMap((q: Raw): Asked[] => {
    const question = str(q?.question)?.trim();
    if (!question) return [];
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o: Raw) => str(o?.label)?.trim())
      .filter((l: string | undefined): l is string => !!l);
    return [{ question, options, many: q.multiSelect === true }];
  });
}

// the picks a question tool's result carries; none when you answered by
// typing instead (the result is an error, and your words are a prompt)
function pickedOf(d: Raw, tools: Map<string, string>): Picked[] {
  const asked = blocks(d.message?.content).some(
    (b) =>
      b.type === "tool_result" &&
      b.is_error !== true &&
      ASK_TOOL.test(tools.get(str(b.tool_use_id) ?? "") ?? ""),
  );
  const answers = d.toolUseResult?.answers;
  if (!asked || !answers || typeof answers !== "object") return [];
  return Object.entries(answers as Record<string, unknown>).flatMap(
    ([question, a]): Picked[] => {
      const answer = Array.isArray(a)
        ? a.filter((x) => typeof x === "string").join(", ")
        : typeof a === "string"
          ? a
          : "";
      return question.trim() && answer.trim()
        ? [{ question: question.trim(), answer: answer.trim() }]
        : [];
    },
  );
}

export function toEntry(
  d: Raw,
  tools = new Map<string, string>(),
  seq = 0,
): Entry {
  const e: Entry = {
    uuid: d.uuid,
    seq,
    parent: str(d.parentUuid) ?? null,
    logicalParent: str(d.logicalParentUuid) ?? null,
    type: str(d.type) ?? "",
    kind: "system",
    ts: Date.parse(str(d.timestamp) ?? "") || 0,
  };
  const origin = str(d.origin?.kind);
  if (origin) e.origin = origin;
  if (e.type === "user") {
    const { kind, text } = userKind(d);
    e.kind = kind;
    if (text) e.text = text;
    const change = toolChange(d, e.uuid, tools);
    if (change) e.change = change;
    const picked = pickedOf(d, tools);
    if (picked.length) e.picked = picked;
  } else if (e.type === "assistant") {
    e.kind = "assistant";
    const content = d.message?.content;
    for (const b of blocks(content))
      if (b.type === "tool_use" && typeof b.id === "string") {
        const name = str(b.name) ?? "";
        tools.set(b.id, name);
        if (PLAN_TOOL.test(name))
          (e.plan ??= []).push({ tool: name, input: b.input });
        if (ASK_TOOL.test(name)) {
          const asked = askedOf(b.input);
          if (asked.length) (e.asked ??= []).push(...asked);
        }
      }
    const text = textOf(content).trim();
    if (text) e.text = text;
    const stop = str(d.message?.stop_reason);
    if (stop) e.stop = stop;
  } else if (e.type === "attachment") {
    const a = d.attachment ?? {};
    const type = str(a.type);
    if (type === "queued_command") {
      const q = queued(a);
      e.kind = q.kind;
      if (q.text) e.text = q.text;
      const o = str(a.origin?.kind);
      if (o) e.origin = o;
    } else if (type === "hook_additional_context") {
      e.kind = "hook";
      const event = str(a.hookEvent);
      if (event) e.hookEvent = event;
      const c = a.content;
      const text = Array.isArray(c)
        ? c.filter((x) => typeof x === "string").join("\n")
        : str(c);
      if (text) e.text = text;
    } else if (type === "edited_text_file") {
      e.kind = "edited";
      const f = str(a.filename);
      if (f) e.filePath = f;
    } else e.kind = "attachment";
  } else if (e.type === "system" && d.subtype === "compact_boundary") {
    e.kind = "compact";
  }
  return e;
}
