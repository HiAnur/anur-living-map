// What two sets of facts say changed (rules.ts): the statements, their
// evidence, when "no structural change" may be said, and what is noise.

import { describe, expect, it } from "vitest";

import { f } from "./changes.harness.ts";
import {
  attach,
  diffGraphs,
  explain,
  extensionOf,
  isTestFile,
  maskSecrets,
  noStructuralChange,
} from "./rules.ts";

describe("diffGraphs", () => {
  it("says added, removed and changed", () => {
    const before = [
      f("dependency", "pkg#dependencies#express", "package.json", "^4"),
      f("dependency", "pkg#dependencies#lodash", "package.json", "4"),
    ];
    const after = [
      f("dependency", "pkg#dependencies#express", "package.json", "^5"),
      f("dependency", "pkg#dependencies#zod", "package.json", "^3"),
    ];
    expect(diffGraphs(before, after).map((s) => s.text)).toEqual([
      "added dependency pkg#dependencies#zod: ^3",
      "changed dependency pkg#dependencies#express: ^4 → ^5",
      "removed dependency pkg#dependencies#lodash",
    ]);
  });

  it("folds edges across files: one file dropping an edge another keeps is no change", () => {
    const before = [
      f("import-edge", "app/server → app/layer", "app/server/a.ts"),
      f("import-edge", "app/server → app/layer", "app/server/b.ts"),
    ];
    const after = [
      f("import-edge", "app/server → app/layer", "app/server/b.ts"),
    ];
    expect(diffGraphs(before, after)).toEqual([]);
    const gone = diffGraphs(before, []);
    expect(gone.map((s) => [s.op, s.kind, s.files])).toEqual([
      ["removed", "import-edge", ["app/server/a.ts", "app/server/b.ts"]],
    ]);
  });

  it("covers modules, services, ports, scripts and engines", () => {
    const before = [
      f("module", "app/old", "app/old/x.ts"),
      f("service", "c.yml#service#db", "c.yml", "image postgres:15"),
      f("script", "p#script#dev", "p", "vite"),
      f("engine", "p#engine#node", "p", ">=20"),
    ];
    const after = [
      f("module", "app/ledger", "app/ledger/x.ts"),
      f("service", "c.yml#service#db", "c.yml", "image postgres:16"),
      f("port", "c.yml#port#db#5432:5432", "c.yml"),
      f("engine", "p#engine#node", "p", ">=23.6"),
    ];
    expect(diffGraphs(before, after).map((s) => `${s.op} ${s.kind}`)).toEqual([
      "added module",
      "removed module",
      "changed engine",
      "removed script",
      "changed service",
      "added port",
    ]);
  });

  it("names only the files whose value changed", () => {
    const before = [
      f("service", "k", "a.yml", "image x:1"),
      f("service", "k", "b.yml", "image x:1"),
    ];
    const after = [
      f("service", "k", "a.yml", "image x:1"),
      f("service", "k", "b.yml", "image x:2"),
    ];
    expect(diffGraphs(before, after)[0].files).toEqual(["b.yml"]);
  });
});

describe("evidence", () => {
  it("attaches the tool call and lets a net statement borrow it", () => {
    const call = attach(
      diffGraphs([], [f("dependency", "p#dependencies#zod", "p", "^3")]),
      { turn: 4, toolUseId: "toolu_1", tool: "Edit" },
    );
    expect(call[0].evidence).toEqual([
      { file: "p", turn: 4, toolUseId: "toolu_1", tool: "Edit" },
    ]);
    const net = diffGraphs(
      [],
      [
        f("dependency", "p#dependencies#zod", "p", "^3"),
        f("module", "unexplained", "u/x.ts"),
      ],
    );
    const explained = explain(net, call);
    expect(explained.map((s) => s.evidence)).toEqual([
      [{ file: "u/x.ts" }],
      [{ file: "p", turn: 4, toolUseId: "toolu_1", tool: "Edit" }],
    ]);
  });
});

describe("noStructuralChange", () => {
  const ts = { path: "app/server/a.ts", readable: true, reconstructed: true };

  it("may be said when every changed file was read and rebuilt", () => {
    expect(noStructuralChange([], [ts])).toEqual({
      allowed: true,
      reason: "No structural change: 1 file edited",
    });
    expect(noStructuralChange([], []).allowed).toBe(true);
  });

  it("may not be said with a statement, an unreadable kind, a gap or an unseen write", () => {
    const st = diffGraphs([], [f("module", "m", "m/x.ts")]);
    expect(noStructuralChange(st, [ts]).allowed).toBe(false);
    const v = noStructuralChange(
      [],
      [
        ts,
        { path: "README.md", readable: false, reconstructed: false },
        { path: "docs/a.md", readable: false, reconstructed: false },
        { path: "web/brand.css", readable: false, reconstructed: false },
      ],
    );
    expect(v).toEqual({
      allowed: false,
      reason: "3 changed files are of kinds no extractor reads (.md ×2, .css)",
    });
    expect(
      noStructuralChange([], [{ ...ts, reconstructed: false }]).reason,
    ).toBe("1 readable file could not be rebuilt in full");
    expect(noStructuralChange([], [ts], 2).reason).toBe(
      "2 Bash commands may have written files without a diff",
    );
  });
});

describe("maskSecrets and extensionOf", () => {
  it("masks values that look like secrets and keeps ordinary text", () => {
    expect(maskSecrets("API_KEY=abc123 node server.js")).toBe(
      "API_KEY=*** node server.js",
    );
    expect(
      maskSecrets("curl -H token: ghp_abcdefghijklmnopqrstuvwxyz0123"),
    ).toBe("curl -H token: ***");
    expect(maskSecrets("postgres://user:hunter2@db:5432/app")).toBe(
      "postgres://user:***@db:5432/app",
    );
    expect(maskSecrets("vitest run app/server/providers/claude-sessions")).toBe(
      "vitest run app/server/providers/claude-sessions",
    );
    expect(maskSecrets("deploy a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6")).toBe(
      "deploy ***",
    );
  });

  it("names a file's kind by its extension", () => {
    expect(extensionOf("docs/README.MD")).toBe(".md");
    expect(extensionOf("Dockerfile")).toBe("Dockerfile");
    expect(extensionOf(".env")).toBe(".env");
  });
});

describe("noise rules", () => {
  it("knows test files across languages", () => {
    for (const p of [
      "app/server/auth.test.ts",
      "src/__tests__/a.tsx",
      "lambda/agents/main_test.go",
      "tests/unit/test_handler.py",
      "pkg/handler_test.py",
      "test_api.py",
      "conftest.py",
    ])
      expect(isTestFile(p), p).toBe(true);
    for (const p of [
      "app/server/auth.ts",
      "lambda/testddb/db.go",
      "contest.py",
    ])
      expect(isTestFile(p), p).toBe(false);
  });

  it("marks stdlib edges and test-only changes low, and keeps them", () => {
    const st = diffGraphs(
      [],
      [
        { ...f("import-edge", "a → go:fmt", "a/x.go"), low: "stdlib" },
        f("import-edge", "a → b", "a/x_test.go"),
        f("import-edge", "a → c", "a/x.go"),
        f("import-edge", "a → b", "tests/test_b.py"),
      ],
    );
    expect(st.map((s) => [s.key, s.low])).toEqual([
      ["a → b", "tests"],
      ["a → c", undefined],
      ["a → go:fmt", "stdlib"],
    ]);
  });
});
