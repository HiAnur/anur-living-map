// Go: imports, go.mod, and where an import leads.

import { describe, expect, it } from "vitest";

import { keys } from "./changes.harness.ts";
import { goImports, goModFacts, goModInfo, resolveGo } from "./go.ts";
import { extract, hunkFacts } from "./graph.ts";
import { diffGraphs } from "./rules.ts";

describe("Go", () => {
  const ctx = {
    goModules: [
      { dir: "", path: "example.com/anur" },
      { dir: "golib", path: "example.com/anur/golib" },
    ],
    goRequires: ["github.com/aws/aws-sdk-go-v2", "go.uber.org/zap"],
  };

  it("reads single imports, blocks, aliases, dot and blank imports", () => {
    const src = `package main

// import "commented/out"
import "fmt"
import str "strings"

import (
\t"context"
\tsdk "github.com/aws/aws-sdk-go-v2/service/s3"
\t. "example.com/anur/golib/testddb"
\t_ "embed"
\t/* "block/comment" */
)

var tpl = \`import "in/raw/string"\`
`;
    expect(goImports(src).sort()).toEqual(
      [
        "fmt",
        "strings",
        "context",
        "github.com/aws/aws-sdk-go-v2/service/s3",
        "example.com/anur/golib/testddb",
        "embed",
      ].sort(),
    );
  });

  it("resolves the repo's own modules to directory groups", () => {
    expect(
      resolveGo("lambda/agents/main.go", "example.com/anur/golib/testddb", ctx),
    ).toEqual({ group: "golib/testddb" });
    expect(
      resolveGo(
        "lambda/agents/main.go",
        "example.com/anur/lambda/publisher",
        ctx,
      ),
    ).toEqual({ group: "lambda/publisher" });
  });

  it("marks the standard library low and names external modules", () => {
    expect(resolveGo("a/b.go", "net/http", ctx)).toEqual({
      pkg: "go:net",
      low: true,
    });
    expect(
      resolveGo("a/b.go", "github.com/aws/aws-sdk-go-v2/service/s3", ctx),
    ).toEqual({ pkg: "github.com/aws/aws-sdk-go-v2" });
    expect(resolveGo("a/b.go", "go.uber.org/zap/zapcore", ctx)).toEqual({
      pkg: "go.uber.org/zap",
    });
    expect(resolveGo("a/b.go", "github.com/x/y/z/w", {})).toEqual({
      pkg: "github.com/x/y",
    });
  });

  it("emits edges from a source file, with stdlib edges low", () => {
    const facts = extract(
      "lambda/agents/main.go",
      `package main\nimport (\n"fmt"\n"example.com/anur/golib/testddb"\n)`,
      ctx,
    );
    expect(facts?.map((f) => [f.kind, f.key, f.low])).toEqual([
      ["module", "lambda/agents", undefined],
      ["import-edge", "lambda/agents → go:fmt", "stdlib"],
      ["import-edge", "lambda/agents → golib/testddb", undefined],
    ]);
  });

  it("reads go.mod: module, go, require and replace in both forms", () => {
    const mod = `module example.com/anur/lambda

go 1.23
toolchain go1.23.2

require github.com/aws/aws-lambda-go v1.47.0

require (
\tgithub.com/aws/aws-sdk-go-v2 v1.30.0
\tgolang.org/x/net v0.28.0 // indirect
)

replace example.com/anur/golib => ../golib
replace (
\tgithub.com/old/thing v1.0.0 => github.com/new/thing v1.1.0
)
`;
    expect(
      goModFacts("go.mod", mod)
        .filter((x) => x.low)
        .map((x) => [x.key, x.low]),
    ).toEqual([["go.mod#require#golang.org/x/net", "indirect"]]);
    expect(goModInfo(mod)).toEqual({
      module: "example.com/anur/lambda",
      requires: [
        "github.com/aws/aws-lambda-go",
        "github.com/aws/aws-sdk-go-v2",
        "golang.org/x/net",
      ],
    });
    expect(
      goModFacts("lambda/go.mod", mod).map((f) => [f.kind, f.key, f.value]),
    ).toEqual([
      ["engine", "lambda/go.mod#engine#go", "1.23"],
      ["engine", "lambda/go.mod#engine#toolchain", "go1.23.2"],
      [
        "dependency",
        "lambda/go.mod#require#github.com/aws/aws-lambda-go",
        "v1.47.0",
      ],
      [
        "dependency",
        "lambda/go.mod#require#github.com/aws/aws-sdk-go-v2",
        "v1.30.0",
      ],
      [
        "dependency",
        "lambda/go.mod#require#golang.org/x/net",
        "v0.28.0 (indirect)",
      ],
      [
        "dependency",
        "lambda/go.mod#replace#example.com/anur/golib",
        "=> ../golib",
      ],
      [
        "dependency",
        "lambda/go.mod#replace#github.com/old/thing",
        "=> github.com/new/thing v1.1.0",
      ],
    ]);
  });

  it("reads require lines in a go.mod hunk without their block's opening", () => {
    const h = hunkFacts("go.mod", [
      {
        oldStart: 4,
        oldLines: 2,
        newStart: 4,
        newLines: 2,
        lines: [
          "-\tgithub.com/aws/aws-sdk-go-v2 v1.30.0",
          "+\tgithub.com/aws/aws-sdk-go-v2 v1.31.0",
          " )",
        ],
      },
    ]);
    expect(h?.after.map((f) => f.value)).toEqual(["v1.31.0"]);
    expect(diffGraphs(h?.before ?? [], h?.after ?? [])[0].text).toBe(
      "changed dependency github.com/aws/aws-sdk-go-v2 (require, go.mod): v1.30.0 → v1.31.0",
    );
  });

  it("reads import lines in a Go hunk cut inside an import block", () => {
    const h = hunkFacts("svc/api/main.go", [
      {
        oldStart: 3,
        oldLines: 2,
        newStart: 3,
        newLines: 2,
        lines: [' \t"fmt"', '+\t"github.com/redis/go-redis/v9"'],
      },
    ]);
    expect(keys(h?.after ?? [])).toEqual([
      "svc/api → go:fmt",
      "svc/api → github.com/redis/go-redis",
    ]);
  });
});
