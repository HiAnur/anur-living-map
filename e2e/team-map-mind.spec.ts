import { expect, test, type Locator } from "@playwright/test";

import { box, openSample, useTeamServer } from "./team-map.harness.ts";

useTeamServer();

test("remembers the last map view across local addresses", async ({ page }) => {
  await openSample(page);
  const map = new URL(page.url());
  const view = (name: string) => page.getByRole("radio", { name, exact: true });
  const openMenu = () => page.locator("#peopleb").click();
  const saved = () =>
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/me/map-view",
    );

  await openMenu();
  await expect(view("Engineer")).toHaveAttribute("aria-checked", "true");

  // Import the PM choice kept by an older version on this address.
  await page.evaluate(() => localStorage.setItem("lm.view", "pm"));
  const imported = saved();
  await page.reload();
  expect((await imported).ok()).toBe(true);
  await expect(page.locator("body")).toHaveClass(/mind-view/);

  const other = new URL(map);
  other.hostname = "127.0.0.1";
  await page.goto(other.href);
  await expect(page.locator("body")).toHaveClass(/mind-view/);
  await openMenu();
  await expect(view("PM")).toHaveAttribute("aria-checked", "true");

  const engineer = saved();
  await view("Engineer").click();
  expect((await engineer).ok()).toBe(true);
  await page.goto(map.href);
  await openMenu();
  await expect(view("Engineer")).toHaveAttribute("aria-checked", "true");

  const pm = saved();
  await view("PM").click();
  expect((await pm).ok()).toBe(true);
  await page.goto(other.href);
  await expect(page.locator("body")).toHaveClass(/mind-view/);
});

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
  const root = page.locator("#nodes .mind-root");
  await expect(root).toHaveText("Launch plan");
  await expect(root).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(root).toHaveCSS("border-radius", "999px");
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
