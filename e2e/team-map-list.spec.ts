import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  openSample,
  SAMPLE,
  server,
  useTeamServer,
} from "./team-map.harness.ts";

useTeamServer();

test("More keeps actions hidden and reachable by keyboard on a narrow screen", async ({
  page,
}) => {
  const original = await openSample(page, { ...SAMPLE, title: "Mobile menu" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.origin}/`);
  const row = page.locator(".row", {
    has: page.locator(`[data-map-menu="${original}"]`),
  });
  await expect(row.locator(".del")).toBeHidden();
  const edited = await row.locator(".last-edit").boundingBox();
  const more = await row.locator(".map-more").boundingBox();
  expect(edited).not.toBeNull();
  expect(more).not.toBeNull();
  expect(edited!.x + edited!.width).toBeLessThanOrEqual(more!.x);
  await row.locator(".map-more").focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    row.getByRole("button", { name: "Copy folder location", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(row.locator("[data-pin]")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(row.locator(".del")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(row.locator(".map-more")).toBeFocused();
  await expect(row.locator(".map-menu")).toBeHidden();
});

test("rows show pending answers without box counts, and keep other details under More", async ({
  page,
}) => {
  const original = await openSample(page, {
    ...SAMPLE,
    title: "A calmer list",
  });
  await page.route("**/api/maps", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          name: original,
          title: "A calmer list",
          href: `/${original}/`,
          at: Date.now() - 86400000,
          boxes: 4,
          open: 1,
          system: "done",
          repos: 2,
          drawn: Date.now() - 172800000,
          shared: true,
          cloud: true,
          folder: path.join(server.root, "app", "maps", original),
          deletable: true,
        },
        {
          name: "another",
          pinned: true,
          title: "Another map",
          shared: true,
          cloud: false,
          href: "/another/",
          at: Date.now(),
          boxes: 0,
          deletable: true,
        },
      ]),
    }),
  );
  await page.goto(`${server.origin}/`);
  const row = page.locator(".row", {
    has: page.locator(`[data-map-menu="${original}"]`),
  });
  const more = row.locator(".map-more"),
    details = row.locator(".map-menu");
  await expect(row.locator(".last-edit")).toHaveText("1d");
  await expect(row.locator(".pin")).toHaveCount(0);
  await expect(row.locator(".map-name")).toHaveText("A calmer list");
  await expect(row.locator(".map-name .map-cloud")).toHaveCount(0);
  const pendingBounds = await row.locator(".map-pending").boundingBox();
  const timeBounds = await row.locator(".last-edit").boundingBox();
  const cloudBounds = await row.locator(".map-cloud").boundingBox();
  expect(pendingBounds!.x + pendingBounds!.width).toBeLessThanOrEqual(
    cloudBounds!.x,
  );
  expect(cloudBounds!.x + cloudBounds!.width).toBeLessThanOrEqual(
    timeBounds!.x,
  );
  const midpoints = [pendingBounds!, timeBounds!, cloudBounds!].map(
    (b) => b.y + b.height / 2,
  );
  expect(Math.max(...midpoints) - Math.min(...midpoints)).toBeLessThan(2);
  await expect(
    row.getByRole("img", { name: "Stored in the cloud" }),
  ).toBeVisible();
  const cloud = row.getByRole("img", { name: "Stored in the cloud" });
  await cloud.hover();
  await expect(cloud.getByRole("tooltip")).toBeVisible();
  await expect(cloud.getByRole("tooltip")).toHaveText(
    "A copy of this map is stored in the cloud.",
  );
  await row.locator(".map-name").hover();
  await expect(cloud.getByRole("tooltip")).toBeHidden();
  await expect(row.locator(".map-pending")).toHaveText("1 to answer");
  const editedColor = await row
    .locator(".last-edit")
    .evaluate((element) => getComputedStyle(element).color);
  await expect(row.locator(".map-pending")).not.toHaveCSS("color", editedColor);
  await expect(page.locator("#brain")).toContainText("1 to answer");
  await expect(page.locator(".home")).not.toContainText(/\d+ boxes/);
  const clearRow = page.locator(".row", {
    has: page.locator('[data-map-menu="another"]'),
  });
  await expect(clearRow.locator(".map-pending")).toHaveCount(0);
  await expect(
    clearRow.getByRole("img", { name: "Pinned", exact: true }),
  ).toBeVisible();
  const clearTimeBounds = await clearRow.locator(".last-edit").boundingBox();
  expect(
    Math.abs(
      timeBounds!.x +
        timeBounds!.width -
        clearTimeBounds!.x -
        clearTimeBounds!.width,
    ),
  ).toBeLessThan(1);
  await expect(
    clearRow.getByRole("img", { name: "Stored in the cloud" }),
  ).toHaveCount(0);
  await expect(details).toBeHidden();
  await expect(row.locator(".del")).toBeHidden();
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  for (const text of [
    "System map",
    "2 repos · Drawn 2 d ago",
    "Shared by link",
    "Online copy stored in the cloud",
    `…/maps/${original}`,
  ])
    await expect(details).toContainText(text);
  await expect(details).not.toContainText(/boxes|to answer/);
  await expect(details.locator(".map-folder")).toContainText("Local folder");
  await expect(details.locator(".map-address")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await page.locator('[data-map-menu="another"]').click();
  await expect(details).toBeHidden();
  await expect(page.locator('[data-map-menu="another"]')).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.getByRole("heading", { name: "Or pick a map you have" }).click();
  await expect(page.locator(".map-menu:visible")).toHaveCount(0);
});

test("Trash and Undo still work from the More menu", async ({ page }) => {
  const original = await openSample(page, {
    ...SAMPLE,
    title: "Recover a map",
  });
  await page.goto(`${server.origin}/`);
  const more = page.locator(`[data-map-menu="${original}"]`);
  await more.click();
  await page.locator(`[data-trash="${original}"]`).click();
  await expect(more).toHaveCount(0);
  await page
    .locator("#trash-status")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(more).toBeVisible();
});

test("pin markers appear only after pinning from More, and Unpin removes them", async ({
  page,
}) => {
  const original = await openSample(page, {
    ...SAMPLE,
    title: "Pin from the menu",
  });
  await page.goto(`${server.origin}/`);
  const row = page.locator(".row", {
    has: page.locator(`[data-map-menu="${original}"]`),
  });
  const more = row.locator(".map-more");
  await expect(row.locator(".pin")).toHaveCount(0);
  await more.click();
  await row.getByRole("button", { name: "Pin to top", exact: true }).click();
  await expect(
    row.getByRole("img", { name: "Pinned", exact: true }),
  ).toBeVisible();
  await expect(more).toBeFocused();
  await page.reload();
  await expect(
    row.getByRole("img", { name: "Pinned", exact: true }),
  ).toBeVisible();
  await more.click();
  await row.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(row.locator(".pin")).toHaveCount(0);
  await expect(more).toBeFocused();
  await page.reload();
  await expect(row.locator("a.map")).toBeVisible();
  await expect(row.locator(".pin")).toHaveCount(0);
});

test("More shows and copies the folder holding each named or project map", async ({
  page,
  context,
}) => {
  const original = await openSample(page, {
    ...SAMPLE,
    title: "Find my map folder",
  });
  const project = path.join(server.root, "A project with spaces"),
    folder = path.join(project, ".living-map");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "state.json"),
    JSON.stringify({ ...SAMPLE, title: "Project map" }),
  );
  const added = await page.request.post(`${server.origin}/api/projects`, {
    data: { folder: project },
  });
  expect(added.ok()).toBe(true);
  const projectMap = await added.json();
  const list = await (
    await page.request.get(`${server.origin}/api/maps`)
  ).json();
  const namedFolder = path.join(server.root, "app", "maps", original);
  expect(list.find((m: { name: string }) => m.name === original).folder).toBe(
    namedFolder,
  );
  expect(
    list.find((m: { name: string }) => m.name === projectMap.name).folder,
  ).toBe(folder);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${server.origin}/`);
  for (const [name, expected] of [
    [original, namedFolder],
    [projectMap.name, folder],
  ]) {
    const row = page.locator(".row", {
      has: page.locator(`[data-map-menu="${name}"]`),
    });
    await row.locator(".map-more").click();
    const shortPath = `…/${expected.split(/[\\/]/).filter(Boolean).slice(-2).join("/")}`;
    await expect(row.locator(".map-folder-path")).toHaveText(shortPath);
    await expect(row.locator(".map-folder-path")).toHaveAttribute(
      "title",
      expected,
    );
    await row
      .getByRole("button", { name: "Copy folder location", exact: true })
      .click();
    await expect(
      row.getByRole("button", { name: "Copied", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      expected,
    );
    expect(fs.existsSync(path.join(expected, "state.json"))).toBe(true);
    await page.keyboard.press("Escape");
  }
});
