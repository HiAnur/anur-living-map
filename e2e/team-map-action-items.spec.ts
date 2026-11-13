import { expect, test } from "@playwright/test";

import { SAMPLE, box, openSample, useTeamServer } from "./team-map.harness.ts";

// Action drafts made from your words on the team map's page: the label with the quote, Not an action, Not mine and
// Take it on. Taking an item on starts preparing it, so this server has no agent to reach.

useTeamServer({ agentless: true });

const from = {
  kind: "chat",
  quote: "I'll write the trial page by Friday",
  at: 1,
};
const task = {
  goal: "Write the trial page",
  result: "A trial page people can read",
  inputs: [],
  steps: ["Write the page"],
  evidence: ["The page is live"],
  readiness: "needs_information",
  dependsOn: [],
  blockers: [],
  destination: "",
};
const people = [
  { id: "Duy", sees: "all", joined: "2026-01-01" },
  { id: "Priya", sees: "all", joined: "2026-01-01" },
];
// the trial box holds a draft made from Duy's words, prepared and ready
const withDraft = () => ({
  ...SAMPLE,
  people,
  nodes: SAMPLE.nodes.map((n) =>
    n.id === "trial"
      ? {
          ...n,
          boxType: "action",
          action: {
            by: "Duy",
            stage: "ready",
            id: "r1",
            intent: task.goal,
            plan: task,
            history: [],
            from,
            brief: {
              kind: "other",
              goal: task.goal,
              target: "The website",
              result: task.result,
              steps: task.steps,
            },
          },
        }
      : n,
  ),
});

test("a draft made from your words says so, and Not an action makes it an Info box", async ({
  page,
}) => {
  await openSample(page, withDraft());
  await box(page, "Free trial").click();
  await expect(page.locator("#side .action-from")).toHaveText(
    `Made from your words: ${from.quote}`,
  );
  await page.getByRole("button", { name: "Not an action" }).click();
  await expect(box(page, "Free trial").locator(".action-tag")).toHaveCount(0);
  await expect(page.locator("#side .action-type-toggle")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

test("Not mine names whose it is, who sees it for them without Take it on here", async ({
  page,
}) => {
  await openSample(page, withDraft());
  await box(page, "Free trial").click();
  await page.locator(".action-notmine summary").click();
  await page.locator('.action-notmine [data-action-to="Priya"]').click();
  await expect(box(page, "Free trial").locator(".action-tag")).toHaveCount(0);
  await page.locator('#side [data-side-tab="box"]').click();
  // their name goes on the box's second line
  await expect(page.locator("#side .side-summary")).toHaveText(
    "For Priya · Fourteen days",
  );
  await expect(page.locator("#side .action-item-for")).toContainText(
    "Action item for Priya",
  );
  await expect(page.getByRole("button", { name: "Take it on" })).toHaveCount(0);
});

test("an item for you offers Take it on, which makes it your Action", async ({
  page,
}) => {
  await openSample(page, {
    ...SAMPLE,
    people,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "audience"
        ? {
            ...n,
            sub: "For Duy",
            for: "Duy",
            task,
            from: { ...from, said: "Priya" },
          }
        : n,
    ),
  });
  await box(page, "Audience").click();
  await page.locator('#side [data-side-tab="box"]').click();
  await expect(page.locator("#side .action-item-for")).toContainText(
    "Action item for you",
  );
  await expect(page.locator("#side .action-item-for q")).toHaveText(from.quote);
  await page.getByRole("button", { name: "Take it on" }).click();
  await expect(box(page, "Audience").locator(".action-tag")).toBeVisible();
  await expect(page.locator("#side .action-from")).toContainText(
    "You took this on from Priya's words",
  );
  // the map prepared it as Duy; with no agent to reach, it says so instead of running anything
  await expect(
    box(page, "Audience").getByLabel("Action status: Couldn't prepare"),
  ).toBeVisible();
});
