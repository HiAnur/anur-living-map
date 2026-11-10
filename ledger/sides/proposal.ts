// What a side chat proposes for the map: its reply's proposal block read,
// each op checked against the store as it is now, put in plain words for
// the checklist, and applied as writer "side" only when you say so.

import { checkAnswer, type Acted } from "../apply.ts";
import type { State } from "../db.ts";
import { loose, type Op } from "../extract.ts";
import {
  KINDS,
  outranks,
  STATES,
  type Field,
  type Item,
  type Kind,
  type Store,
} from "../items.ts";
import type { Turn } from "../transcript.ts";

const MAX_OPS = 12;

// The reply's last ```proposal block, and the reply without it.
export function parseProposal(text: string): { text: string; raw: unknown } {
  const re = /```proposal[^\n]*\n([\s\S]*?)```/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) last = m;
  if (!last) return { text: text.trim(), raw: null };
  let raw: unknown;
  try {
    raw = JSON.parse(last[1]!);
  } catch {
    raw = { ops: [], bad: true };
  }
  const rest = (
    text.slice(0, last.index) + text.slice(last.index + last[0].length)
  ).trim();
  return { text: rest, raw };
}

export type Checked = { ops: Op[]; dropped: { op: Op; why: string }[] };

// A side chat's ops checked against the store as it is now. Each is checked
// on its own: an unknown id, a state its kind can't have, or a field you
// set yourself drops that op (the reason kept), and the rest still stand.
// A turn that isn't one of the chat's becomes the item's latest; a quote
// not found in its turn is left off.
export function checkProposal(
  s: Store,
  raw: unknown,
  about: Item,
  turns: Turn[],
): Checked {
  const list =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { ops?: unknown }).ops)
      ? ((raw as { ops: unknown[] }).ops as unknown[])
      : [];
  const fallback = about.src.at(-1) ?? s.read;
  const maxTurn = Math.max(s.read, turns.at(-1)?.n ?? 0);
  // a turn is filled in before the op's shape is checked: it is optional here
  const shaped =
    checkAnswer({
      topics: [],
      ops: list.slice(0, MAX_OPS).map((o) =>
        o && typeof o === "object"
          ? {
              ...(o as object),
              turn: Number.isInteger((o as { turn?: unknown }).turn)
                ? (o as { turn: number }).turn
                : fallback,
            }
          : o,
      ),
    })?.ops ?? [];
  const ok: Op[] = [];
  const dropped: Checked["dropped"] = [];
  const refs = new Set<string>();
  const exists = (id?: string) => {
    const i = id ? s.items.get(id) : undefined;
    return i && !i.retired ? i : undefined;
  };
  const drop = (op: Op, why: string) => dropped.push({ op, why });
  for (const o of shaped) {
    const op = Object.fromEntries(
      Object.entries(o).filter(([, v]) => v !== undefined),
    ) as Op;
    if (op.turn < 1 || op.turn > maxTurn) op.turn = fallback;
    if (op.quote !== undefined) {
      const t = turns.find((x) => x.n === op.turn);
      const q = loose(op.quote);
      if (!t || q.length < 3 || !loose(`${t.text}\n${t.reply}`).includes(q))
        delete op.quote;
    }
    if (op.op === "create") {
      const type = op.type as Kind | undefined;
      if (!type || !KINDS.includes(type)) {
        drop(op, "it has no kind the map knows");
        continue;
      }
      if (type === "topic") {
        drop(op, "a side chat files under its item, not new topics");
        continue;
      }
      if (!op.title?.trim()) {
        drop(op, "it has no title");
        continue;
      }
      if (op.state !== undefined && !STATES[type].includes(op.state)) {
        drop(op, `a ${type} can't be "${op.state}"`);
        continue;
      }
      const parent = op.parent ?? about.id;
      if (!refs.has(parent) && !exists(parent)) {
        drop(op, `there is no item ${parent} on the map`);
        continue;
      }
      op.parent = parent;
      op.title = op.title.trim().slice(0, 120);
      if (op.body) op.body = op.body.trim().slice(0, 400);
      if (op.ref) refs.add(op.ref);
      ok.push(op);
      continue;
    }
    const item = exists(op.item);
    if (!item) {
      drop(op, `there is no item ${op.item ?? "(none named)"} on the map`);
      continue;
    }
    if (op.op === "retire") {
      ok.push(op);
      continue;
    }
    if (op.state !== undefined) {
      if (item.type === "topic" || !STATES[item.type].includes(op.state)) {
        drop(op, `a ${item.type} can't be "${op.state}"`);
        continue;
      }
    }
    if (op.parent !== undefined && !refs.has(op.parent) && !exists(op.parent)) {
      drop(op, `there is no item ${op.parent} on the map`);
      continue;
    }
    // what you set yourself stays yours
    const mine = (f: Field) => {
      const w = item.writers[f];
      return !!w && outranks(w, "side");
    };
    const fields: Field[] = (
      ["state", "title", "body", "owner", "parent"] as const
    ).filter((f) => op[f] !== undefined);
    const yours = fields.filter(mine);
    for (const f of yours) delete op[f];
    if (!fields.length) {
      drop(op, "it changes nothing");
      continue;
    }
    if (yours.length === fields.length) {
      drop(op, "you set that yourself");
      continue;
    }
    if (op.title) op.title = op.title.trim().slice(0, 120);
    if (op.body) op.body = op.body.trim().slice(0, 400);
    ok.push(op);
  }
  return { ops: ok, dropped };
}

