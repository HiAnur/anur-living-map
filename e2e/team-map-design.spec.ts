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
  await panel.getByLabel("Levels").selectOption("all");
  await expect(trial.locator(".nt")).toHaveText("I. Free trial");

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

test("Design is first and its five layouts redraw the map without changing its content", async ({
  page,
}) => {
  await openSample(page);
  for (let i = 0; i < 4; i++) {
    const response = await page.request.post(
      new URL("api/act", page.url()).href,
      {
        data: {
          type: "add",
          label: `Topic ${i + 3}`,
          from: "launch",
          x: 300,
          y: 180 + i * 90,
        },
      },
    );
    expect(response.ok()).toBe(true);
  }
  await expect(page.locator("#nodes .node")).toHaveCount(8);
  const content = async () => {
    const state = await (
      await page.request.get(new URL("api/state", page.url()).href)
    ).json();
    return { nodes: state.nodes, edges: state.edges };
  };
  const before = await content();
  const rail = page.locator("#rail .ri").first();
  await expect(rail).toHaveText("Design");
  await rail.click();
  const panel = page.getByRole("complementary", { name: "Design" });
  await expect(
    panel
      .getByRole("group", { name: "Mindmap (Logic Map)" })
      .getByRole("button"),
  ).toHaveCount(5);
  const place = (id: string) =>
    page.locator(`#nodes [data-id="${id}"]`).evaluate((el: HTMLElement) => ({
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
    }));
  for (const [label, right, left] of [
    [
      "Clockwise",
      ["pricing", "audience", "topic-3"],
      ["topic-6", "topic-5", "topic-4"],
    ],
    [
      "Counterclockwise",
      ["topic-6", "topic-5", "topic-4"],
      ["pricing", "audience", "topic-3"],
    ],
    [
      "Both sides",
      ["pricing", "audience", "topic-3"],
      ["topic-4", "topic-5", "topic-6"],
    ],
    [
      "Right",
      ["pricing", "audience", "topic-3", "topic-4", "topic-5", "topic-6"],
      [],
    ],
    [
      "Left",
      [],
      ["pricing", "audience", "topic-3", "topic-4", "topic-5", "topic-6"],
    ],
  ] as const) {
    const choice = panel.getByRole("button", { name: label, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("body")).toHaveClass(/mind-view/);
    const root = await place("launch");
    for (const [ids, sign] of [
      [right, 1],
      [left, -1],
    ] as const) {
      const positions = await Promise.all(ids.map(place));
      positions.forEach((p, i) => {
        expect(Math.sign(p.x - root.x)).toBe(sign);
        if (i) expect(p.y).toBeGreaterThan(positions[i - 1].y);
      });
    }
    expect(await content()).toEqual(before);
  }
  await page.reload();
  await rail.click();
  await expect(
    panel.getByRole("button", { name: "Left", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect((await place("trial")).x).toBeLessThan((await place("pricing")).x);
  await page.keyboard.press("Escape");
  await box(page, "Free trial").click();
  await page.keyboard.press("Tab");
  await expect(page.locator("#newbox.on")).toBeVisible();
  const editor = await page.locator("#newbox").boundingBox();
  const parent = await box(page, "Free trial").boundingBox();
  expect(editor!.x + editor!.width).toBeLessThan(parent!.x);
  await page.keyboard.press("Escape");
});
