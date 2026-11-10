// docker-compose files: services, their image or build, published ports and
// depends_on.

import type { Fact } from "./facts.ts";

// Drops a YAML comment: a "#" at the start or after whitespace, outside quotes.
function stripComment(line: string): string {
  let q = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1])))
      return line.slice(0, i);
  }
  return line;
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

function flowList(s: string): string[] | null {
  const m = s.trim().match(/^\[(.*)\]$/);
  if (!m) return null;
  return m[1]
    .split(",")
    .map(unquote)
    .filter((x) => x);
}

type Service = {
  name: string;
  image?: string;
  build?: string;
  ports: string[];
  dependsOn: string[];
};

// A tolerant, line-based reader for the parts of a compose file this version
// diffs: services, their image or build, published ports and depends_on.
// Anything it does not recognise is skipped rather than guessed.
export function composeFacts(rel: string, text: string): Fact[] | null {
  const lines = text
    .split(/\r?\n/)
    .map(stripComment)
    .map((l) => ({
      indent: (l.match(/^ */) ?? [""])[0].length,
      body: l.trim(),
    }))
    .filter((l) => l.body && l.body !== "---");
  const start = lines.findIndex(
    (l) => l.indent === 0 && /^services\s*:/.test(l.body),
  );
  if (start < 0) return [];
  if (!/^services\s*:\s*$/.test(lines[start].body)) return null;
  const services: Service[] = [];
  let svcIndent = -1;
  let keyIndent = -1;
  let blockIndent = -1;
  let cur: Service | null = null;
  let key = "";
  let longPort: Record<string, string> | null = null;
  const flushPort = () => {
    if (cur && longPort) cur.ports.push(longPortText(longPort));
    longPort = null;
  };
  for (const l of lines.slice(start + 1)) {
    if (l.indent === 0) break;
    if (svcIndent < 0) svcIndent = l.indent;
    if (l.indent < svcIndent) break;
    if (l.indent === svcIndent) {
      flushPort();
      const m = l.body.match(/^["']?([\w.-]+)["']?\s*:/);
      cur = m ? { name: m[1], ports: [], dependsOn: [] } : null;
      if (cur) services.push(cur);
      keyIndent = -1;
      key = "";
      continue;
    }
    if (!cur) continue;
    if (keyIndent < 0) keyIndent = l.indent;
    if (l.indent <= keyIndent) {
      flushPort();
      const m = l.body.match(/^([\w-]+)\s*:\s*(.*)$/);
      key = m ? m[1] : "";
      blockIndent = -1;
      const rest = m ? m[2] : "";
      if (key === "image" && rest) cur.image = unquote(rest);
      else if (key === "build" && rest) cur.build = unquote(rest);
      else if (key === "ports" && rest)
        cur.ports.push(...(flowList(rest) ?? []));
      else if (key === "depends_on" && rest)
        cur.dependsOn.push(...(flowList(rest) ?? []));
      continue;
    }
    if (blockIndent < 0) blockIndent = l.indent;
    if (key === "build") {
      const m = l.body.match(/^context\s*:\s*(.+)$/);
      if (m && l.indent === blockIndent) cur.build = unquote(m[1]);
    } else if (key === "ports") {
      if (l.body.startsWith("- ") || l.body === "-") {
        flushPort();
        const item = l.body.slice(1).trim();
        const kv = item.match(/^([\w-]+)\s*:\s*(.*)$/);
        if (kv) longPort = { [kv[1]]: unquote(kv[2]) };
        else if (item) cur.ports.push(unquote(item));
      } else if (longPort) {
        const kv = l.body.match(/^([\w-]+)\s*:\s*(.*)$/);
        if (kv) longPort[kv[1]] = unquote(kv[2]);
      }
    } else if (key === "depends_on" && l.indent === blockIndent) {
      if (l.body.startsWith("- ")) cur.dependsOn.push(unquote(l.body.slice(2)));
      else {
        const m = l.body.match(/^["']?([\w.-]+)["']?\s*:/);
        if (m) cur.dependsOn.push(m[1]);
      }
    }
  }
  flushPort();
  const facts: Fact[] = [];
  for (const s of services) {
    facts.push({
      kind: "service",
      key: `${rel}#service#${s.name}`,
      text: `service ${s.name} (${rel})`,
      value: s.image
        ? `image ${s.image}`
        : s.build
          ? `build ${s.build}`
          : undefined,
      file: rel,
    });
    for (const p of new Set(s.ports))
      facts.push({
        kind: "port",
        key: `${rel}#port#${s.name}#${p}`,
        text: `port ${p} published by ${s.name} (${rel})`,
        file: rel,
      });
    for (const d of new Set(s.dependsOn))
      facts.push({
        kind: "service",
        key: `${rel}#depends#${s.name}#${d}`,
        text: `${s.name} depends on ${d} (${rel})`,
        file: rel,
      });
  }
  return facts;
}

function longPortText(p: Record<string, string>): string {
  const host = p.host_ip ? `${p.host_ip}:` : "";
  const pub = p.published ? `${p.published}:` : "";
  const proto = p.protocol && p.protocol !== "tcp" ? `/${p.protocol}` : "";
  return `${host}${pub}${p.target ?? "?"}${proto}`;
}
