import { describe, expect, it, vi } from "vitest";

import { verifyMergedPR } from "./verified-pr.ts";

const repository = "team/map";
const merged = "a".repeat(40);
const head = "b".repeat(40);
const parent = "c".repeat(40);
const tree = "d".repeat(40);

function fixture(branch = "dev") {
  const commit = {
    sha: merged,
    commit: { tree: { sha: tree } },
    parents: [{ sha: parent }],
  };
  const pull = {
    number: 12,
    merged_at: "2026-01-01T00:00:00Z" as string | null,
    merge_commit_sha: merged,
    head: { sha: head },
    base: { ref: branch, repo: { full_name: repository } },
  };
  const run = {
    id: 34,
    run_number: 56,
    event: "pull_request",
    conclusion: "success",
    path: ".github/workflows/ci.yml",
    head_sha: head,
    head_commit: { tree_id: tree },
    html_url: "https://github.com/team/map/actions/runs/34",
  };
  const jobs = [
    {
      name: "app",
      conclusion: "success",
      steps: [
        "Run npm run check",
        "Run npm run coverage",
        "Run npm run build",
        "Run npm run test:ui",
        "Run python3 .github/agent-docs/check.py .",
      ].map((name) => ({ name, conclusion: "success" })),
    },
  ];
  const compared = { merge_base_commit: { sha: parent } };
  const data: Record<string, unknown> = {
    [`repos/${repository}/commits/${merged}`]: commit,
    [`repos/${repository}/commits/${merged}/pulls`]: [pull],
    [`repos/${repository}/compare/${parent}...${head}`]: compared,
    [`repos/${repository}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&status=success&per_page=100`]:
      { workflow_runs: [run] },
    [`repos/${repository}/actions/runs/34/jobs?filter=latest&per_page=100`]: {
      jobs,
    },
  };
  const api = vi.fn(async (path: string) => {
    if (!(path in data)) throw new Error(`Unexpected API call: ${path}`);
    return data[path];
  });
  return { api, commit, pull, run, jobs, compared, data };
}

describe("reusing a PR check after merge", () => {
  it.each(["dev", "main"])(
    "accepts identical code from an up-to-date, fully tested PR into %s",
    async (branch) => {
      const { api } = fixture(branch);
      await expect(
        verifyMergedPR(repository, merged, branch, api),
      ).resolves.toMatchObject({ pull: 12, run: 56 });
    },
  );

  it.each([
    ["../map", merged, "dev"],
    [repository, "HEAD", "dev"],
    [repository, merged, "feature"],
  ])(
    "rejects invalid inputs before calling GitHub",
    async (repo, sha, branch) => {
      const { api } = fixture();
      await expect(verifyMergedPR(repo, sha, branch, api)).rejects.toThrow(
        "Expected",
      );
      expect(api).not.toHaveBeenCalled();
    },
  );

  it("rejects a direct push with no merged PR", async () => {
    const f = fixture();
    f.data[`repos/${repository}/commits/${merged}/pulls`] = [];
    await expect(
      verifyMergedPR(repository, merged, "dev", f.api),
    ).rejects.toThrow("not the merge");
  });

  it.each(["open", "other commit", "other branch", "other repository"])(
    "rejects a PR for %s",
    async (reason) => {
      const f = fixture();
      if (reason === "open") f.pull.merged_at = null;
      if (reason === "other commit") f.pull.merge_commit_sha = head;
      if (reason === "other branch") f.pull.base.ref = "main";
      if (reason === "other repository")
        f.pull.base.repo.full_name = "other/map";
      await expect(
        verifyMergedPR(repository, merged, "dev", f.api),
      ).rejects.toThrow("not the merge");
    },
  );

  it("rejects a PR tested before another change reached its base", async () => {
    const f = fixture();
    f.compared.merge_base_commit.sha = "e".repeat(40);
    await expect(
      verifyMergedPR(repository, merged, "dev", f.api),
    ).rejects.toThrow("not up to date");
  });

  it.each(["failed", "push", "other workflow", "older head", "different code"])(
    "rejects a run with %s",
    async (reason) => {
      const f = fixture();
      if (reason === "failed") f.run.conclusion = "failure";
      if (reason === "push") f.run.event = "push";
      if (reason === "other workflow")
        f.run.path = ".github/workflows/other.yml";
      if (reason === "older head") f.run.head_sha = parent;
      if (reason === "different code") f.run.head_commit.tree_id = parent;
      await expect(
        verifyMergedPR(repository, merged, "dev", f.api),
      ).rejects.toThrow("No passing full PR check");
    },
  );

  it.each(["failure", "skipped", "cancelled"])(
    "rejects an app job that is %s",
    async (conclusion) => {
      const f = fixture();
      f.jobs[0]!.conclusion = conclusion;
      await expect(
        verifyMergedPR(repository, merged, "dev", f.api),
      ).rejects.toThrow("No passing full PR check");
    },
  );

  it("rejects a green job that skipped its browser tests", async () => {
    const f = fixture();
    f.jobs[0]!.steps.find((s) => s.name === "Run npm run test:ui")!.conclusion =
      "skipped";
    await expect(
      verifyMergedPR(repository, merged, "dev", f.api),
    ).rejects.toThrow("No passing full PR check");
  });

  it("does not accept unavailable evidence", async () => {
    const { api } = fixture();
    api.mockRejectedValue(new Error("GitHub unavailable"));
    await expect(
      verifyMergedPR(repository, merged, "dev", api),
    ).rejects.toThrow("GitHub unavailable");
  });
});
