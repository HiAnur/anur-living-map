// Meetings the recorder sends: each is a file of what was said (file.ts)
// in <home>/meetings/<conv>/, followed by the ledger like a chat from the moment
// it starts, so the map grows while people talk.
//
// - start: a new file and a followed conversation `meeting-<time>-<random>`.
// - append: finished segments, as the recorder hears them. When nobody has
//   spoken for PAUSE_MS a pause line is written, which lets the turn seal.
// - end: recording stopped; the last turn seals.
// - importText: a whole transcript pasted after the meeting (one from a
//   notes app), filed the same way in larger turns.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Conversation } from "../../server/providers/types.ts";
import { MEETING_PREFIX } from "../../shared/ledger.ts";
import type { Line, Speaker } from "./file.ts";

export const PAUSE_MS = 12_000;
const MAX_SEGMENTS = 500;
const MAX_TEXT = 4000;
const MAX_IMPORT = 1_000_000;
export const MEETING_RE = /^meeting-[\w-]{1,80}$/;

export type Segment = {
  text: string;
  speaker: Speaker;
  name?: string;
  start: number;
  end: number;
};

export type Started = { conv: string; title: string };

export type Meetings = {
  dir: string;
  start(o: { title?: unknown; app?: unknown }): Started;
  append(conv: string, segments: unknown): { count?: number; error?: string };
  end(conv: string): { error?: string };
  importText(o: {
    title?: unknown;
    text?: unknown;
    me?: unknown;
  }): Started & { error?: string };
  // a meeting this server keeps, by its id
  has(conv: string): boolean;
  close(): void;
};

const str = (v: unknown, n: number) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

export function createMeetings(o: {
  home: string;
  follow: (c: Conversation) => string;
  now?: () => number;
  pauseMs?: number;
}): Meetings {
  const now = o.now ?? Date.now;
  const pauseMs = o.pauseMs ?? PAUSE_MS;
  const dir = path.join(o.home, "meetings");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // a folder per meeting: a side chat reads its meeting's folder, and no other
  const folderOf = (conv: string) => path.join(dir, conv);
  const fileOf = (conv: string) =>
    path.join(folderOf(conv), "transcript.meeting.jsonl");
  // per meeting: the pause timer, and what its file ends with
  const live = new Map<
    string,
    { timer?: ReturnType<typeof setTimeout>; last: Line["type"] }
  >();

  const write = (conv: string, lines: Line[]) => {
    if (!lines.length) return;
    fs.appendFileSync(
      fileOf(conv),
      lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
    );
    const m = live.get(conv) ?? { last: "meeting" };
    m.last = lines.at(-1)!.type;
    live.set(conv, m);
  };

  const has = (conv: string) =>
    MEETING_RE.test(conv) && fs.existsSync(fileOf(conv));

  const create = (title: string, imported: boolean): Started => {
    const t = now();
    const stamp = new Date(t).toISOString().replace(/\D/g, "").slice(0, 14);
    const conv = `${MEETING_PREFIX}${stamp}-${crypto.randomBytes(3).toString("hex")}`;
    fs.mkdirSync(folderOf(conv), { mode: 0o700 });
    fs.writeFileSync(fileOf(conv), "", { mode: 0o600 });
    write(conv, [{ type: "meeting", id: conv, title, ts: t, imported }]);
    o.follow({ id: conv, cwd: folderOf(conv), title, file: fileOf(conv) });
    return { conv, title };
  };

  const titleOf = (asked: unknown, app: unknown, t: number) => {
    const given = str(asked, 120);
    if (given) return given;
    const when = new Date(t).toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const where = str(app, 40);
    return `Meeting${where ? ` on ${where}` : ""}, ${when}`;
  };

  const schedulePause = (conv: string) => {
    const m = live.get(conv);
    if (!m) return;
    if (m.timer) clearTimeout(m.timer);
    m.timer = setTimeout(() => {
      m.timer = undefined;
      if (m.last === "segment") write(conv, [{ type: "pause", ts: now() }]);
    }, pauseMs);
    m.timer.unref?.();
  };

  return {
    dir,
    has,
    start({ title, app }) {
      return create(titleOf(title, app, now()), false);
    },
    append(conv, segments) {
      if (!has(conv)) return { error: "No meeting with that id." };
      if (live.get(conv)?.last === "end")
        return { error: "That meeting has ended." };
      if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS)
        return {
          error: `Send "segments" as a list of at most ${MAX_SEGMENTS}.`,
        };
      const t = now();
      const lines: Line[] = [];
      for (const raw of segments as Record<string, unknown>[]) {
        if (!raw || typeof raw !== "object") continue;
        const text = str(raw.text, MAX_TEXT);
        if (!text) continue;
        const start = num(raw.start) || t;
        lines.push({
          type: "segment",
          speaker: raw.speaker === "you" ? "you" : "others",
          text,
          start,
          end: Math.max(start, num(raw.end) || start),
        });
      }
      write(conv, lines);
      if (lines.length) schedulePause(conv);
      return { count: lines.length };
    },
    end(conv) {
      if (!has(conv)) return { error: "No meeting with that id." };
      const m = live.get(conv);
      if (m?.timer) clearTimeout(m.timer);
      if (m?.last !== "end") write(conv, [{ type: "end", ts: now() }]);
      return {};
    },
    importText({ title, text, me }) {
      const body = typeof text === "string" ? text.slice(0, MAX_IMPORT) : "";
      const said = parseTranscript(body, str(me, 60));
      if (!said.length)
        return { conv: "", title: "", error: "The transcript has no words." };
      const started = create(
        str(title, 120) ||
          `Imported meeting, ${new Date(now()).toDateString()}`,
        true,
      );
      write(started.conv, [
        ...said.map((s): Line => ({ type: "segment", ...s, start: 0, end: 0 })),
        { type: "end", ts: now() },
      ]);
      return started;
    },
    close() {
      for (const m of live.values()) if (m.timer) clearTimeout(m.timer);
    },
  };
}

