"""Facts about a Python repo, read from its source with Python's own parser: no model, nothing imported or run.

CDK constructs (Class(scope, "Id", ...)) with their deployed names, handlers and settings; grants, event sources and
policy statements; and in the code that runs, its imports of the repo's own modules, AWS clients and calls, settings
read, URLs, and function names it invokes. Every fact says where it came from as path:line. Part of drawing a
system map from code: system-facts-python.js runs it as `python3 -I system_facts.py <repo>` and reads the JSON.
"""
import ast
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(sys.argv[1])
SKIP = re.compile(r"(^|/)(tests?|\.venv|venv|node_modules|cdk\.out|__pycache__|\.git|build|dist)(/|$)")
facts = []


def add(kind, where, **said):
    facts.append({"id": f"f{len(facts) + 1}", "kind": kind, "at": where, **said})


def text(node):
    try:
        return ast.unparse(node)
    except Exception:
        return "?"


def files():
    try:
        listed = subprocess.run(["git", "-C", ROOT, "ls-files", "*.py"], capture_output=True, text=True, timeout=60).stdout.split()
    except Exception:
        listed = []
    if not listed:
        listed = [os.path.relpath(os.path.join(d, f), ROOT) for d, _, fs in os.walk(ROOT) for f in fs if f.endswith(".py")]
    return sorted(f for f in listed if not SKIP.search(f) and not os.path.basename(f).startswith("test_"))[:3000]


PY = files()
# the repo's own modules: a top folder or file any import may name
OWN = {f.split("/")[0].removesuffix(".py") for f in PY} | {p for f in PY for p in f.split("/")[:-1]}

for rel in PY:
    try:
        tree = ast.parse(open(os.path.join(ROOT, rel), encoding="utf-8").read())
    except Exception:
        continue
    where = lambda n: f"{rel}:{getattr(n, 'lineno', 1)}"
    doc = ast.get_docstring(tree)
    add("module", f"{rel}:1", module=rel, doc=(doc or "").strip()[:900])
    for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
        d = ast.get_docstring(cls)
        if d:
            add("doc", where(cls), of=cls.name, module=rel, text=d.strip()[:1500])
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(re.search(r"^FN_|FUNCTION|LAMBDA", text(t).upper()) for t in node.targets):
            names = sorted({c.value for c in ast.walk(node.value) if isinstance(c, ast.Constant) and isinstance(c.value, str) and re.match(r"^[A-Z][A-Za-z0-9]+$", c.value)})
            if names:
                add("invokes_by_name", where(node), module=rel, constant=text(node.targets[0]), names=names)
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            mods = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for m in mods:
                if (m and m.split(".")[0] in OWN) or (isinstance(node, ast.ImportFrom) and node.level):
                    add("import", where(node), module=rel, imports=("." * getattr(node, "level", 0)) + m)
        elif isinstance(node, ast.Call):
            name = text(node.func)
            last = name.split(".")[-1]
            if last[:1].isupper() and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant) and isinstance(node.args[1].value, str):
                kw = {k.arg: k.value for k in node.keywords if k.arg}
                said = {"construct": name, "logical_id": node.args[1].value, "module": rel}
                for k in ("function_name", "handler", "code", "runtime", "table_name", "queue_name", "topic_name", "bucket_name", "parameter_name", "secret_name", "entry", "index"):
                    if k in kw:
                        said[k] = text(kw[k])[:160]
                if "environment" in kw and isinstance(kw["environment"], ast.Dict):
                    said["environment"] = {text(k).strip("'\""): text(v)[:120] for k, v in zip(kw["environment"].keys, kw["environment"].values) if k is not None}
                add("construct", where(node), **said)
            elif isinstance(node.func, ast.Attribute) and node.func.attr.startswith("grant"):
                add("grant", where(node), module=rel, resource=text(node.func.value), verb=node.func.attr, to=", ".join(text(a) for a in node.args))
            elif isinstance(node.func, ast.Attribute) and node.func.attr in ("add_event_source", "add_to_role_policy", "add_event_notification", "add_target", "add_resource", "add_method"):
                add("link", where(node), module=rel, on=text(node.func.value), call=node.func.attr, args=text(node)[:400])
            elif last == "PolicyStatement":
                add("policy", where(node), module=rel, **{k.arg: text(k.value)[:300] for k in node.keywords if k.arg in ("actions", "resources")})
            elif name in ("boto3.client", "boto3.resource") and node.args:
                add("aws_client", where(node), module=rel, service=text(node.args[0]).strip("'\""))
            elif name in ("os.environ.get", "os.getenv") and node.args:
                add("env_read", where(node), module=rel, name=text(node.args[0]).strip("'\""))
            elif re.search(r"\.(invoke|put_item|get_item|query|scan|update_item|delete_item|batch_write_item|get_parameter|get_secret_value|send_message|publish|start_execution|put_object|get_object|put_events)$", name):
                add("aws_call", where(node), module=rel, call=name, args=text(node)[:200])
        elif isinstance(node, ast.Subscript) and text(node.value) == "os.environ":
            add("env_read", where(node), module=rel, name=text(node.slice).strip("'\""))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and re.match(r"https?://[^\s]+$", node.value):
            add("url", where(node), module=rel, url=node.value[:120])

json.dump({"facts": facts}, sys.stdout)
