import { expect, test } from "@playwright/test";

import { openSample, SAMPLE, useTeamServer } from "./team-map.harness.ts";

useTeamServer();

const reading = {
  ...SAMPLE,
  nodes: SAMPLE.nodes.map((n) => ({
    ...n,
    label:
      {
        launch: "Reading",
        pricing: "Categories",
        audience: "Books",
        trial: "Personal Growth",
      }[n.id] || n.label,
  })),
  edges: [
    { from: "launch", to: "pricing" },
    { from: "pricing", to: "audience" },
    { from: "audience", to: "trial" },
  ],
};

for (const layout of ["right", "left"]) {
  test(`PM ${layout} branches collapse, remember nested folds and reopen`, async ({
    page,
  }) => {
    await openSample(page, reading);
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.locator(`[data-mind-layout="${layout}"]`).click();
    await page.getByRole("button", { name: "Design", exact: true }).click();
    const books = page.locator('#nodes [data-id="audience"]');
    const growth = page.locator('#nodes [data-id="trial"]');
    const collapse = page.getByRole("button", {
      name: "Collapse Books",
      exact: true,
    });
    await expect(books).toHaveClass(/mind-leaf/);
    await expect(collapse).toHaveCSS("opacity", "1");
    await expect(collapse).toHaveClass(
      new RegExp(`fold ${layout === "left" ? "l" : "r"}`),
    );
    const topic = await books.boundingBox(),
      button = await collapse.boundingBox();
    const categories = await page
      .locator('#nodes [data-id="pricing"]')
      .boundingBox();
    expect(
      Math.abs(
        categories!.y + categories!.height / 2 - topic!.y - topic!.height,
      ),
    ).toBeLessThan(2);
    expect(
      Math.abs(button!.y + button!.height / 2 - topic!.y - topic!.height),
    ).toBeLessThan(2);
    await collapse.click();
    await expect(growth).toHaveCount(0);
    const expand = page.getByRole("button", {
      name: "Expand Books: show 1 hidden topic",
      exact: true,
    });
    await expect(expand).toHaveText("1");
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(expand).toBeFocused();
    await page.keyboard.press("Space");
    await expect(growth).toBeVisible();
    await expect(collapse).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(growth).toHaveCount(0);
    await page
      .getByRole("button", { name: "Collapse Categories", exact: true })
      .click();
    await expect(books).toHaveCount(0);
    await page.reload();
    const expandCategories = page.getByRole("button", {
      name: "Expand Categories: show 2 hidden topics",
      exact: true,
    });
    await expect(expandCategories).toHaveText("2");
    await expandCategories.click();
    await expect(expand).toBeVisible();
    await expect(growth).toHaveCount(0);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Search map").fill("Personal Growth");
    await page.keyboard.press("Enter");
    await expect(growth).toBeVisible();
    await expect(collapse).toBeVisible();
    await page.getByRole("button", { name: "Reset zoom", exact: true }).click();
    await page
      .getByRole("button", { name: "Collapse Categories", exact: true })
      .click();
    await expect(growth).toHaveCount(0);
    await page.locator("#peopleb").click();
    await page.getByRole("radio", { name: "Engineer", exact: true }).click();
    await expect(growth).toHaveCount(1);
    await page.getByRole("radio", { name: "PM", exact: true }).click();
    await expect(growth).toHaveCount(0);
  });
}

test("adding a PM child expands its collapsed parent", async ({ page }) => {
  await openSample(page, reading);
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "PM", exact: true }).click();
  await page
    .getByRole("button", { name: "Collapse Books", exact: true })
    .click();
  await page.locator('#nodes [data-id="audience"] .nt').click();
  await page.keyboard.press("Tab");
  await expect(page.locator("#newbox.on")).toBeVisible();
  await expect(page.locator('#nodes [data-id="trial"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collapse Books", exact: true }),
  ).toBeVisible();
});
