import { expect, test } from "@playwright/test";

import {
  SAMPLE,
  box,
  openSample,
  server,
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

test("an Admin hands an Action to another member", async ({ page }) => {
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
  // a map's people are those who have opened it: Harshit opened it on another Mac, before it came here
  const name = await openSample(page, {
    ...SAMPLE,
    people: [{ id: "Harshit", sees: "all", joined: "earlier" }],
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "trial" ? { ...n, action: ready, boxType: "action" } : n,
    ),
  });
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

test("PM Action boxes keep the arrow and status inside and preserve the details panel", async ({
  page,
}) => {
  const ready = {
    by: "Duy",
    stage: "ready",
    id: "pm-ready",
    brief: {
      goal: "Write the trial page",
      target: "The website",
      result: "A trial page people can read",
      steps: ["Write the page"],
    },
  };
  await openSample(page, {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "trial"
        ? { ...n, action: ready }
        : n.id === "audience"
          ? { ...n, action: { by: "Duy", stage: "draft" } }
          : n,
    ),
  });
  const trial = box(page, "Free trial");
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "PM", exact: true }).click();
  await expect(trial).toHaveClass(/mind-action/);
  await expect(trial.locator(".mind-action-arrow")).toHaveText("›");
  const badge = trial.getByLabel("Action status: Ready for review");
  await expect(badge).toBeVisible();
  await expect(
    box(page, "Audience").getByLabel("Action status: Draft"),
  ).toBeVisible();
  await expect(trial.locator(".action-tag")).toHaveCount(0);
  const fits = await trial.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const title = el.querySelector(".nt")!.getBoundingClientRect();
    const badge = el
      .querySelector(".action-status-pill")!
      .getBoundingClientRect();
    return (
      badge.x >= title.right &&
      badge.right <= box.right &&
      badge.y >= box.y &&
      badge.bottom <= box.bottom
    );
  });
  expect(fits).toBe(true);
  const curve = await page
    .locator('#edges path.hit[data-edge="pricing>trial"]')
    .evaluate((el: SVGPathElement) => {
      const end = el.getPointAtLength(el.getTotalLength());
      const node = document.querySelector(
        '#nodes [data-id="trial"]',
      ) as HTMLElement;
      return {
        end: { x: end.x, y: end.y },
        left: parseFloat(node.style.left) - parseFloat(node.style.width) / 2,
        middle: parseFloat(node.style.top),
      };
    });
  expect(curve.end.x).toBeCloseTo(curve.left, 0);
  expect(curve.end.y).toBeCloseTo(curve.middle, 0);
  await trial.click();
  await expect(page.locator("#side .side-tabs")).toContainText("Information");
  await expect(
    page.locator("#side").getByLabel("Action status: Ready to execute"),
  ).toBeVisible();
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "Engineer", exact: true }).click();
  await expect(trial).not.toHaveClass(/mind-action/);
  await expect(trial.locator(".mind-action-arrow")).toHaveCount(0);
  await expect(
    trial.getByLabel("Action status: Ready to execute"),
  ).toBeVisible();
});

test("PM Action titles balance their lines and keep sibling boxes apart", async ({
  page,
}) => {
  const longTitle = "Ask the partner how questions reach them";
  const unbrokenTitle = "SyncDeliveryConfirmation".repeat(5);
  await openSample(page, {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "trial"
        ? {
            ...n,
            label: longTitle,
            action: {
              by: "Duy",
              stage: "ready",
              id: "long-ready",
              brief: {
                goal: longTitle,
                target: "Save here",
                steps: ["Draft the questions"],
                result: "A draft",
              },
            },
          }
        : n.id === "audience"
          ? {
              ...n,
              label: unbrokenTitle,
              action: { by: "Duy", stage: "draft" },
            }
          : n,
    ),
    edges: [
      { from: "launch", to: "pricing" },
      { from: "pricing", to: "trial" },
      { from: "pricing", to: "audience" },
    ],
  });
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "PM", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  for (const title of [longTitle, unbrokenTitle]) {
    const action = box(page, title);
    await expect(action.locator(".nt")).toHaveText(title);
    const layout = await action.evaluate((el) => {
      const text = el.querySelector(".nt") as HTMLElement;
      const badge = el.querySelector(".action-status-pill")!;
      const bounds = el.getBoundingClientRect();
      const words = text.getBoundingClientRect();
      const status = badge.getBoundingClientRect();
      return {
        wrapped: text.offsetHeight > 30,
        clipped: text.scrollWidth > text.clientWidth + 1,
        height: (el as HTMLElement).offsetHeight,
        fits:
          words.top >= bounds.top &&
          words.bottom <= bounds.bottom &&
          words.right <= status.left &&
          status.right <= bounds.right,
      };
    });
    expect(layout).toMatchObject({
      wrapped: true,
      clipped: false,
      fits: true,
    });
    expect(layout.height).toBeGreaterThan(40);
  }
  const lineWidths = await box(page, longTitle)
    .locator(".nt")
    .evaluate((el) => {
      const text = el.firstChild!;
      const widths = new Map<number, { left: number; right: number }>();
      for (const word of text.textContent!.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, word.index!);
        range.setEnd(text, word.index! + word[0].length);
        const rect = range.getBoundingClientRect();
        const row = widths.get(rect.top);
        widths.set(rect.top, {
          left: row ? Math.min(row.left, rect.left) : rect.left,
          right: row ? Math.max(row.right, rect.right) : rect.right,
        });
      }
      return [...widths.values()].map((line) => line.right - line.left);
    });
  expect(lineWidths).toHaveLength(2);
  expect(Math.min(...lineWidths) / Math.max(...lineWidths)).toBeGreaterThan(
    0.7,
  );
  const textWidth = await box(page, longTitle)
    .locator(".nt")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(textWidth - Math.max(...lineWidths)).toBeLessThan(3);
  const first = await box(page, longTitle).boundingBox();
  const second = await box(page, unbrokenTitle).boundingBox();
  expect(second!.y - (first!.y + first!.height)).toBeGreaterThan(10);
  await page.reload();
  await expect(box(page, longTitle).locator(".nt")).toHaveCSS(
    "white-space",
    "normal",
  );
  await box(page, longTitle).click();
  await expect(page.locator("#side")).toContainText(longTitle);
});
