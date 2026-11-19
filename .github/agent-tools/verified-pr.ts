import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

type Api = (path: string) => Promise<unknown>;
type Pull = {
  number: number;
  merged_at: string | null;
  merge_commit_sha: string;
  head: { sha: string };
  base: { ref: string; sha: string; repo: { full_name: string } };
};
type Run = {
  id: number;
  run_number: number;
  event: string;
  conclusion: string;
  path: string;
  head_sha: string;
  head_commit: { tree_id: string } | null;
  html_url: string;
};
type Job = {
  name: string;
  conclusion: string;
  steps?: { name: string; conclusion: string }[];
};

const exec = promisify(execFile);
const github: Api = async (path) => {
  const { stdout } = await exec("gh", ["api", path]);
  return JSON.parse(stdout);
};
const requiredSteps = [
  "Run npm run check",
  "Run npm run coverage",
  "Run npm run build",
  "Run npm run test:ui",
  "Run python3 .github/agent-docs/check.py .",
];

// An up-to-date PR's test merge has its head's tree. Check both ancestry and
// tree identity so a changed base, a direct push or a partial check cannot ship.
export async function verifyMergedPR(
  repository: string,
  sha: string,
  branch: string,
  api: Api = github,
) {
  if (
    !/^[\w-]+\/[\w.-]+$/.test(repository) ||
    [".", ".."].includes(repository.split("/")[1] ?? "") ||
    !/^[a-f0-9]{40}$/.test(sha) ||
    !["dev", "main"].includes(branch)
  )
    throw new Error("Expected a repository, full commit SHA and dev or main.");

  const root = `repos/${repository}`;
  const commit = (await api(`${root}/commits/${sha}`)) as {
    sha: string;
    commit: { tree: { sha: string } };
    parents: { sha: string }[];
  };
  const pulls = (await api(`${root}/commits/${sha}/pulls`)) as Pull[];
  const pull = pulls.find(
    (p) =>
      p.merged_at &&
      p.merge_commit_sha === sha &&
      p.base.ref === branch &&
      p.base.repo.full_name === repository,
  );
  if (!pull || commit.sha !== sha || !commit.parents.length)
    throw new Error("This commit is not the merge of a PR into this branch.");

  // The PR keeps its base at merge time. A rebase merge's immediate parent
  // can be a rewritten feature commit rather than that target branch tip.
  const compared = (await api(
    `${root}/compare/${pull.base.sha}...${pull.head.sha}`,
  )) as { merge_base_commit: { sha: string } };
  if (compared.merge_base_commit.sha !== pull.base.sha)
    throw new Error(
      "The PR was not up to date with the branch before merging.",
    );

  const { workflow_runs: runs } = (await api(
    `${root}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pull.head.sha}&status=success&per_page=100`,
  )) as { workflow_runs: Run[] };
  for (const run of runs) {
    if (
      run.event !== "pull_request" ||
      run.conclusion !== "success" ||
      run.path !== ".github/workflows/ci.yml" ||
      run.head_sha !== pull.head.sha ||
      run.head_commit?.tree_id !== commit.commit.tree.sha
    )
      continue;
    const { jobs } = (await api(
      `${root}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
    )) as { jobs: Job[] };
    const app = jobs.find((j) => j.name === "app");
    if (
      app?.conclusion === "success" &&
      requiredSteps.every((name) =>
        app.steps?.some((s) => s.name === name && s.conclusion === "success"),
      )
    )
      return { pull: pull.number, run: run.run_number, url: run.html_url };
  }
  throw new Error("No passing full PR check tested exactly this merged code.");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const [repository = "", sha = "", branch = ""] = process.argv.slice(2);
    const proof = await verifyMergedPR(repository, sha, branch);
    const message = `Verified ${sha}: PR #${proof.pull}, CI #${proof.run} passed all checks on identical code. ${proof.url}`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
