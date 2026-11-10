// Unified-diff hunks (Claude Code's structuredPatch): applied to a text,
// turned round, and read for a whole file appearing or going.

export type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

// Applies unified-diff hunks (Claude Code's structuredPatch) to a text. A hunk
// whose context is not where it says is looked for further on; a hunk that is
// not there at all gives null rather than a wrong reconstruction.
export function applyHunks(text: string, hunks: Hunk[]): string | null {
  const src = text.split("\n");
  const out: string[] = [];
  let pos = 0;
  for (const h of [...hunks].sort((a, b) => a.oldStart - b.oldStart)) {
    const old = h.lines
      .filter((l) => l[0] === " " || l[0] === "-")
      .map((l) => l.slice(1));
    const want = h.oldLines === 0 ? h.oldStart : h.oldStart - 1;
    const at = findBlock(src, old, Math.max(pos, want), pos);
    if (at < 0) return null;
    out.push(...src.slice(pos, at));
    for (const l of h.lines)
      if (l[0] === " " || l[0] === "+") out.push(l.slice(1));
    pos = at + old.length;
  }
  out.push(...src.slice(pos));
  return out.join("\n");
}

function findBlock(
  src: string[],
  block: string[],
  hint: number,
  from: number,
): number {
  const fits = (at: number) =>
    at + block.length <= src.length && block.every((l, i) => src[at + i] === l);
  if (fits(hint)) return hint;
  for (let at = from; at + block.length <= src.length; at++)
    if (fits(at)) return at;
  return -1;
}

// The same hunks the other way round, to step a file back from a later
// version to an earlier one.
export function invertHunks(hunks: Hunk[]): Hunk[] {
  const flip: Record<string, string> = { "-": "+", "+": "-" };
  return hunks.map((h) => ({
    oldStart: h.newStart,
    oldLines: h.newLines,
    newStart: h.oldStart,
    newLines: h.oldLines,
    lines: h.lines.map((l) => (flip[l[0]] ?? l[0]) + l.slice(1)),
  }));
}

// Whether hunks describe a whole file appearing or going ("@@ -0,0 +1,n @@"
// and its reverse), which tells a Bash diff's missing side for free.
export function hunkShape(hunks: Hunk[]): "create" | "delete" | null {
  if (hunks.length !== 1) return null;
  const [h] = hunks;
  if (h.oldStart === 0 && h.oldLines === 0) return "create";
  if (h.newStart === 0 && h.newLines === 0) return "delete";
  return null;
}

// One side of hunks that cover a whole file, as that file's text.
export function hunkSide(hunks: Hunk[], side: "-" | "+"): string {
  return hunks
    .flatMap((h) => h.lines.filter((l) => l[0] === side || l[0] === " "))
    .map((l) => l.slice(1))
    .join("\n");
}
