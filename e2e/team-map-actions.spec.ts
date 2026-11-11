import { expect, test } from "@playwright/test";

import {
  SAMPLE,
  box,
  openSample,
  server,
  signIn,
  useTeamServer,
} from "./team-map.harness.ts";

// Action boxes on the team map's page, on a copy of the team server: where an Action stands, cancelling, deleting
// and archiving, confirming a run, and handing it over.

useTeamServer();

test("an Action box shows where it stands", async ({ page }) => {
  const action = (id: string, stage: object) =>
    SAMPLE.nodes.map((n) => (n.id === id ? { ...n, action: stage } : n));
  await openSample(page, {
    ...SAMPLE,
    nodes: action("trial", {
      by: "Duy",
      stage: "finished",
      completion: { status: "completed", evidence: ["Trial page is live"] },
    }).map((n) =>
      n.id === "audience" ? { ...n, action: { by: "Duy", stage: "ready" } } : n,
    ),
  });
  await expect(
    box(page, "Free trial").getByLabel("Action status: Executed"),
  ).toBeVisible();
  await expect(
    box(page, "Audience").getByLabel("Action status: Ready to execute"),
  ).toBeVisible();
});

test("cancelling an Action keeps it, and Prepare again brings it back", async ({
  page,
}) => {
  const ready = {
    by: "Duy",
    stage: "ready",
    id: "r1",
    intent: "Write the trial page",
    history: [],
    brief: {
      kind: "other",
      goal: "Write the trial page",
      target: "The website",
      result: "A trial page people can read",
      steps: ["Write the page"],
    },
  };
  await openSample(page, {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "trial" ? { ...n, action: ready, boxType: "action" } : n,
    ),
  });
  await box(page, "Free trial").click();
  await page.getByRole("button", { name: "Cancel Action" }).click();
  await expect(
    page.getByLabel("Action status: Cancelled").first(),
  ).toBeVisible();
  await expect(page.locator(".action-card h3")).toHaveText("Cancelled");
  // still an Action: the toggle stays on and cannot turn it back
  await expect(page.locator(".action-type-toggle")).toBeDisabled();
  // the history code keeps on the Action names who cancelled it
  await page.getByText("Action history").click();
  await expect(page.locator(".action-history li").first()).toContainText(
    "Cancelled · Duy",
  );
  await page.getByRole("button", { name: "Prepare again" }).click();
  await expect(page.getByLabel("Action instructions")).toHaveValue(
    "Write the trial page",
  );
});

test("an Action box is deleted only after a question, and archived once it has run", async ({
  page,
}) => {
  const draft = { by: "Duy", stage: "draft", id: "d1", intent: "Plan it" };
  const ran = {
    by: "Duy",
    stage: "blocked",
    id: "b1",
    session: "s1",
    intent: "Write the trial page",
    history: [],
  };
  await openSample(page, {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "trial"
        ? { ...n, action: ran, boxType: "action" }
        : n.id === "audience"
          ? { ...n, action: draft, boxType: "action" }
          : n,
    ),
  });
  // before it runs, Delete asks first and names the Action
  await box(page, "Audience").click();
  await page.locator('#side [data-side-tab="box"]').click();
  await page.locator("#side [data-delete]").click();
  await expect(page.locator(".delq")).toContainText(
    "Delete this box and its Action?",
  );
  await page.locator("[data-delete-no]").click();
  await expect(box(page, "Audience")).toHaveCount(1);
  // once it has run, the details offer Archive instead of Delete
  await box(page, "Free trial").click();
  await page.locator('#side [data-side-tab="box"]').click();
  await expect(page.locator("#side [data-delete]")).toHaveCount(0);
  await page.locator("#side [data-archive]").click();
  await expect(box(page, "Free trial")).toHaveCount(0);
  // History lists it, and Put back on the map brings it back
  await page.locator('#rail [data-rail="history"]').click();
  await expect(page.locator("#hist .ha")).toContainText("Free trial");
  await page.getByRole("button", { name: "Put back on the map" }).click();
  await expect(box(page, "Free trial")).toHaveCount(1);
});

test("a run the map could not verify waits for its author to confirm it", async ({
  page,
}) => {
  const completion = {
    status: "unverified",
    summary: "Wrote the trial page",
    evidence: [],
    claimed: ["Saved trial.html"],
  };
  const finished = {
    by: "Duy",
    stage: "finished",
    id: "r2",
    session: "s1",
    intent: "Write the trial page",
    history: [],
    brief: {
      kind: "other",
      goal: "Write the trial page",
      target: "The website",
      result: "A trial page",
      steps: ["Write it"],
    },
    completion,
    turns: [{ who: "Claude", text: "Wrote the trial page", completion, at: 1 }],
  };
  await openSample(page, {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "trial" ? { ...n, action: finished, boxType: "action" } : n,
    ),
  });
  await expect(
    box(page, "Free trial").getByLabel("Action status: Done, unverified"),
  ).toBeVisible();
  await box(page, "Free trial").click();
  await expect(page.locator(".action-evidence.claimed")).toContainText(
    "Saved trial.html",
  );
  await page.getByRole("button", { name: "Confirm done" }).click();
  await expect(
    box(page, "Free trial").getByLabel("Action status: Executed"),
  ).toBeVisible();
});

test("an Admin hands an Action to another member", async ({
  page,
  browser,
}) => {
  const ready = {
    by: "Duy",
    stage: "ready",
    id: "r3",
    intent: "Write the trial page",
    history: [],
    brief: {
      kind: "other",
      goal: "Write the trial page",
      target: "The website",
      result: "A trial page",
      steps: ["Write it"],
    },
  };
  const name = await openSample(page, {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "trial" ? { ...n, action: ready, boxType: "action" } : n,
    ),
  });
  // a map's people are those who have opened it: Harshit opens it once
  const other = await browser.newContext();
  await other.addCookies([
    {
      name: "lm_session",
      value: signIn("Harshit"),
      domain: "localhost",
      path: "/",
    },
  ]);
  const visit = await other.newPage();
  await visit.goto(`${server.origin}/${name}/`);
  await expect(visit.locator("#nodes .node")).toHaveCount(4);
  await other.close();
  await box(page, "Free trial").click();
  await page.getByText("Hand over").click();
  await page.getByRole("button", { name: "Harshit" }).click();
  await expect
    .poll(async () => {
      const state = await (
        await page.request.get(`${server.origin}/${name}/api/state`)
      ).json();
      return state.nodes.find((n: { id: string }) => n.id === "trial").action
        .by;
    })
    .toBe("Harshit");
  await page.getByText("Action history").click();
  await expect(page.locator(".action-history li").first()).toContainText(
    "Handed over · Duy",
  );
});
