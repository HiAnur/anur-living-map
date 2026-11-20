import { expect, test } from "@playwright/test";

import { box, openSample, SAMPLE, useTeamServer } from "./team-map.harness.ts";

useTeamServer();

for (const view of ["Engineer", "PM"]) {
  test(`applies and clears designs on three selected boxes in ${view}`, async ({
    page,
  }) => {
    await openSample(page, {
      ...SAMPLE,
      nodes: SAMPLE.nodes.map((node, i) =>
        i === 0
          ? node
          : {
              ...node,
              x: 300,
              y: (i - 2) * 100,
              design: [
                {},
                { flag: "red" },
                { progress: "0" },
                { align: "top" },
              ][i],
            },
      ),
      edges: SAMPLE.nodes
        .slice(1)
        .map((node) => ({ from: "launch", to: node.id })),
    });
    await page.getByRole("button", { name: "Design", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Design" });
    if (view === "PM")
      await panel.getByRole("button", { name: "Right", exact: true }).click();
    const topics = page.locator('#nodes .node:not([data-id="launch"])');
    const bounds = await topics.evaluateAll((nodes) => {
      const rects = nodes.map((node) => node.getBoundingClientRect());
      return {
        left: Math.min(...rects.map((r) => r.left)) - 12,
        top: Math.min(...rects.map((r) => r.top)) - 12,
        right: Math.max(...rects.map((r) => r.right)) + 12,
        bottom: Math.max(...rects.map((r) => r.bottom)) + 12,
      };
    });
    await page.mouse.move(bounds.left, bounds.top);
    await page.mouse.down();
    await page.mouse.move(bounds.right, bounds.bottom, { steps: 12 });
    await page.mouse.up();
    await expect(page.locator("#nodes .node.sel")).toHaveCount(3);
    await expect(panel.getByText("3 boxes", { exact: true })).toBeVisible();
    for (const name of ["Flag", "Progress", "Vertical alignment"]) {
      await expect(
        panel
          .getByRole("group", { name, exact: true })
          .locator('[aria-pressed="true"]'),
      ).toHaveCount(0);
    }

    await expect(panel.getByRole("button", { name: "Clear flag" })).toHaveCount(
      0,
    );
    await expect(
      panel.getByRole("button", { name: "Clear progress" }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "Green flag" }).click();
    await expect(topics.getByRole("img", { name: "green flag" })).toHaveCount(
      3,
    );
    await expect(
      panel.getByRole("button", { name: "Green flag" }),
    ).toHaveAttribute("aria-pressed", "true");
    await panel
      .getByRole("button", { name: "High priority", exact: true })
      .click();
    await expect(
      topics.getByRole("img", { name: "High priority", exact: true }),
    ).toHaveCount(3);
    await panel
      .getByRole("button", { name: "High priority", exact: true })
      .click();
    await expect(topics.locator(".design-mark.priority")).toHaveCount(0);
    for (const label of ["One thing", "Medium", "Low", "High"]) {
      await panel
        .getByRole("button", { name: `${label} priority`, exact: true })
        .click();
      await expect(
        topics.getByRole("img", { name: `${label} priority`, exact: true }),
      ).toHaveCount(3);
    }
    await expect(
      panel
        .getByRole("group", { name: "Person", exact: true })
        .getByRole("button"),
    ).toHaveCount(0);
    await panel
      .getByRole("button", { name: "50% progress", exact: true })
      .click();
    await expect(
      topics.getByRole("img", { name: "50% progress", exact: true }),
    ).toHaveCount(3);
    await panel.getByRole("button", { name: "Bottom align" }).click();
    await expect(page.locator('#nodes .node[data-align="bottom"]')).toHaveCount(
      3,
    );
    await expect(box(page, "Launch plan").locator(".design-mark")).toHaveCount(
      0,
    );
    await page.screenshot({
      path: test.info().outputPath("three-selected.png"),
    });

    await panel.getByRole("button", { name: "Green flag" }).click();
    await expect(topics.locator(".design-mark.flag")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Green flag" }),
    ).toHaveAttribute("aria-pressed", "false");
    await panel
      .getByRole("button", { name: "50% progress", exact: true })
      .click();
    await expect(topics.locator(".design-mark.progress")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "50% progress", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      topics.getByRole("img", { name: "50% progress", exact: true }),
    ).toHaveCount(3);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(topics.getByRole("img", { name: "green flag" })).toHaveCount(
      3,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator('#nodes .node[data-align="bottom"]')).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.locator('#nodes .node[data-align="bottom"]')).toHaveCount(
      3,
    );

    await page.reload();
    await expect(topics.getByRole("img", { name: "green flag" })).toHaveCount(
      3,
    );
    await expect(
      topics.getByRole("img", { name: "50% progress", exact: true }),
    ).toHaveCount(3);
    await expect(page.locator('#nodes .node[data-align="bottom"]')).toHaveCount(
      3,
    );
    await expect(
      topics.getByRole("img", { name: "High priority", exact: true }),
    ).toHaveCount(3);
  });
}

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
  await expect(
    panel.getByRole("button", { name: "Orange person" }),
  ).toHaveCount(0);
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
    panel
      .getByRole("group", { name: "Flag", exact: true })
      .locator('[aria-pressed="true"]'),
  ).toHaveCount(0);
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
  await panel
    .getByRole("button", { name: "62.5% progress", exact: true })
    .click();
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

test("Design is the first labeled tool and its five layouts redraw the map without changing its content", async ({
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
  const search = page.getByRole("button", { name: "Search", exact: true });
  await expect(search).toBeVisible();
  await expect(search).toHaveText("");
  await expect(page.locator("#rail [data-map-search]")).toHaveCount(0);
  const searchBox = await search.boundingBox(),
    railBox = await page.locator("#rail").boundingBox();
  expect(searchBox!.x + searchBox!.width).toBeLessThan(railBox!.x);
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
