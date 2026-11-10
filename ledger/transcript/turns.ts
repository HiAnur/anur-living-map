// The entries read so far as a conversation: the active path from the
// newest entry back to the root, what hangs off it, and the turns it makes,
// each a prompt of yours and all that followed it.

import type { Entry, Kind, ToolChange, Transcript } from "./entry.ts";

// a turn the file says Claude finished is sealed once nothing has been
// written for this long (the next prompt seals it at once)
export const SEAL_IDLE_MS = 2000;

export interface Turn {
  n: number;
  prompt: string;
  via: "typed" | "queued" | "command";
  text: string;
  ts: number;
  end: number;
  reply: string;
  // questions Claude asked through its question tool and your picks, one
  // line each, in order (Claude's text never has them)
  asked?: string[];
  entries: string[];
  changes: ToolChange[];
  hooks: string[];
}

export interface View {
  path: Entry[];
  abandoned: Entry[];
  turns: Turn[];
  // changes before the first prompt belong to turn 0
  changes: (ToolChange & { turn: number })[];
  sealed: number;
  compactions: number;
}

// The entry an entry follows. A compaction boundary has no parent but names
// the entry it continues (`logicalParentUuid`): a compaction is not a new
// root. A link to an entry the file never wrote (an auto-compaction names
// the message it interrupted) continues from the entry written just before.
export function above(t: Transcript, e: Entry): Entry | undefined {
  const up = e.parent ?? e.logicalParent;
  if (!up) return undefined;
  return t.byId.get(up) ?? (e.seq > 0 ? t.entries[e.seq - 1] : undefined);
}

// From the newest entry back to the root.
export function activePath(t: Transcript): Entry[] {
  const path: Entry[] = [];
  const on = new Set<string>();
  let e: Entry | undefined = t.entries[t.entries.length - 1];
  while (e && !on.has(e.uuid)) {
    path.push(e);
    on.add(e.uuid);
    e = above(t, e);
  }
  return path.reverse();
}

// A slash command is a prompt when it is yours, or when what follows it on
// the path is not a local command's output. One just typed (nothing after it
// yet) waits for the next line to tell.
export function isPrompt(path: Entry[], i: number): boolean {
  const e = path[i];
  if (e.kind === "prompt" || e.kind === "queued") return true;
  if (e.kind !== "command") return false;
  if (e.origin === "human") return true;
  const next = path[i + 1];
  return !!next && next.kind !== "local";
}

const ASKS: Kind[] = ["prompt", "queued", "command"];

// Entries off the path, by the path entry they hang from. Claude Code links
// each result of parallel tool calls to the block that made the call, so a
// branch without a prompt is a side branch of one step: it stays in its
// turn. A branch holding a prompt was left by a rewind (or by a second
// writer), and so is a branch that never reaches the path.
export function branches(
  t: Transcript,
  path: Entry[],
): { side: Map<string, Entry[]>; abandoned: Entry[] } {
  const on = new Set(path.map((e) => e.uuid));
  const top = new Map<string, string>();
  const hang = new Map<string, string | null>();
  const groups = new Map<string, Entry[]>();
  for (const e of t.entries) {
    if (on.has(e.uuid) || top.has(e.uuid)) continue;
    const chain: Entry[] = [];
    const seen = new Set<string>();
    let cur: Entry | undefined = e;
    while (
      cur &&
      !on.has(cur.uuid) &&
      !top.has(cur.uuid) &&
      !seen.has(cur.uuid)
    ) {
      chain.push(cur);
      seen.add(cur.uuid);
      cur = above(t, cur);
    }
    let head: string;
    if (cur && top.has(cur.uuid)) head = top.get(cur.uuid)!;
    else {
      head = chain[chain.length - 1].uuid;
      hang.set(head, cur && on.has(cur.uuid) ? cur.uuid : null);
    }
    for (const c of chain) top.set(c.uuid, head);
  }
  for (const e of t.entries) {
    const head = top.get(e.uuid);
    if (!head) continue;
    const g = groups.get(head) ?? [];
    g.push(e);
    groups.set(head, g);
  }
  const side = new Map<string, Entry[]>();
  const abandoned: Entry[] = [];
  for (const [head, g] of groups) {
    const at = hang.get(head);
    if (!at || g.some((e) => ASKS.includes(e.kind))) abandoned.push(...g);
    else side.set(at, [...(side.get(at) ?? []), ...g]);
  }
  abandoned.sort((a, b) => a.seq - b.seq);
  return { side, abandoned };
}

