// A Claude Code transcript (`~/.claude/projects/<project>/<session>.jsonl`)
// read into entries, the active path and turns. Reading is incremental by
// byte offset, in bounded chunks, whole lines only: the last line may still
// be being written. Everything after reading is a pure function of what was
// read, so a replay from the same bytes gives the same turns.
//
// What is kept of each entry: its ids and links, its kind, its time, the
// words (what you typed, Claude's text) and, for edits, the patch. Tool
// output is never kept.
//
// How a line becomes an entry is in transcript/entry.ts; how entries become
// turns, in transcript/turns.ts.

import { open } from "node:fs/promises";

import {
  emptyTranscript,
  toEntry,
  type Raw,
  type Transcript,
} from "./transcript/entry.ts";

export {
  ASK_TOOL,
  emptyTranscript,
  PLAN_TOOL,
  toEntry,
  type Asked,
  type Entry,
  type Hunk,
  type Kind,
  type Picked,
  type ToolChange,
  type Transcript,
} from "./transcript/entry.ts";
export {
  above,
  activePath,
  branches,
  buildTurns,
  isPrompt,
  lastSpoken,
  SEAL_IDLE_MS,
  sealedCount,
  view,
  type Turn,
  type View,
} from "./transcript/turns.ts";

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
