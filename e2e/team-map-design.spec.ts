import { expect, test } from "@playwright/test";

import { box, openSample, SAMPLE, useTeamServer } from "./team-map.harness.ts";

useTeamServer();

test("designs a map and its selected boxes, with changes saved on reload", async ({
  page,
}) => {
  await openSample(page, {
    ...SAMPLE,
    numbering: { format: "circled", level: "1" },
  });
  const rail = page.getByRole("button", { name: "Design", exact: true });
  const panel = page.getByRole("complementary", { name: "Design" });
  const pricing = box(page, "Pricing");
  const trial = box(page, "Free trial");
  await pricing.click();
  await rail.click();
  await expect(rail).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText("Pricing", { exact: true })).toBeVisible();

  const format = panel.getByLabel("Format");
  await expect(format).toHaveValue("decimal");
  await expect(format.locator('option[value="circled"]')).toHaveCount(0);
  await expect(pricing.locator(".nt")).toHaveText("1. Pricing");
  await format.selectOption("roman");
  await expect(pricing.locator(".nt")).toHaveText("I. Pricing");
  await expect(trial.locator(".nt")).toHaveText("Free trial");
  await expect(panel.getByLabel("Levels")).toHaveCount(0);
  await trial.click();
  await expect(format).toHaveValue("none");
  await format.selectOption("letters");
  await expect(trial.locator(".nt")).toHaveText("A. Free trial");
  await expect(pricing.locator(".nt")).toHaveText("I. Pricing");
  await pricing.click();
  await expect(format).toHaveValue("roman");

  await panel.getByRole("button", { name: "Top align" }).click();
  await expect(pricing).toHaveAttribute("data-align", "top");
  await panel.getByRole("button", { name: "Green flag" }).click();
  await expect(pricing.getByRole("img", { name: "green flag" })).toBeVisible();
  await panel.getByRole("button", { name: "62.5% progress" }).click();
  await expect(
    pricing.getByRole("img", { name: "62.5% progress" }),
  ).toBeVisible();

  await panel.getByRole("button", { name: "100% progress" }).click();
  const complete = pricing.getByRole("img", { name: "100% progress" });
  await expect(complete).toBeVisible();
  await expect(complete.locator("circle")).toHaveAttribute(
    "fill",
    "currentColor",
  );
  await expect(complete.locator("[stroke-dasharray]")).toHaveCount(0);
  await panel.getByRole("button", { name: "62.5% progress" }).click();
  await expect(
    pricing.getByRole("img", { name: "62.5% progress" }),
  ).toBeVisible();

  await trial.click();
  await expect(panel.getByText("Free trial", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Clear flag" }),
  ).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Purple flag" }).click();
  await expect(trial.getByRole("img", { name: "purple flag" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(rail).toBeFocused();

  await page.reload();
  await expect(pricing.locator(".nt")).toHaveText("I. Pricing");
  await expect(pricing).toHaveAttribute("data-align", "top");
  await expect(
    pricing.getByRole("img", { name: "62.5% progress" }),
  ).toBeVisible();
  await expect(trial.getByRole("img", { name: "purple flag" })).toBeVisible();
  await pricing.click();
  await rail.click();
  await panel.getByRole("button", { name: "Clear progress" }).click();
  await expect(pricing.locator(".design-mark.progress")).toHaveCount(0);
  await expect(pricing.getByRole("img", { name: "green flag" })).toBeVisible();
});

test("box titles start at the same inset with or without markers", async ({
  page,
}) => {
  await openSample(page, {
    ...SAMPLE,
    numbering: { format: "decimal", level: "1" },
    nodes: SAMPLE.nodes.map((node) =>
      node.id === "pricing"
        ? { ...node, design: { flag: "red", progress: "100" } }
        : node,
    ),
  });
  const pricing = box(page, "Pricing").locator(".nt");
  const audience = box(page, "Audience").locator(".nt");
  const leftPadding = (title: ReturnType<typeof box>) =>
    title.evaluate(
      (el) =>
        el.getBoundingClientRect().left -
        el.closest(".node")!.getBoundingClientRect().left,
    );

  for (const view of ["Engineer", "PM"]) {
    if (view === "PM") {
      await page.locator("#peopleb").click();
      await page.getByRole("radio", { name: "PM", exact: true }).click();
      await expect(page.locator("body")).toHaveClass(/mind-view/);
    }
    await expect(pricing).toHaveText("1. Pricing");
    await expect(audience).toHaveText("2. Audience");
    expect(
      Math.abs((await leftPadding(pricing)) - (await leftPadding(audience))),
    ).toBeLessThan(1);
  }
});

test("numbering changes only the selected siblings and survives undo and reload", async ({
  page,
}) => {
  await openSample(page, {
    ...SAMPLE,
    numbering: { format: "decimal", level: "1" },
  });
  for (const [label, from, x, y] of [
    ["Annual plan", "pricing", 600, 0],
    ["Trial length", "trial", 900, -90],
  ] as const) {
    const response = await page.request.post(
      new URL("api/act", page.url()).href,
      {
        data: { type: "add", label, from, x, y },
      },
    );
    expect(response.ok()).toBe(true);
  }
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "PM", exact: true }).click();
  const trial = page.locator('#nodes [data-id="trial"]');
  const annual = page.locator('#nodes [data-id="annual-plan"]');
  const grandchild = page.locator('#nodes [data-id="trial-length"]');
  const pricing = page.locator('#nodes [data-id="pricing"]');
  const audience = page.locator('#nodes [data-id="audience"]');
  await trial.click();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const format = page.locator("#design-format");
  await expect(format).toHaveValue("none");
  await format.selectOption("roman");
  await expect(trial.locator(".nt")).toHaveText("I. Free trial");
  await expect(annual.locator(".nt")).toHaveText("II. Annual plan");
  await expect(pricing.locator(".nt")).toHaveText("1. Pricing");
  await expect(audience.locator(".nt")).toHaveText("2. Audience");
  await expect(grandchild.locator(".nt")).toHaveText("Trial length");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(trial.locator(".nt")).toHaveText("Free trial");
  await expect(format).toHaveValue("none");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(trial.locator(".nt")).toHaveText("I. Free trial");
  await page.reload();
  await expect(annual.locator(".nt")).toHaveText("II. Annual plan");
  await trial.click();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await expect(format).toHaveValue("roman");
  await format.selectOption("none");
  await expect(annual.locator(".nt")).toHaveText("Annual plan");
  await expect(pricing.locator(".nt")).toHaveText("1. Pricing");
  await expect(grandchild.locator(".nt")).toHaveText("Trial length");
});
