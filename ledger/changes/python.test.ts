// Python: imports, requirements and pyproject, and where an import leads.

import { describe, expect, it } from "vitest";

import { keys } from "./changes.harness.ts";
import { extract, fileKind } from "./graph.ts";
import {
  pyImports,
  pyprojectFacts,
  requirementsFacts,
  resolvePy,
} from "./python.ts";

describe("Python", () => {
  const files = new Set([
    "lambda/roar/process_roar/roar_utils.py",
    "lambda/roar/process_roar/lambda_function.py",
    "common/__init__.py",
    "common/db.py",
    "src/app/core/models.py",
  ]);
  const dirs = new Set([
    "lambda",
    "lambda/roar",
    "lambda/roar/process_roar",
    "common",
    "src",
    "src/app",
    "src/app/core",
  ]);
  const ctx = {
    exists: (p: string) => files.has(p),
    isDir: (p: string) => dirs.has(p),
  };

  it("reads every form of import, and not those in strings or comments", () => {
    const src = `"""Docstring: import fake"""
from __future__ import annotations
import os, sys as system
import common.db
from common.db import connect
from . import roar_utils
from ..shared import helpers
from .models import (
    User,
    Team,
)
# import commented
def f():
    import json; import boto3
s = "from nowhere import x"
`;
    expect(pyImports(src)).toEqual([
      { dots: 0, module: "os" },
      { dots: 0, module: "sys" },
      { dots: 0, module: "common.db" },
      { dots: 1, module: "" },
      { dots: 2, module: "shared" },
      { dots: 1, module: "models" },
      { dots: 0, module: "json" },
      { dots: 0, module: "boto3" },
    ]);
  });

  it("resolves in-repo modules: siblings, packages, relative and src/", () => {
    const from = "lambda/roar/process_roar/lambda_function.py";
    expect(resolvePy(from, { dots: 0, module: "roar_utils" }, ctx)).toEqual({
      group: "lambda/roar",
    });
    expect(resolvePy(from, { dots: 0, module: "common.db" }, ctx)).toEqual({
      group: "common",
    });
    expect(resolvePy(from, { dots: 2, module: "" }, ctx)).toEqual({
      group: "lambda/roar",
    });
    expect(resolvePy(from, { dots: 4, module: "common" }, ctx)).toEqual({
      group: "common",
    });
    expect(
      resolvePy("tests/test_x.py", { dots: 0, module: "app.core.models" }, ctx),
    ).toEqual({ group: "src/app" });
    // a Lambda layer's python/ directory is on the path when the caller says so
    const layer = {
      exists: () => false,
      isDir: (p: string) => p === "layers/common/python/utils",
      pyRoots: ["layers/common/python"],
    };
    expect(
      resolvePy("lambda/x/h.py", { dots: 0, module: "utils.dates" }, layer),
    ).toEqual({ group: "layers/common" });
  });

  it("names other modules by their top-level name, stdlib low", () => {
    expect(resolvePy("a/b.py", { dots: 0, module: "os.path" }, ctx)).toEqual({
      pkg: "py:os",
      low: true,
    });
    expect(
      resolvePy("a/b.py", { dots: 0, module: "boto3.session" }, ctx),
    ).toEqual({ pkg: "boto3" });
  });

  it("reads requirements files", () => {
    const facts = requirementsFacts(
      "requirements-dev.txt",
      `# tools
-r requirements.txt
--index-url https://pypi.example/simple
boto3==1.34.0
Requests[socks] >= 2.31 ; python_version > "3.8"
pytest  # latest
https://example.com/pkg.whl
`,
    );
    expect(facts.map((f) => [f.key, f.value])).toEqual([
      ["requirements-dev.txt#requirements#boto3", "==1.34.0"],
      [
        "requirements-dev.txt#requirements#requests",
        '>= 2.31 ; python_version > "3.8"',
      ],
      ["requirements-dev.txt#requirements#pytest", "any"],
    ]);
  });

  it("reads pyproject.toml: project, optional, groups and Poetry tables", () => {
    const toml = `[project]
name = "svc"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",  # web
  'pydantic[email]~=2.6',
]

[project.optional-dependencies]
aws = ["boto3"]

[dependency-groups]
dev = ["pytest>=8"]

[tool.poetry.dependencies]
python = "^3.11"
httpx = "^0.27"
mylib = { path = "../mylib", develop = true }
sqlalchemy = { version = "^2.0", extras = ["asyncio"] }

[tool.poetry.group.test.dependencies]
pytest-cov = "*"

[tool.ruff]
line-length = 100
`;
    expect(
      pyprojectFacts("pyproject.toml", toml).map((f) => [
        f.kind,
        f.key,
        f.value,
      ]),
    ).toEqual([
      ["engine", "pyproject.toml#engine#python", ">=3.11"],
      ["dependency", "pyproject.toml#project#fastapi", ">=0.110"],
      ["dependency", "pyproject.toml#project#pydantic", "~=2.6"],
      ["dependency", "pyproject.toml#optional aws#boto3", "any"],
      ["dependency", "pyproject.toml#group dev#pytest", ">=8"],
      ["engine", "pyproject.toml#engine#python", "^3.11"],
      ["dependency", "pyproject.toml#poetry#httpx", "^0.27"],
      ["dependency", "pyproject.toml#poetry#mylib", "path ../mylib"],
      ["dependency", "pyproject.toml#poetry#sqlalchemy", "^2.0"],
      ["dependency", "pyproject.toml#poetry test#pytest-cov", "*"],
    ]);
  });

  it("dispatches .py, requirements and pyproject files", () => {
    expect(fileKind("svc/handler.py")).toBe("python");
    expect(fileKind("requirements.txt")).toBe("pydeps");
    expect(fileKind("requirements-dev.txt")).toBe("pydeps");
    expect(fileKind("pyproject.toml")).toBe("pydeps");
    expect(fileKind("notes.txt")).toBeNull();
    expect(
      keys(extract("lambda/x/handler.py", "import boto3\nimport json", ctx)),
    ).toEqual(["lambda/x", "lambda/x → boto3", "lambda/x → py:json"]);
  });
});
