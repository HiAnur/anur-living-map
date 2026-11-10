// TypeScript and JavaScript source: the modules a file imports, and where
// each import leads (a group of this repo's files, or a package).

import { builtinModules } from "node:module";
import { posix } from "node:path";

import {
  type Alias,
  type Context,
  type Fact,
  groupOf,
  moduleFacts,
  type Target,
} from "./facts.ts";

const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts"];
const BUILTINS = new Set(builtinModules);

// The code with comments removed, template literals and regex literals
// blanked, and every quoted string replaced by its index in `strings`, so an
// import written inside a string or a test fixture is never read as one.
function skeleton(src: string): { code: string; strings: string[] } {
  const strings: string[] = [];
  let code = "";
  let last = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      code += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        s += src[j] ?? "";
        j++;
      }
      strings.push(s);
      code += `"${strings.length - 1}"`;
      last = '"';
      i = j + 1;
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "$" && src[j + 1] === "{") {
          depth++;
          j += 2;
        } else if (src[j] === "}" && depth > 0) {
          depth--;
          j++;
        } else if (src[j] === "`" && depth === 0) break;
        else j++;
      }
      code += "``";
      last = "`";
      i = j + 1;
      continue;
    }
    if (c === "/" && regexAllowed(last, code)) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      code += "/r/";
      last = "/";
      i = j;
      continue;
    }
    code += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return { code, strings };
}

function regexAllowed(last: string, code: string): boolean {
  if (last === "" || "(,=:[!&|?{};+-*%<>~^".includes(last)) return true;
  return /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)\s*$/.test(
    code,
  );
}

const IMPORT_PATTERNS = [
  /(?<![\w$.])import\s*(?:type\s+)?(?:[\w$*{}\s,]+?\s*from\s*)?"(\d+)"/g,
  /(?<![\w$.])export\s*(?:type\s+)?(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*"(\d+)"/g,
  /(?<![\w$.])require\s*\(\s*"(\d+)"\s*\)/g,
  /(?<![\w$.])import\s*\(\s*"(\d+)"\s*[,)]/g,
];

// Every module specifier the file imports: static imports, re-exports,
// require() and import() with a literal argument.
export function importSpecifiers(source: string): string[] {
  const { code, strings } = skeleton(source);
  const found = new Set<string>();
  for (const re of IMPORT_PATTERNS)
    for (const m of code.matchAll(re)) {
      const s = strings[Number(m[1])];
      if (s) found.add(s);
    }
  return [...found];
}

export function resolveSpecifier(
  fromRel: string,
  spec: string,
  ctx: Context = {},
): Target | null {
  const depth = ctx.depth ?? 2;
  const clean = spec.replace(/[?#].*$/, "");
  if (!clean || clean.includes("://")) return null;
  if (clean.startsWith(".") || clean.startsWith("/")) {
    const joined = clean.startsWith("/")
      ? posix.normalize(clean.slice(1))
      : posix.normalize(posix.join(posix.dirname(fromRel), clean));
    if (joined.startsWith("..")) return { group: "(outside the repo)" };
    return { group: groupOf(resolveFile(joined, ctx), depth) };
  }
  const alias = matchAlias(fromRel, clean, ctx.aliases ?? []);
  if (alias !== null)
    return { group: groupOf(resolveFile(posix.normalize(alias), ctx), depth) };
  if (clean.startsWith("@/") || clean.startsWith("~/"))
    return { group: `(alias ${clean.slice(0, 2)})` };
  if (clean.startsWith("node:"))
    return { pkg: `node:${clean.slice(5).split("/")[0]}`, low: true };
  const parts = clean.split("/");
  const name = clean.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (BUILTINS.has(name)) return { pkg: `node:${name}`, low: true };
  return { pkg: name };
}

// Which file an import names: itself, with an extension, or a directory's
// index. Unknown paths are taken as files, the common case in TypeScript.
function resolveFile(rel: string, ctx: Context): string {
  const exists = ctx.exists;
  if (!exists) return rel;
  if (exists(rel)) return rel;
  for (const ext of RESOLVE_EXT) if (exists(rel + ext)) return rel + ext;
  for (const ext of RESOLVE_EXT)
    if (exists(`${rel}/index${ext}`)) return `${rel}/index${ext}`;
  return rel;
}

function matchAlias(
  fromRel: string,
  spec: string,
  aliases: Alias[],
): string | null {
  let best: Alias | null = null;
  for (const a of aliases) {
    if (a.scope && !fromRel.startsWith(`${a.scope}/`)) continue;
    const hit = a.exact ? spec === a.prefix : spec.startsWith(a.prefix);
    if (hit && (!best || a.prefix.length > best.prefix.length)) best = a;
  }
  if (!best || !best.targets.length) return null;
  return best.exact
    ? best.targets[0]
    : best.targets[0] + spec.slice(best.prefix.length);
}

// tsconfig/jsconfig `compilerOptions.paths`, relative to the repo root.
// Tolerant of comments and trailing commas; a file it cannot read gives none.
export function parseAliases(text: string, configRel: string): Alias[] {
  let json: unknown;
  try {
    const { code, strings } = skeleton(text);
    json = JSON.parse(
      code
        .replace(/,(\s*[}\]])/g, "$1")
        .replace(/"(\d+)"/g, (_, i) => JSON.stringify(strings[Number(i)])),
    );
  } catch {
    return [];
  }
  const opts = (json as { compilerOptions?: Record<string, unknown> })
    ?.compilerOptions;
  const paths = opts?.paths;
  if (!paths || typeof paths !== "object") return [];
  const dir = posix.dirname(configRel) === "." ? "" : posix.dirname(configRel);
  const base = posix.join(
    dir || ".",
    typeof opts.baseUrl === "string" ? opts.baseUrl : ".",
  );
  const out: Alias[] = [];
  for (const [pattern, raw] of Object.entries(paths)) {
    const prefix = pattern.replace(/\*.*$/, "");
    // "*" alone would swallow every package name
    if (!Array.isArray(raw) || !prefix) continue;
    const targets = raw
      .filter((t): t is string => typeof t === "string")
      .map((t) => {
        const stem = t.replace(/\*.*$/, "");
        const p = posix.join(base, stem);
        if (p === "." || p === "./") return "";
        // "src/*" and a bare "*" both put the rest of the import after a "/"
        return t.includes("*") &&
          (!stem || stem.endsWith("/")) &&
          !p.endsWith("/")
          ? `${p}/`
          : p;
      });
    out.push({ scope: dir, prefix, exact: !pattern.includes("*"), targets });
  }
  return out;
}

export function sourceFacts(
  rel: string,
  source: string,
  ctx: Context = {},
): Fact[] {
  return moduleFacts(rel, targets(rel, source, ctx), ctx);
}

export function targets(rel: string, source: string, ctx: Context): Target[] {
  return importSpecifiers(source)
    .map((spec) => resolveSpecifier(rel, spec, ctx))
    .filter((t): t is Target => t !== null);
}
