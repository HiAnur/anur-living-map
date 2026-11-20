import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  openSample,
  SAMPLE,
  server,
  useTeamServer,
} from "./team-map.harness.ts";

useTeamServer();

const fileMore = (page: Page, name: string) =>
  page.locator(`#files-tree [data-file-more="${name}"]`);
const fileLink = (page: Page, name: string) =>
  page.locator(`#files-tree [data-file="${name}"] a`);

test("Duplicate opens a separate map with the same boxes and leaves the original unchanged", async ({
  page,
}) => {
  const original = await openSample(page);
  const state = await (
    await page.request.get(`${server.origin}/${original}/api/state`)
  ).json();
  await page.goto(`${server.origin}/`);
  await fileMore(page, original).click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/");
  expect(new URL(page.url()).pathname).not.toBe(`/${original}/`);
  await expect(page.locator("#nodes .node")).toHaveCount(4);
  const copyUrl = new URL(page.url());
  copyUrl.search = "";
  const copy = await (await page.request.get(`${copyUrl}api/state`)).json();
  expect(copy.title).toBe("Launch plan (copy)");
  expect(copy.nodes).toEqual(state.nodes);
  expect(copy.edges).toEqual(state.edges);
  const renamed = await page.request.post(`${copyUrl}api/act`, {
    data: {
      type: "renamebox",
      id: "pricing",
      label: "Only in the copy",
      by: "Duy",
    },
  });
  expect(renamed.ok()).toBe(true);
  const edited = await (await page.request.get(`${copyUrl}api/state`)).json();
  expect(
    edited.nodes.find((n: { id: string }) => n.id === "pricing").label,
  ).toBe("Only in the copy");
  const unchanged = await (
    await page.request.get(`${server.origin}/${original}/api/state`)
  ).json();
  expect(
    unchanged.nodes.find((n: { id: string }) => n.id === "pricing").label,
  ).toBe("Pricing");
  await page.goto(`${server.origin}/`);
  await expect(fileLink(page, original)).toBeVisible();
  await expect(fileLink(page, copyUrl.pathname.split("/")[1])).toContainText(
    "Launch plan (copy)",
  );
});

test("a failed duplicate explains the failure and lets you retry", async ({
  page,
}) => {
  const original = await openSample(page, { ...SAMPLE, title: "Retry a copy" });
  await page.goto(`${server.origin}/`);
  await page.route("**/api/maps/duplicate", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Could not duplicate the map. Try again.",
      }),
    }),
  );
  await fileMore(page, original).click();
  const button = page.getByRole("button", { name: "Duplicate", exact: true });
  await button.click();
  await expect(page.locator("#file-info [role=alert]")).toHaveText(
    "Could not duplicate the map. Try again.",
  );
  await expect(button).toBeEnabled();
  await expect(page).toHaveURL(`${server.origin}/`);
});

test("file actions stay reachable by keyboard on a narrow screen", async ({
  page,
}) => {
  const original = await openSample(page, { ...SAMPLE, title: "Mobile copy" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.origin}/`);
  await expect(
    page.getByRole("button", { name: "Duplicate", exact: true }),
  ).toHaveCount(0);
  await fileMore(page, original).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Copy folder location", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Bookmark", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Move to folder", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Duplicate", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => url.pathname !== "/");
  expect(new URL(page.url()).pathname).not.toBe(`/${original}/`);
});

test("the home page uses the sidebar for files and keeps storage and system details in file information", async ({
  page,
}) => {
  const original = await openSample(page, {
    ...SAMPLE,
    title: "A calmer list",
  });
  const files = [
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
      title: "Another map",
      href: "/another/",
      at: Date.now(),
      shared: true,
      cloud: false,
      boxes: 0,
      open: 0,
      deletable: true,
    },
  ];
  // These storage indicators stand in for cloud metadata; no map is uploaded.
  await page.route("**/api/maps", (route) => route.fulfill({ json: files }));
  await page.route("**/api/library", (route) =>
    route.fulfill({
      json: {
        revision: 0,
        folders: [],
        files: files.map((f) => ({ ...f, parent: "", view: "map" })),
      },
    }),
  );
  await page.goto(`${server.origin}/`);
  await expect(page.locator("main a.map")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Or pick a map you have", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Sort files", { exact: true })).toBeVisible();
  await expect(page.locator("#brain")).toContainText("1 to answer");
  const row = page.locator(`#files-tree [data-file="${original}"]`);
  await expect(
    row.getByRole("img", { name: "Stored in the cloud", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#file-info")).toHaveCount(0);
  await fileMore(page, original).click();
  const details = page.locator("#file-info");
  for (const text of [
    "System map",
    "2 repos · Drawn 2d ago",
    "Shared by link",
    "A copy is stored in the cloud.",
    `…/maps/${original}`,
  ])
    await expect(details).toContainText(text);
  await expect(details).not.toContainText(/boxes|to answer/);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(fileMore(page, original)).toBeFocused();
  await fileMore(page, original).click();
  await fileMore(page, "another").click();
  await expect(details).toHaveAttribute(
    "aria-label",
    "Another map details and actions",
  );
  await page
    .getByRole("heading", { name: "Start a new map", exact: true })
    .click();
  await expect(details).toHaveCount(0);
});

test("Trash and Undo work from the file actions menu", async ({ page }) => {
  const original = await openSample(page, {
    ...SAMPLE,
    title: "Recover a map",
  });
  await page.goto(`${server.origin}/`);
  const more = fileMore(page, original);
  await more.click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(more).toHaveCount(0);
  await page
    .locator("#file-notice")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(more).toBeVisible();
});

test("bookmarks appear only after bookmarking a file and persist until removed", async ({
  page,
}) => {
  const original = await openSample(page, {
    ...SAMPLE,
    title: "Save this file",
  });
  await page.goto(`${server.origin}/`);
  const saved = page.locator(`.files-bookmarks [data-file="${original}"]`);
  await expect(saved).toHaveCount(0);
  await fileMore(page, original).click();
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await expect(saved).toBeVisible();
  await expect(fileMore(page, original)).toBeFocused();
  await page.reload();
  await expect(saved).toBeVisible();
  await fileMore(page, original).click();
  await page
    .getByRole("button", { name: "Remove bookmark", exact: true })
    .click();
  await expect(saved).toHaveCount(0);
  await expect(fileMore(page, original)).toBeFocused();
  await page.reload();
  await expect(fileLink(page, original)).toBeVisible();
  await expect(saved).toHaveCount(0);
});

test("file information shows and copies the folder holding each named or project map", async ({
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
  const namedFolder = path.join(server.root, "app", "maps", original);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${server.origin}/`);
  for (const [name, expected] of [
    [original, namedFolder],
    [projectMap.name, folder],
  ]) {
    await fileMore(page, name).click();
    const details = page.locator("#file-info");
    const shortPath = `…/${expected.split(/[\\/]/).filter(Boolean).slice(-2).join("/")}`;
    await expect(details.locator(".file-location code")).toHaveText(shortPath);
    await expect(details.locator(".file-location code")).toHaveAttribute(
      "title",
      expected,
    );
    await details
      .getByRole("button", { name: "Copy folder location", exact: true })
      .click();
    await expect(
      details.getByRole("button", { name: "Copied", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      expected,
    );
    expect(fs.existsSync(path.join(expected, "state.json"))).toBe(true);
    await page.keyboard.press("Escape");
  }
});
