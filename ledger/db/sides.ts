// The side chats' part of the store: the chats themselves, what was said
// in them, what they cost and what they proposed.

import type { DatabaseSync, StatementSync } from "node:sqlite";

import {
  json,
  num,
  parse,
  text,
  type ProposalRow,
  type Row,
  type RunUsage,
  type SideMessageRow,
  type SideRow,
} from "./rows.ts";

const sideOf = (r: Row): SideRow => ({
  id: num(r.id),
  conv: text(r.conv),
  item: text(r.item),
  title: text(r.title),
  closed: num(r.closed) === 1,
  input: num(r.input),
  output: num(r.output),
  usd: num(r.usd),
  at: num(r.at),
});

// `tx` and `putSpend` are the store's own, so an answer's cost lands on the
// side chat and in the chat's spend together.
export function sideStore(
  db: DatabaseSync,
  tx: <T>(fn: () => T) => T,
  putSpend: StatementSync,
) {
  return {
    addSide(conv: string, item: string, title: string, at: number): number {
      return Number(
        db
          .prepare(
            "INSERT INTO sides (conv, item, title, at) VALUES (?, ?, ?, ?)",
          )
          .run(conv, item, title, at).lastInsertRowid,
      );
    },

    // a chat's side chats, oldest first; closed ones only when asked
    sides(conv: string, closed = false): SideRow[] {
      return (
        db
          .prepare(
            `SELECT * FROM sides WHERE conv = ?${closed ? "" : " AND closed = 0"} ORDER BY id`,
          )
          .all(conv) as Row[]
      ).map(sideOf);
    },

    side(id: number): SideRow | null {
      const r = db.prepare("SELECT * FROM sides WHERE id = ?").get(id) as
        Row | undefined;
      return r ? sideOf(r) : null;
    },

    closeSide(id: number) {
      db.prepare("UPDATE sides SET closed = 1 WHERE id = ?").run(id);
    },

    addSideMessage(side: number, m: SideMessageRow) {
      db.prepare(
        "INSERT INTO side_messages (side, role, text, tools, stopped, at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(side, m.role, m.text, json(m.tools), m.stopped ? 1 : 0, m.at);
    },

    sideMessages(side: number): SideMessageRow[] {
      return (
        db
          .prepare("SELECT * FROM side_messages WHERE side = ? ORDER BY seq")
          .all(side) as Row[]
      ).map((r) => ({
        role: r.role === "you" ? "you" : "claude",
        text: text(r.text),
        tools: parse<string[]>(r.tools, []),
        stopped: num(r.stopped) === 1,
        at: num(r.at),
      }));
    },

    // what one answer cost, on the side chat and in the chat's spend
    addSideSpend(side: SideRow, u: RunUsage, at: number) {
      tx(() => {
        db.prepare(
          "UPDATE sides SET input = input + ?, output = output + ?, usd = usd + ? WHERE id = ?",
        ).run(u.input, u.output, u.usd, side.id);
        putSpend.run(
          side.conv,
          null,
          "side",
          u.model,
          u.input,
          u.output,
          u.usd,
          at,
        );
      });
    },

    addProposal(
      side: number,
      ops: unknown[],
      dropped: ProposalRow["dropped"],
      at: number,
    ): number {
      return Number(
        db
          .prepare(
            "INSERT INTO side_proposals (side, ops, dropped, status, at) VALUES (?, ?, ?, 'pending', ?)",
          )
          .run(side, json(ops), json(dropped), at).lastInsertRowid,
      );
    },

    proposals(side: number): ProposalRow[] {
      return (
        db
          .prepare("SELECT * FROM side_proposals WHERE side = ? ORDER BY id")
          .all(side) as Row[]
      ).map((r) => ({
        id: num(r.id),
        side: num(r.side),
        ops: parse<unknown[]>(r.ops, []),
        dropped: parse<ProposalRow["dropped"]>(r.dropped, []),
        status: (["applied", "dropped"].includes(text(r.status))
          ? text(r.status)
          : "pending") as ProposalRow["status"],
        at: num(r.at),
      }));
    },

    // settles a pending proposal; false when it was not pending
    settleProposal(id: number, status: "applied" | "dropped"): boolean {
      const r = db
        .prepare(
          "UPDATE side_proposals SET status = ? WHERE id = ? AND status = 'pending'",
        )
        .run(status, id);
      return Number(r.changes) === 1;
    },

    // pending proposals per item, over a chat's open side chats
    pendingByItem(conv: string): Map<string, number> {
      const rows = db
        .prepare(
          `SELECT s.item AS item, COUNT(*) AS n FROM side_proposals p JOIN sides s ON s.id = p.side
           WHERE s.conv = ? AND p.status = 'pending' GROUP BY s.item`,
        )
        .all(conv) as Row[];
      return new Map(rows.map((r) => [text(r.item), num(r.n)]));
    },
  };
}
