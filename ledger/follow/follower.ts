// One chat being followed: what the follower keeps in memory, what a
// ledger is given to work with, and the questions answered from a follower
// alone (what waits to be filed, and whether the last filed turn grew).

import type {
  ExtractRequest,
  ExtractResult,
} from "../../server/providers/types.ts";
import type { LedgerEvent, LedgerView } from "../../shared/ledger.ts";
import type { Compared, Shadow } from "../changes/snapshot.ts";
import type { Conv, Extent, LedgerDb, State } from "../db.ts";
import type { Plan } from "../tasks.ts";
import type { ReadMore, Transcript, Turn } from "../transcript.ts";

export const TICK_MS = 1000;
export const BATCH = 3;
export const LATE_TURNS = 40;
export const MAX_RUNNING = 2;

// how much of a turn there is to read: its reply and its question-tool lines
export const extentOfTurn = (t: Turn): Extent => ({
  reply: t.reply.length,
  asked: t.asked?.length ?? 0,
});

// A turn the map has filed can still grow: a notice (a background task
// finishing, the map's own listener among them) is not a prompt, so what
// Claude does next is more of the same turn. Its new part, past `read`, as a
// turn of the same number the extractor can file; null when nothing was added.
export function continuationOf(t: Turn, read: Extent): Turn | null {
  const reply = t.reply.slice(read.reply).trim();
  const asked = (t.asked ?? []).slice(read.asked);
  if (!reply && !asked.length) return null;
  return {
    ...t,
    text: `(No new message from you. This is more of turn ${t.n}: Claude went on after a background task finished; what came before was filed already.)`,
    reply,
    asked,
  };
}

export const backoff = (failures: number) =>
  failures ? Math.min(10 * 60_000, 30_000 * 2 ** (failures - 1)) : 0;

export type LedgerDeps = {
  db: LedgerDb;
  // the agent's reader of a chat's transcript (AgentConversation.readMore)
  read: ReadMore;
  extract?: (req: ExtractRequest) => Promise<ExtractResult>;
  emit: (e: LedgerEvent) => void;
  // words for the main chat, delivered through its inbox (`quiet`: they
  // wait for your next message there instead of waking it)
  tell?: (conv: Conv, text: string, quiet?: boolean) => void;
  // when the main chat last took what waited in its inbox (0: never)
  heardAt?: (conv: Conv) => number;
  // the model the extractor runs on ("" for the agent's default)
  model?: () => string;
  now?: () => number;
  // the chat's handover file, rewritten with its map (handover.ts)
  handover?: (s: State, v: LedgerView) => void;
  everyMs?: number; // 0: no timer (tests call tick)
  // where a resumed chat goes on (AgentConversation.successor)
  findSuccessor?: (
    file: string,
    id: string,
  ) => { file: string; id: string } | null;
  // what changed in the system: snapshots at each newly sealed turn (absent
  // in tests that don't need it)
  changes?: {
    shadowFor: (cwd: string) => Shadow | null;
    snapshot: (sh: Shadow, label: string) => string | null;
    compare: (sh: Shadow, a: string, b: string, turn: number) => Compared;
  };
};

export type Follower = {
  s: State;
  t: Transcript;
  file: string;
  grewAt: number; // when the transcript last grew
  turns: Turn[];
  sealed: number;
  readOnce: boolean;
  readBusy: boolean;
  running: Promise<void> | null;
  failures: number;
  retryAt: number;
  error?: string;
  // a backlog being read (linked late, or many turns behind): from where,
  // up to which turn
  backlog?: { from: number; to: number };
  nudged: boolean; // the page opened: run what is waiting now
  lookedForNext: number;
  // the shadow repository (null: the chat isn't in a git work tree;
  // undefined: not looked for yet), its last snapshot, and the sealed
  // turns it covers
  shadow?: Shadow | null;
  snap?: string;
  snapped: number;
  // Claude's own task list, as its calls left it
  plan?: Plan;
  lastSweep: number; // the read point the last sweep checked at
  // How long the map takes: when each turn was seen sealed (only turns
  // sealed while following; a chat's past has no times), the run under way,
  // and how the last run did. The page shows them; the log keeps one line
  // per run.
  sealedAt: Map<number, number>;
  filing?: LedgerView["health"]["filing"];
  lag?: LedgerView["health"]["lag"];
};

// What reading and filing share with the ledger that owns the followers:
// the store, the clock, the model to file on, how a new view is pushed,
// and how many extractions are out now (at most MAX_RUNNING).
export type Ctx = {
  deps: LedgerDeps;
  db: LedgerDb;
  now: () => number;
  model: () => string;
  push: (root: string) => void;
  active: number;
};

export const unique = (ids: string[]) => [...new Set(ids.filter(Boolean))];

export const pendingOf = (f: Follower) =>
  f.turns.slice(0, f.sealed).filter((t) => t.n > f.s.store.read);

// the last filed turn's new part, once that turn is sealed again; a map
// that doesn't know yet how far it read (filed before this was kept)
// starts from where the turn is now, so nothing is filed twice
export function continued(f: Follower): Turn | null {
  const read = f.s.store.read;
  const i = f.turns.findIndex((t) => t.n === read);
  if (read <= 0 || i < 0 || i >= f.sealed) return null;
  const t = f.turns[i]!;
  if (!f.s.conv.readExtent) {
    f.s.conv.readExtent = extentOfTurn(t);
    return null;
  }
  return continuationOf(t, f.s.conv.readExtent);
}
