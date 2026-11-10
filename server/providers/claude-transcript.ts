// Claude Code's transcripts (`~/.claude/projects/<project>/<session>.jsonl`)
// read into the map's entries (ledger/transcript/entry.ts). Reading is
// incremental by byte offset, in bounded chunks, whole lines only: the last
// line may still be being written. What is kept of each line: its ids and
// links, its kind, its time, the words (what you typed, Claude's text), for
// edits the patch, and Claude's task-list calls as task steps. Tool output is
// never kept.
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

import { open } from "node:fs/promises";

import {
  emptyTranscript,
  type Asked,
  type Entry,
  type Kind,
  type Picked,
  type TaskStatus,
  type TaskStep,
  type ToolChange,
  type Transcript,
} from "../../ledger/transcript/entry.ts";

// a transcript line: untrusted JSON, read field by field
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any;

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
const PLAN_TOOL =
  /(?:^|__)(?:update_plan|wrap_up)$|^TodoWrite$|^Task(?:Create|Update)$/;

// Claude Code's question tool: the questions are in its input, and your
// picks in its result's `toolUseResult.answers`, keyed by question
const ASK_TOOL = /^AskUserQuestion$/;

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
        if (PLAN_TOOL.test(name)) {
          const steps = taskSteps(name, b.input);
          if (steps.length) (e.tasks ??= []).push(...steps);
        }
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

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === "object" ? (x as Obj) : {});
const statusOf = (s: unknown): TaskStatus =>
  s === "in_progress" ? "doing" : s === "completed" ? "done" : "pending";

// One call to a task-list tool as the map's task steps: the desktop app's
// update_plan (a list, then advance, done and start) and its wrap_up
// (everything done), TodoWrite (a whole list, in its in-progress wording),
// and the Task tools (numbered in the order tasks were made).
export function taskSteps(name: string, input: unknown): TaskStep[] {
  const i = obj(input);
  const tool = name.replace(/^.*__/, "");
  const steps: TaskStep[] = [];
  if (tool === "update_plan") {
    if (Array.isArray(i.items))
      steps.push({
        set: i.items.map((x) => ({
          content: String(obj(x).content ?? ""),
          status: statusOf(obj(x).status),
        })),
      });
    if (i.advance === true) steps.push({ advance: true });
    if (Array.isArray(i.done))
      steps.push({ done: i.done.filter((n) => typeof n === "number") });
    if (typeof i.start === "number") steps.push({ start: i.start });
  } else if (tool === "wrap_up") steps.push({ finish: true });
  else if (tool === "TodoWrite" && Array.isArray(i.todos))
    steps.push({
      set: i.todos.map((t) => ({
        content: String(obj(t).activeForm ?? obj(t).content ?? ""),
        status: statusOf(obj(t).status),
      })),
    });
  else if (tool === "TaskCreate")
    steps.push({ add: String(i.subject ?? i.description ?? "") });
  else if (tool === "TaskUpdate" && typeof i.status === "string")
    steps.push({ update: String(i.taskId ?? ""), status: statusOf(i.status) });
  return steps;
}

const CHUNK = 1 << 20;

// Reads what was appended since `t.offset`, a chunk at a time; a line longer
// than a chunk is gathered across chunks. A file shorter than what was read
// was replaced: it is read again from the start.
export async function readMore(
  t: Transcript,
  path: string,
  chunk = CHUNK,
): Promise<{ added: number; reset: boolean }> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    let reset = false;
    if (size < t.offset) {
      Object.assign(t, emptyTranscript());
      reset = true;
    }
    const before = t.entries.length;
    const buf = Buffer.alloc(chunk);
    let carry: Buffer = Buffer.alloc(0);
    let pos = t.offset;
    while (pos < size) {
      const { bytesRead } = await fh.read(buf, 0, chunk, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const data = carry.length
        ? Buffer.concat([carry, buf.subarray(0, bytesRead)])
        : buf.subarray(0, bytesRead);
      const end = data.lastIndexOf(10);
      if (end < 0) {
        carry = Buffer.from(data);
        continue;
      }
      ingest(t, data.subarray(0, end + 1).toString("utf8"));
      t.offset += end + 1;
      carry = Buffer.from(data.subarray(end + 1));
    }
    return { added: t.entries.length - before, reset };
  } finally {
    await fh.close();
  }
}

// Whole lines in; each uuid is kept once (the first copy wins: resumed and
// compacted chats write earlier entries again).
export function ingest(t: Transcript, text: string): void {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    t.lines++;
    let d: Raw;
    try {
      d = JSON.parse(line);
    } catch {
      t.bad++;
      continue;
    }
    if (!d || typeof d !== "object" || typeof d.uuid !== "string") continue;
    if (t.byId.has(d.uuid)) {
      t.duplicates++;
      continue;
    }
    if (d.isSidechain === true) {
      t.sidechain++;
      continue;
    }
    const e = toEntry(d, t.tools, t.entries.length);
    t.byId.set(e.uuid, e);
    t.entries.push(e);
  }
}
