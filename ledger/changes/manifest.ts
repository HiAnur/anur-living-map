// package.json: its dependencies, scripts and engines, from the whole file
// or from the lines of a hunk.

import { depFact, type Fact } from "./facts.ts";

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export function manifestFacts(rel: string, text: string): Fact[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const pkg = json as Record<string, unknown>;
  const facts: Fact[] = [];
  const each = (field: string, f: (name: string, v: string) => Fact) => {
    const o = pkg[field];
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    for (const [name, v] of Object.entries(o))
      if (typeof v === "string") facts.push(f(name, v));
  };
  for (const section of DEP_SECTIONS)
    each(section, (name, v) => depFact(rel, section, name, v));
  each("scripts", (name, v) => ({
    kind: "script",
    key: `${rel}#script#${name}`,
    text: `script "${name}" (${rel})`,
    value: v,
    file: rel,
  }));
  each("engines", (name, v) => ({
    kind: "engine",
    key: `${rel}#engine#${name}`,
    text: `engine ${name} (${rel})`,
    value: v,
    file: rel,
  }));
  return facts;
}

const VERSION_LIKE =
  /^(?:[\^~<>=]*\s*v?\d|\*$|latest$|next$|workspace:|file:|link:|npm:|github:|git\+|https?:)/;

// the dependency lines of a hunk, when the whole file is not known
export function manifestLines(rel: string, lines: string[]): Fact[] {
  const facts: Fact[] = [];
  let section = "";
  for (const l of lines) {
    const open = l.match(/"(\w*[dD]ependencies|scripts|engines)"\s*:\s*\{/);
    if (open) {
      section = open[1];
      continue;
    }
    if (/^\s*}/.test(l)) {
      section = "";
      continue;
    }
    const m = l.match(/^\s*"([^"]+)"\s*:\s*"([^"]*)"/);
    if (!m) continue;
    if (section === "scripts" || section === "engines") continue;
    if (section || VERSION_LIKE.test(m[2]))
      facts.push(depFact(rel, section || "dependencies?", m[1], m[2]));
  }
  return facts;
}
