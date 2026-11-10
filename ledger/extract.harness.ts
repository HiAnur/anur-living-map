// What the extractor's tests share: two turns and the map after the first.

import assert from "node:assert/strict";

import { apply, type Answer } from "./extract.ts";
import { emptyStore, type Store } from "./items.ts";
import type { Turn } from "./transcript.ts";
export const turn = (n: number, text: string, reply: string): Turn => ({
  n,
  prompt: `p${n}`,
  via: "typed",
  text,
  ts: n,
  end: n,
  reply,
  entries: [],
  changes: [],
  hooks: [],
});

export const T1 = turn(
  1,
  "How should the clusters talk?",
  "Two options: keep the **Nebula** overlay, or move to VPC peering. Which do you want?",
);
export const T2 = turn(
  2,
  "Go with VPC peering.",
  "Done. I'll add the peering routes next.",
);

export function first(): Store {
  const s = emptyStore("c1", "Networking");
  const a: Answer = {
    topics: [{ turn: 1, topic: "new1" }],
    ops: [
      {
        op: "create",
        ref: "new1",
        type: "topic",
        title: "Cluster networking",
        quote: "How should the clusters talk?",
        turn: 1,
      },
      {
        op: "create",
        ref: "new2",
        type: "question",
        title: "Keep Nebula or move to VPC peering?",
        quote: "Which do you want?",
        turn: 1,
        owner: "you",
        parent: "new1",
      },
      {
        op: "create",
        ref: "new3",
        type: "option",
        title: "Keep the Nebula overlay",
        quote: "keep the Nebula overlay",
        turn: 1,
        parent: "new2",
      },
      {
        op: "create",
        ref: "new4",
        type: "option",
        title: "VPC peering",
        quote: "move to VPC peering",
        turn: 1,
        parent: "new2",
      },
    ],
  };
  const r = apply(s, a, [T1]);
  assert.deepEqual(r.rejected, []);
  return s;
}