export function buildTurns(
  path: Entry[],
  side: Map<string, Entry[]> = new Map(),
): { turns: Turn[]; before: ToolChange[] } {
  const turns: Turn[] = [];
  const before: Entry[] = [];
  let cur: Turn | undefined;
  const add = (tn: Turn, e: Entry) => {
    tn.entries.push(e.uuid);
    if (e.ts) tn.end = Math.max(tn.end, e.ts);
    if (e.kind === "assistant" && e.text)
      tn.reply = tn.reply ? `${tn.reply}\n\n${e.text}` : e.text;
    for (const q of e.asked ?? [])
      (tn.asked ??= []).push(
        `Claude asked: ${q.question}` +
          (q.options.length
            ? ` Options${q.many ? " (any number)" : ""}: ${q.options.join(" · ")}`
            : ""),
      );
    for (const p of e.picked ?? [])
      (tn.asked ??= []).push(`You picked, for "${p.question}": ${p.answer}`);
    if (e.kind === "hook") tn.hooks.push(e.uuid);
  };
  const changes = new Map<Turn | undefined, Entry[]>();
  const changed = (tn: Turn | undefined, e: Entry) => {
    if (e.change) changes.set(tn, [...(changes.get(tn) ?? []), e]);
  };
  path.forEach((e, i) => {
    if (isPrompt(path, i)) {
      cur = {
        n: turns.length + 1,
        prompt: e.uuid,
        via:
          e.kind === "queued"
            ? "queued"
            : e.kind === "command"
              ? "command"
              : "typed",
        text: e.text ?? "",
        ts: e.ts,
        end: e.ts,
        reply: "",
        entries: [e.uuid],
        changes: [],
        hooks: [],
      };
      turns.push(cur);
    } else if (cur) add(cur, e);
    else before.push(e);
    changed(cur, e);
    for (const s of side.get(e.uuid) ?? []) {
      if (cur) add(cur, s);
      changed(cur, s);
    }
  });
  // in the order they were written: a file's patches apply one after another
  const ordered = (es: Entry[] = []) =>
    es.sort((a, b) => a.seq - b.seq).map((e) => e.change!);
  for (const tn of turns) tn.changes = ordered(changes.get(tn));
  return { turns, before: ordered(changes.get(undefined)) };
}

// what says where the conversation is, not the bookkeeping written around
// it (hook summaries, attachments, a local command's output)
const SPOKEN: Kind[] = [
  "assistant",
  "tool_result",
  "notice",
  "interrupt",
  ...ASKS,
];

export function lastSpoken(path: Entry[]): Entry | undefined {
  for (let i = path.length - 1; i >= 0; i--)
    if (SPOKEN.includes(path[i].kind)) return path[i];
  return undefined;
}

// How many turns are sealed: every turn with a later prompt, and the last
// one too once it is over (Claude ended it, or you interrupted it) and the
// file has been quiet for `SEAL_IDLE_MS`.
export function sealedCount(
  turns: Turn[],
  last: Entry | undefined,
  idleMs: number,
): number {
  if (!turns.length) return 0;
  const over =
    (last?.kind === "assistant" && last.stop === "end_turn") ||
    last?.kind === "interrupt";
  return over && idleMs >= SEAL_IDLE_MS ? turns.length : turns.length - 1;
}

export function view(t: Transcript, idleMs: number): View {
  const path = activePath(t);
  const { side, abandoned } = branches(t, path);
  const { turns, before } = buildTurns(path, side);
  return {
    path,
    abandoned,
    turns,
    changes: [
      ...before.map((c) => ({ ...c, turn: 0 })),
      ...turns.flatMap((tn) => tn.changes.map((c) => ({ ...c, turn: tn.n }))),
    ],
    sealed: sealedCount(turns, lastSpoken(path), idleMs),
    compactions: t.entries.filter((e) => e.kind === "compact").length,
  };
}
