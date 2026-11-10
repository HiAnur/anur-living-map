// A side chat's answer as it comes from the provider's chat: words, the
// tools it uses, and a result when the answer is whole.

import path from "node:path";

import type { ChatEvent } from "../../server/providers/types.ts";

// the reply under way
export type Reply = {
  text: string;
  tools: string[];
  at: number;
  gap: boolean; // a new message started after text: a paragraph break first
};

// a path as the page shows it: by name in the rendered folder, from the
// project's root inside the project
const short = (p: string, cwd: string, dir: string) =>
  p.startsWith(`${dir}/`)
    ? path.basename(p)
    : p.startsWith(`${cwd}/`)
      ? p.slice(cwd.length + 1)
      : p;

// One event folded into the reply under way. Says what it was: something
// to show (words, a tool), the end of the answer, or neither.
export function readEvent(
  e: ChatEvent,
  r: Reply,
  where: { cwd: string; dir: string },
): "shown" | "result" | null {
  if (e.type === "start") {
    if (r.text) r.gap = true;
    return null;
  }
  if (e.type === "text") {
    if (r.gap) r.text += "\n\n";
    r.gap = false;
    r.text += e.text;
    return "shown";
  }
  if (e.type === "tool") {
    r.tools.push(`${e.name} ${short(e.target, where.cwd, where.dir)}`.trim());
    return "shown";
  }
  return "result";
}
