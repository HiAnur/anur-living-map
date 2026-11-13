// The chat map's agent stays behind its seam: no source file outside an
// agent's own folder starts `claude`, passes it Claude Code's flags, reads
// ~/.claude, opens a claude:// link, or imports a Claude Code module. This
// reads everything outside team/; team/live/seam.test.js holds the team map
// to the same rules.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// an agent's own folders: its adapter, its skill, and the evals that measure it
const ADAPTERS = ["server/providers/", "skill/", "eval/"];
// tests and fixtures may use the real adapter as a reader
const NOT_SOURCE =
  /(^|\/)(node_modules|fixtures|acme-app)\/|\.test\.[jt]sx?$|\.harness\.[jt]s$/;

const RULES: [RegExp, string][] = [
  [
    /\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*['"`]claude\b/,
    "starts claude",
  ],
  [/['"`]claude['"`]\s*,\s*\[/, "starts claude"],
  [
    /--(permission-mode|permission-prompts|allowedTools|disallowedTools|mcp-config|strict-mcp-config|json-schema|append-system-prompt|dangerously-skip-permissions|setting-sources|session-id)\b/,
    "passes a Claude Code flag",
  ],
  [
    /['"`]\.claude['"`]|\.claude\/(projects|skills|settings)/,
    "reads ~/.claude",
  ],
  [/claude:\/\//, "opens a claude:// link"],
  [
    /from\s+['"][^'"]*(providers\/claude-|agents\/claude-code\/)[^'"]*['"]/,
    "imports a Claude Code module",
  ],
];

const sources = () =>
  execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !NOT_SOURCE.test(f))
    .filter((f) => !f.startsWith("team/"))
    .filter((f) => !ADAPTERS.some((a) => f.startsWith(a)))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));

// lines that are only a comment say where things are, which is allowed
const code = (line: string) => !/^\s*(\/\/|\*|\/\*)/.test(line);

test("only the chat map's agent folders know it is Claude Code", () => {
  const found: string[] = [];
  for (const f of sources()) {
    const lines = fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!code(line)) return;
      for (const [rule, what] of RULES)
        if (rule.test(line)) found.push(`${f}:${i + 1} ${what}`);
    });
  }
  assert.deepEqual(found, []);
});

test("the check sees a breach where there is one", () => {
  const breaches = [
    `spawn('claude', ['-p'])`,
    `const args = ['--permission-mode', 'auto']`,
    `path.join(os.homedir(), '.claude', 'projects')`,
    "open('claude://code/new')",
    `import { readMore } from "../server/providers/claude-transcript.ts";`,
    `import { converse } from './agents/claude-code/converse.js';`,
  ];
  for (const line of breaches)
    assert.ok(
      RULES.some(([rule]) => rule.test(line)),
      `missed: ${line}`,
    );
  for (const line of [
    `role: "claude"`,
    `ignores: [".claude/**"]`,
    `const who = m.who === "claude" ? "Claude" : "You";`,
    "// see chatArgs in server/providers/claude-code.ts",
  ])
    assert.ok(
      !code(line) || !RULES.some(([rule]) => rule.test(line)),
      `flagged: ${line}`,
    );
});
