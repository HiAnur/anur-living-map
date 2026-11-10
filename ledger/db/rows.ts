// The store's rows as the rest of the app sees them, and how a stored value
// is read back: every column is checked for its type, and JSON that does
// not parse gives the fallback, so a damaged row never throws.

import type { SQLInputValue } from "node:sqlite";

import type { Store, Writer } from "../items.ts";

// one of your chats as the store keeps it, under the first id it had
export type Conv = {
  root: string;
  ids: string[]; // every id it went by, the root first
  title: string;
  cwd: string;
  file: string; // the transcript followed now
  lookedTurn: number; // the last turn when you last looked
  following: boolean;
  linkedAt: number;
  skipped: number; // older turns left unread when it was linked late
  // how much of the last filed turn the map has read: its reply's length and
  // its question-tool lines. Claude can add to a turn after a notice (a
  // background task finishing) with no new prompt; what lies past this is
  // filed as more of that turn. Absent until first known.
  readExtent?: Extent;
};

export type Extent = { reply: number; asked: number };

// what the map keeps of an item beside the item itself
export type Meta = {
  order: string; // its fractional order key among its siblings
  under: string | null; // the parent that key is under
  folded: boolean;
  filedAt: number;
};

export type State = {
  conv: Conv;
  store: Store;
  meta: Map<string, Meta>;
};

export type RunUsage = {
  usd: number;
  input: number;
  output: number;
  model: string;
};

export type Run = {
  id: number;
  conv: string;
  turns: number[];
  base: number; // the read point it was asked from
  answer: unknown;
  status: "answered" | "applied" | "failed";
  error: string;
};

export type LogLine = { writer: Writer; op: unknown };

export type SideRow = {
  id: number;
  conv: string;
  item: string;
  title: string;
  closed: boolean;
  input: number;
  output: number;
  usd: number;
  at: number;
};

export type SideMessageRow = {
  role: "you" | "claude";
  text: string;
  tools: string[];
  stopped: boolean;
  at: number;
};

// a proposal as checked when it came: the ops in the extractor's shape
export type ProposalRow = {
  id: number;
  side: number;
  ops: unknown[];
  dropped: { op: unknown; why: string }[];
  status: "pending" | "applied" | "dropped";
  at: number;
};

export type Row = Record<string, SQLInputValue>;
export const json = (v: unknown) => JSON.stringify(v);
export const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
export const text = (v: unknown) => (typeof v === "string" ? v : "");
// a stored extent, when it is one
export const extentOf = (v: unknown): { readExtent?: Extent } => {
  const e = parse<Partial<Extent> | null>(v, null);
  return e && typeof e.reply === "number" && typeof e.asked === "number"
    ? { readExtent: { reply: e.reply, asked: e.asked } }
    : {};
};
export const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
