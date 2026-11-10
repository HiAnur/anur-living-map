// Extractors for the what-changed view: one file's contents → the structural
// facts a diff compares. Pure: the caller supplies contents, the repo's file
// list and its path aliases, so the same code reads a snapshot, a transcript
// reconstruction or a test fixture.
//
// Version 2 reads TypeScript/JavaScript, Go and Python imports, package.json,
// go.mod, requirements files, pyproject.toml and docker-compose files. Every
// other kind is "unreadable", which is what keeps "No structural change"
// honest: it may only be said when every changed file is of a kind listed
// here.
import { posix } from "node:path";

import { composeFacts } from "./compose.ts";
import {
  type Context,
  type Fact,
  type FileKind,
  moduleFacts,
} from "./facts.ts";
import {
  goHunkFacts,
  goModFacts,
  goModHunkFacts,
  goSourceFacts,
} from "./go.ts";
import { sourceFacts, targets } from "./js.ts";
import { manifestFacts, manifestLines } from "./manifest.ts";
import type { Hunk } from "./patch.ts";
import { pyprojectFacts, pySourceFacts, requirementsFacts } from "./python.ts";

export type {
  Alias,
  Context,
  Fact,
  FileKind,
  GoModule,
  Kind,
  Target,
} from "./facts.ts";
export { groupOf, groupOfDir } from "./facts.ts";
export { goImports, goModInfo, resolveGo } from "./go.ts";
export { pyImports, resolvePy } from "./python.ts";
export { composeFacts } from "./compose.ts";
export {
  importSpecifiers,
  parseAliases,
  resolveSpecifier,
  sourceFacts,
} from "./js.ts";
export { manifestFacts } from "./manifest.ts";
export {
  applyHunks,
  type Hunk,
  hunkShape,
  hunkSide,
  invertHunks,
} from "./patch.ts";

const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const COMPOSE = /^(?:docker-)?compose(?:[.-][\w.-]+)?\.ya?ml$/;
const REQUIREMENTS = /^requirements(?:[.-][\w.-]+)?\.txt$/;

export function fileKind(rel: string): FileKind | null {
  const base = posix.basename(rel);
  if (base === "package.json") return "manifest";
  if (COMPOSE.test(base)) return "compose";
  if (SOURCE.test(base) && !base.endsWith(".d.ts")) return "source";
  if (base === "go.mod") return "gomod";
  if (base.endsWith(".go")) return "go";
  if (base.endsWith(".py")) return "python";
  if (base === "pyproject.toml" || REQUIREMENTS.test(base)) return "pydeps";
  return null;
}

// ---------------------------------------------------------------- dispatch

// The facts in one file, or null when its kind is unreadable or its contents
// could not be parsed (a package.json caught mid-edit).
export function extract(
  rel: string,
  content: string,
  ctx: Context = {},
): Fact[] | null {
  switch (fileKind(rel)) {
    case "source":
      return sourceFacts(rel, content, ctx);
    case "manifest":
      return manifestFacts(rel, content);
    case "compose":
      return composeFacts(rel, content);
    case "go":
      return goSourceFacts(rel, content, ctx);
    case "gomod":
      return goModFacts(rel, content);
    case "python":
      return pySourceFacts(rel, content, ctx);
    case "pydeps":
      return posix.basename(rel) === "pyproject.toml"
        ? pyprojectFacts(rel, content)
        : requirementsFacts(rel, content);
    default:
      return null;
  }
}
// ---------------------------------------------------------------- hunks only

// When a file's full text is unknown, the facts on each side of its hunks:
// import edges for source files, dependency lines for manifests. The result
// can miss facts outside the hunks, so statements from it are marked
// partial. Compose and pyproject structure lives in context a hunk cuts off,
// so they give null.
export function hunkFacts(
  rel: string,
  hunks: Hunk[],
  ctx: Context = {},
): { before: Fact[]; after: Fact[] } | null {
  const kind = fileKind(rel);
  const read = HUNK_READERS[kind ?? ""];
  if (!read || posix.basename(rel) === "pyproject.toml") return null;
  const side = (keep: string) =>
    hunks.map((h) =>
      h.lines
        .filter((l) => l[0] === " " || l[0] === keep)
        .map((l) => l.slice(1))
        .join("\n"),
    );
  return {
    before: side("-").flatMap((t) => read(rel, t, ctx)),
    after: side("+").flatMap((t) => read(rel, t, ctx)),
  };
}

const HUNK_READERS: Record<
  string,
  (rel: string, text: string, ctx: Context) => Fact[]
> = {
  source: (rel, t, ctx) => moduleFacts(rel, targets(rel, t, ctx), ctx, false),
  manifest: (rel, t) => manifestLines(rel, t.split("\n")),
  go: goHunkFacts,
  gomod: (rel, t) => goModHunkFacts(rel, t),
  python: (rel, t, ctx) => pySourceFacts(rel, t, ctx, false),
  pydeps: (rel, t) => requirementsFacts(rel, t),
};
