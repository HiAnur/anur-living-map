import { expect, test, type Locator } from "@playwright/test";

import { box, openSample, useTeamServer } from "./team-map.harness.ts";

useTeamServer();

const middle = (node: Locator) =>
  node.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

test("repeated Tab extends a PM branch horizontally without moving it down", async ({
  page,
}) => {
  await openSample(page);
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "PM", exact: true }).click();
  await expect(page.locator("#nodes .fold")).toHaveCount(0);
  const parent = box(page, "Free trial");
  await parent.click();
  await expect(parent).toHaveClass(/sel/);
  const start = await middle(parent);
  const editor = page.locator("#newbox.on");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await expect(editor).toBeVisible();
    await expect(page.locator(".mind-pending")).toHaveCount(0);
    const at = await middle(editor);
    expect(Math.abs(at.y - start.y), `draft after Tab ${i + 1}`).toBeLessThan(
      2,
    );
    expect(
      Math.abs((await middle(parent)).y - start.y),
      `parent after Tab ${i + 1}`,
    ).toBeLessThan(2);
    expect(at.x).toBeGreaterThan((await middle(parent)).x);
    const bounds = await editor.boundingBox();
    const canvas = await page.locator("#canvas").boundingBox();
    expect(bounds).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      canvas!.x + canvas!.width - 15,
    );
  }
});
