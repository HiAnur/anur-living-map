// The team map's agent stays behind its seam: no source file of the team map, or of the browser tests in e2e/, starts
// `claude`, passes it Claude Code's flags, reads ~/.claude, opens a claude:// link, or imports a Claude Code module,
// outside an agent's own folder. agent.js picks the agent, so it may import it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
// what this check reads: the team map, and the browser tests that drive its page
const SCOPE = ['team/', 'e2e/'];
// an agent's own folders: its adapters and its skill
const ADAPTERS = ['team/live/agents/', 'team/skill/'];
// where the team map picks its agent
const PICKERS = ['team/live/agent.js'];
// tests and fixtures may use the real adapter as a reader
const NOT_SOURCE = /(^|\/)(node_modules|fixtures|acme-app)\/|\.test\.[jt]sx?$|\.harness\.[jt]s$/;

/** @type {[RegExp, string][]} */
const RULES = [
  [/\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*['"`]claude\b/, 'starts claude'],
  [/['"`]claude['"`]\s*,\s*\[/, 'starts claude'],
  [
    /--(permission-mode|permission-prompts|allowedTools|disallowedTools|mcp-config|strict-mcp-config|json-schema|append-system-prompt|dangerously-skip-permissions|setting-sources|session-id)\b/,
    'passes a Claude Code flag',
  ],
  [/['"`]\.claude['"`]|\.claude\/(projects|skills|settings)/, 'reads ~/.claude'],
  [/claude:\/\//, 'opens a claude:// link'],
  [/from\s+['"][^'"]*(providers\/claude-|agents\/claude-code\/)[^'"]*['"]/, 'imports a Claude Code module'],
];

const sources = () =>
  execFileSync('git', ['ls-files', '-co', '--exclude-standard', ...SCOPE], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f) && !NOT_SOURCE.test(f))
    .filter((f) => !ADAPTERS.some((a) => f.startsWith(a)))
    .filter((f) => !PICKERS.includes(f))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));

// lines that are only a comment say where things are, which is allowed
const code = (/** @type {string} */ line) => !/^\s*(\/\/|\*|\/\*)/.test(line);

test("only the team map's agent folders know it is Claude Code", () => {
  const files = sources();
  assert.ok(files.includes('team/live/server.js'), 'the check reads the team map');
  /** @type {string[]} */
  const found = [];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!code(line)) return;
      for (const [rule, what] of RULES) if (rule.test(line)) found.push(`${f}:${i + 1} ${what}`);
    });
  }
  assert.deepEqual(found, []);
});

test('the check sees a breach where there is one', () => {
  const breaches = [
    `spawn('claude', ['-p'])`,
    `const args = ['--permission-mode', 'auto']`,
    `path.join(os.homedir(), '.claude', 'projects')`,
    "open('claude://code/new')",
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
    '// see runSettings in agents/claude-code/run.js',
  ])
    assert.ok(!code(line) || !RULES.some(([rule]) => rule.test(line)), `flagged: ${line}`);
});
