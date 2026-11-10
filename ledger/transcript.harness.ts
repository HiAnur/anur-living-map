// What the transcript's tests share: lines in the shapes Claude Code
// writes, read into a transcript, and temp files cleaned up after each test.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

import { ingest } from "../server/providers/claude-transcript.ts";
import { emptyTranscript, view, type Transcript } from "./transcript.ts";
// ---- fixtures in the observed shapes -------------------------------------------

export let clock = Date.parse("2026-01-01T00:00:00Z");
export const at = () => new Date((clock += 1000)).toISOString();
export const base = (
  type: string,
  uuid: string,
  parentUuid: string | null,
) => ({
  parentUuid,
  isSidechain: false,
  type,
  uuid,
  timestamp: at(),
  sessionId: "s1",
  version: "2.1.300",
});

export const user = (
  uuid: string,
  parent: string | null,
  content: unknown,
  extra: object = {},
) => ({
  ...base("user", uuid, parent),
  message: { role: "user", content },
  ...extra,
});
export const typed = (uuid: string, parent: string | null, text: string) =>
  user(uuid, parent, text, { origin: { kind: "human" }, promptSource: "sdk" });
export const claude = (
  uuid: string,
  parent: string | null,
  text: string,
  stop = "end_turn",
) => ({
  ...base("assistant", uuid, parent),
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: stop,
  },
});
export const call = (
  uuid: string,
  parent: string,
  id: string,
  name: string,
) => ({
  ...base("assistant", uuid, parent),
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input: {} }],
    stop_reason: "tool_use",
  },
});
export const result = (
  uuid: string,
  parent: string,
  id: string,
  toolUseResult: unknown,
) =>
  user(
    uuid,
    parent,
    [{ tool_use_id: id, type: "tool_result", content: "TOOL OUTPUT TEXT" }],
    { toolUseResult, sourceToolAssistantUUID: parent },
  );
export const attachment = (uuid: string, parent: string, a: object) => ({
  ...base("attachment", uuid, parent),
  attachment: a,
});
export const compact = (uuid: string, logical: string) => ({
  ...base("system", uuid, null),
  logicalParentUuid: logical,
  subtype: "compact_boundary",
  content: "Conversation compacted",
  compactMetadata: { trigger: "auto", preTokens: 900000 },
});
export const summary = (uuid: string, parent: string) =>
  user(uuid, parent, "This session is being continued from a previous …", {
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
  });
export const stopHook = (uuid: string, parent: string) => ({
  ...base("system", uuid, parent),
  subtype: "stop_hook_summary",
  hookCount: 1,
});

export const jsonl = (rows: object[]) =>
  rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
export const read = (rows: object[] | string) => {
  const t = emptyTranscript();
  ingest(t, typeof rows === "string" ? rows : jsonl(rows));
  return t;
};
export const prompts = (t: Transcript) =>
  view(t, 0).turns.map((tn) => `${tn.via}:${tn.text}`);

// ---- files ------------------------------------------------------------------------

export const dirs: string[] = [];
export const tmpFile = (text = "") => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-"));
  dirs.push(dir);
  const f = path.join(dir, "s1.jsonl");
  fs.writeFileSync(f, text);
  return f;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true });
});
