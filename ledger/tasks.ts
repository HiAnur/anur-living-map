// What the agent is on, from its own task list, with no model: the changes it
// made to that list (Entry.tasks, read from its tool calls by the agent's
// reader) replayed in order. Read live, so the strip says what it is doing
// even mid-turn, and never guesses.

import type { Entry, TaskStatus } from "./transcript.ts";

export type Step = { content: string; status: TaskStatus };
export type Plan = { steps: Step[]; doing: string | null };

export function planOf(path: Entry[]): Plan {
  let steps: Step[] = [];
  // added tasks go by the number they were added with
  let added = 0;
  const byTask = new Map<string, number>();
  for (const e of path)
    for (const t of e.tasks ?? []) {
      if ("set" in t) steps = t.set.map((x) => ({ ...x }));
      else if ("advance" in t) {
        const at = steps.findIndex((s) => s.status === "doing");
        if (at >= 0) steps[at]!.status = "done";
        const next = steps.findIndex(
          (s, i) => i > at && s.status === "pending",
        );
        if (next >= 0) steps[next]!.status = "doing";
      } else if ("done" in t) {
        for (const n of t.done) if (steps[n - 1]) steps[n - 1]!.status = "done";
      } else if ("start" in t) {
        if (steps[t.start - 1]) steps[t.start - 1]!.status = "doing";
      } else if ("finish" in t) {
        // a turn's wrap-up ticks off what is left of its list
        for (const s of steps) s.status = "done";
      } else if ("add" in t) {
        byTask.set(String(++added), steps.length);
        steps.push({ content: t.add, status: "pending" });
      } else {
        const at = byTask.get(t.update);
        if (at !== undefined && steps[at]) steps[at]!.status = t.status;
      }
    }
  const doing = steps.filter((s) => s.status === "doing").at(-1)?.content;
  return { steps, doing: doing || null };
}