const clipped = (t: string, n: number) =>
  t.length > n ? `${t.slice(0, n - 1)}…` : t;

// a checked op in plain words, for the checklist
export function describe(op: Op, s: Store, earlier: Op[] = []): string {
  const titleOf = (id?: string) =>
    (id && s.items.get(id)?.title) ??
    earlier.find((o) => o.ref && o.ref === id)?.title ??
    id ??
    "";
  if (op.op === "create") {
    const state =
      op.state && op.type && op.state !== STATES[op.type]?.[0]
        ? `, ${op.state}`
        : "";
    return `Add ${op.type} "${op.title}" under "${clipped(titleOf(op.parent), 60)}"${state}`;
  }
  const t = clipped(titleOf(op.item), 70);
  if (op.op === "retire")
    return `Take "${t}" off the map${op.reason ? ` (${clipped(op.reason, 80)})` : ""}`;
  const parts = [
    op.state ? `mark it ${op.state}` : "",
    op.title ? `rename it "${op.title}"` : "",
    op.body ? `say "${clipped(op.body, 90)}"` : "",
    op.owner ? `make it ${op.owner === "you" ? "yours" : "Claude's"}` : "",
    op.parent ? `move it under "${clipped(titleOf(op.parent), 60)}"` : "",
  ].filter(Boolean);
  if (parts.length === 1 && op.state) return `Mark "${t}" ${op.state}`;
  return `"${t}": ${parts.join(", ")}`;
}

// Checked ops applied as writer "side"; new items have basis "side".
export function applyOps(
  s: State,
  ops: Op[],
  meta: { side: number; proposal: number },
): Acted {
  const refs = new Map<string, string>();
  const lines: Acted["lines"] = [];
  const resolve = (x?: string) => (x ? (refs.get(x) ?? x) : x);
  for (const op of ops) {
    if (op.op === "create") {
      const type = op.type!;
      const id = `i${s.store.next++}`;
      if (op.ref) refs.set(op.ref, id);
      s.store.items.set(id, {
        id,
        type,
        state: op.state ?? STATES[type][0]!,
        title: op.title!,
        body: op.body ?? "",
        quote: op.quote ?? "",
        src: [op.turn],
        parent: resolve(op.parent) ?? null,
        owner: op.owner,
        basis: "side",
        links: [],
        writers: {
          state: "side",
          title: "side",
          body: "side",
          owner: "side",
          parent: "side",
        },
      });
      lines.push({ writer: "side", op: { ...op, id, ...meta } });
      continue;
    }
    const item = s.store.items.get(op.item!)!;
    if (op.op === "retire") {
      item.retired = op.reason?.trim() || "retired from a side chat";
    } else {
      // a proposal you applied: where it stands is settled
      if (op.state) {
        item.state = op.state;
        delete item.unconfirmed;
      }
      if (op.title) item.title = op.title;
      if (op.body) item.body = op.body;
      if (op.owner) item.owner = op.owner;
      const p = resolve(op.parent);
      if (p && p !== item.id) item.parent = p;
      for (const f of ["state", "title", "body", "owner", "parent"] as const)
        if (op[f] !== undefined) item.writers[f] = "side";
    }
    lines.push({ writer: "side", op: { ...op, ...meta } });
  }
  return { lines };
}
