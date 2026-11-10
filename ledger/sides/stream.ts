// A side chat's process answers in stream-json, one event a line: words as
// they come, the tools it uses, and a result when the answer is whole.

import path from "node:path";

// the reply under way
export type Reply = {
  text: string;
  tools: string[];
  at: number;
  gap: boolean; // a new message started after text: a paragraph break first
  model: string;
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
  d: Record<string, unknown>,
  r: Reply,
  where: { cwd: string; dir: string },
): "shown" | "result" | null {
  if (d.type === "stream_event") {
    const e = d.event as {
      type?: string;
      message?: { model?: string };
      delta?: { text?: string };
    };
    if (e?.type === "message_start") {
      if (typeof e.message?.model === "string") r.model = e.message.model;
      if (r.text) r.gap = true;
    }
    if (e?.type === "content_block_delta" && e.delta?.text) {
      if (r.gap) r.text += "\n\n";
      r.gap = false;
      r.text += e.delta.text;
      return "shown";
    }
    return null;
  }
  if (d.type === "assistant") {
    const content = (d.message as { content?: unknown[] })?.content;
    let shown = false;
    for (const c of Array.isArray(content) ? content : []) {
      const b = c as {
        type?: string;
        name?: string;
        input?: Record<string, unknown>;
      };
      if (b.type !== "tool_use") continue;
      const what = String(
        b.input?.file_path ?? b.input?.pattern ?? b.input?.path ?? "",
      );
      r.tools.push(`${b.name} ${short(what, where.cwd, where.dir)}`.trim());
      shown = true;
    }
    return shown ? "shown" : null;
  }
  return d.type === "result" ? "result" : null;
}