// Leading times as notes apps write them: [00:01:02], (1:02), 00:01 -
const TIME =
  /^\s*(?:[[(]?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?[\])]?\s*[-–]?\s*)+/;
// "Priya:", "Speaker 2:", "Priya Shah (00:12):"
const NAMED =
  /^([A-Z][\p{L}\d .'’-]{0,40}?)(?:\s*[([]\d{1,2}:\d{2}(?::\d{2})?[\])])?\s*:\s+(.+)$/u;

const ALONE =
  /^([A-Z][\p{L}\d .'’-]{0,40}?)\s*(?::|\s\d{1,2}:\d{2}(?::\d{2})?)\s*$/u;

// A pasted transcript as segments: one per line or paragraph, with the
// speaker's name when the line starts with one. Lines by `me` are yours.
export function parseTranscript(
  text: string,
  me = "",
): { speaker: Speaker; name?: string; text: string }[] {
  const out: { speaker: Speaker; name?: string; text: string }[] = [];
  const mine = me.toLowerCase();
  let name: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(TIME, "").trim();
    if (!line) continue;
    const m = NAMED.exec(line);
    // a name alone on its line ("Priya:", "Priya Shah  0:02") names who
    // speaks in the lines under it
    const alone = ALONE.exec(line);
    if (alone && line.split(/\s+/).length <= 5) {
      name = alone[1]!.trim();
      continue;
    }
    const who = m ? m[1]!.trim() : name;
    const words = m ? m[2]!.trim() : line;
    const you =
      !!who && (who.toLowerCase() === mine || /^(you|me)$/i.test(who));
    out.push(
      you
        ? { speaker: "you", text: words }
        : { speaker: "others", ...(who ? { name: who } : {}), text: words },
    );
  }
  return out;
}
