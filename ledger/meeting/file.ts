// A meeting as the map follows it: a file of what was said, one JSON line
// each, written by the server as the recorder sends it (meetings.ts), and
// read here into the map's own entries, so a meeting is followed and filed
// like any chat.
//
//   {"type":"meeting","id":"meeting-…","title":"…","ts":…,"imported":false}
//   {"type":"segment","speaker":"you"|"others","text":"…","start":…,"end":…}
//   {"type":"pause","ts":…}   nobody spoke for a while: what came before is filed
//   {"type":"end","ts":…}     recording stopped
//
// Speech has no prompts, so the reader makes its own turns: a turn starts
// with the first words after a pause, and a new one once a turn has run for
// CHUNK_MS or CHUNK_WORDS. A pause or the end closes the turn, which then
// seals like a finished reply (SEAL_IDLE_MS), so the map catches up within
// about a minute of talk.

import { open } from "node:fs/promises";

import { isMeetingConv } from "../../shared/ledger.ts";
import { emptyTranscript, type Entry, type Transcript } from "../transcript.ts";

export const isMeeting = isMeetingConv;
export const isMeetingFile = (file: string) => file.endsWith(".meeting.jsonl");

// a turn of live talk: about a minute, or a long monologue's worth of words
export const CHUNK_MS = 60_000;
export const CHUNK_WORDS = 220;
// a transcript pasted after the meeting has no times: larger turns, so a long
// meeting is filed in a few calls
export const IMPORT_CHUNK_WORDS = 600;

export type Speaker = "you" | "others";
export type Line =
  | {
      type: "meeting";
      id: string;
      title: string;
      ts: number;
      imported?: boolean;
    }
  | {
      type: "segment";
      speaker: Speaker;
      // who spoke, when the transcript names them (one pasted after the
      // meeting); live audio only knows your microphone from the call
      name?: string;
      text: string;
      start: number;
      end: number;
    }
  | { type: "pause"; ts: number }
  | { type: "end"; ts: number };

const SPEAKER: Record<Speaker, string> = { you: "You", others: "Others" };
export const said = (speaker: Speaker, text: string, name?: string) =>
  `${speaker !== "you" && name ? name : (SPEAKER[speaker] ?? "Others")}: ${text}`;

const words = (s: string | undefined) =>
  s ? s.split(/\s+/).filter(Boolean).length : 0;

// The open turn: from its first words to the newest entry, unless a pause
// or the end closed it.
function openTurn(t: Transcript): { start: Entry; words: number } | null {
  let n = 0;
  for (let i = t.entries.length - 1; i >= 0; i--) {
    const e = t.entries[i]!;
    if (e.stop === "end_turn") return null;
    n += words(e.text?.replace(/^[^:\n]{1,40}: /, ""));
    if (e.kind === "prompt") return { start: e, words: n };
  }
  return null;
}

const imported = (t: Transcript) => t.entries[0]?.origin === "imported";

function add(
  t: Transcript,
  e: Omit<Entry, "seq" | "parent" | "logicalParent">,
) {
  const prev = t.entries.at(-1);
  const entry: Entry = {
    ...e,
    seq: t.entries.length,
    parent: prev?.uuid ?? null,
    logicalParent: null,
  };
  t.entries.push(entry);
  t.byId.set(entry.uuid, entry);
}

// One line in: a segment starts a turn or goes on with the open one.
export function ingestLine(t: Transcript, d: Line): void {
  const uuid = `l${t.lines}`;
  if (d.type === "meeting") {
    add(t, {
      uuid,
      type: "meeting",
      kind: "meta",
      ts: d.ts,
      text: d.title,
      origin: d.imported ? "imported" : "live",
    });
    return;
  }
  if (d.type === "pause" || d.type === "end") {
    const last = t.entries.at(-1);
    // nothing to close: two pauses in a row, or a pause before any words
    if (!last || last.stop === "end_turn" || last.kind === "meta") return;
    add(t, {
      uuid,
      type: d.type,
      kind: "assistant",
      ts: d.ts,
      stop: "end_turn",
    });
    return;
  }
  if (d.type !== "segment" || typeof d.text !== "string" || !d.text.trim())
    return;
  const text = said(
    d.speaker,
    d.text.trim(),
    typeof d.name === "string" ? d.name.slice(0, 40) : undefined,
  );
  const cur = openTurn(t);
  const big = imported(t) ? IMPORT_CHUNK_WORDS : CHUNK_WORDS;
  const long =
    !!cur &&
    (cur.words >= big ||
      (!!d.start && !!cur.start.ts && d.start - cur.start.ts >= CHUNK_MS));
  add(t, {
    uuid,
    type: "segment",
    kind: !cur || long ? "prompt" : "assistant",
    ts: d.start || d.end || 0,
    text,
    origin: d.speaker,
  });
}

export function ingest(t: Transcript, text: string): void {
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    t.lines++;
    let d: Line;
    try {
      d = JSON.parse(raw) as Line;
    } catch {
      t.bad++;
      continue;
    }
    if (d && typeof d === "object") ingestLine(t, d);
    else t.bad++;
  }
}

// What the meeting's file gained since `t.offset` (ReadMore): only whole
// lines; a file shorter than what was read is read again from the start.
export async function readMeeting(
  t: Transcript,
  file: string,
): Promise<{ added: number; reset: boolean }> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    let reset = false;
    if (size < t.offset) {
      Object.assign(t, emptyTranscript());
      reset = true;
    }
    const before = t.entries.length;
    if (size > t.offset) {
      const buf = Buffer.alloc(size - t.offset);
      const { bytesRead } = await fh.read(buf, 0, buf.length, t.offset);
      const end = buf.subarray(0, bytesRead).lastIndexOf(10);
      if (end >= 0) {
        ingest(t, buf.subarray(0, end + 1).toString("utf8"));
        t.offset += end + 1;
      }
    }
    return { added: t.entries.length - before, reset };
  } finally {
    await fh.close();
  }
}
