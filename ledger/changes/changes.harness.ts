import type { Fact } from "./graph.ts";

// the keys of some facts, of one kind when asked
export const keys = (facts: Fact[] | null, kind?: string) =>
  (facts ?? []).filter((f) => !kind || f.kind === kind).map((f) => f.key);

// a fact, for a graph written out by hand
export const f = (
  kind: Fact["kind"],
  key: string,
  file: string,
  value?: string,
): Fact => ({ kind, key, text: `${kind} ${key}`, value, file });
