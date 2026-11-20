import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  openSample,
  SAMPLE,
  server,
  useTeamServer,
} from "./team-map.harness.ts";
import { noteBody } from "./team-note.harness.ts";

useTeamServer();

test("the title shows cloud and edit age, and information offers the file actions and Bookmark", async ({
  page,
}) => {
  const now = Date.now();
  const name = await openSample(page, {
    ...SAMPLE,
    title: "Cloud plan",
    createdAt: now - 3 * 86400000,
    modifiedAt: now - 2 * 3600000,
  });
  // Cloud storage is a stand-in in this UI test; no map is uploaded.
  await page.route("**/api/library", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const r = await route.fetch({
      headers: {
        ...route.request().headers(),
        "sec-fetch-site": "same-origin",
      },
    });
    const data = await r.json();
    data.files = data.files.map((f: { name: string }) =>
      f.name === name ? { ...f, cloud: true, shared: true } : f,
    );
    await route.fulfill({ response: r, json: data });
  });
  await page
    .getByRole("button", { name: "Refresh files", exact: true })
    .click();
  await expect(
    page
      .locator("#file-meta")
      .getByRole("img", { name: "Stored in the cloud", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#file-meta .file-edited")).toHaveText("2h");
  await page
    .getByRole("button", { name: "File information", exact: true })
    .click();
  const info = page.getByRole("region", {
    name: "Cloud plan details and actions",
    exact: true,
  });
  await expect(info).toContainText("A copy is stored in the cloud.");
  await expect(info).toContainText("Shared by link");
  for (const action of [
    "Copy folder location",
    "Bookmark",
    "Move to folder",
    "Duplicate",
    "Move to Trash",
  ])
    await expect(
      info.getByRole("button", { name: action, exact: true }),
    ).toBeVisible();
  await info.getByRole("button", { name: "Bookmark", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Bookmarks", exact: true })
      .or(page.locator(".files-bookmarks")),
  ).toContainText("Cloud plan");
  await page.reload();
  await expect(page.locator(".files-bookmarks a")).toContainText([
    "Cloud plan",
  ]);
  for (const width of [840, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const title = await page.locator("#crumbs .nm").boundingBox(),
      meta = await page.locator("#file-meta").boundingBox();
    expect(title).not.toBeNull();
    expect(meta).not.toBeNull();
    expect(title!.x + title!.width).toBeLessThanOrEqual(meta!.x + 1);
    expect(meta!.x + meta!.width).toBeLessThanOrEqual(width);
    await expect(
      page.getByRole("button", { name: "File information", exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole("button", { name: "File information", exact: true })
    .click();
  await page.screenshot({
    path: test.info().outputPath("file-information.png"),
  });
  await page
    .getByRole("button", { name: "Remove bookmark", exact: true })
    .click();
  await expect(page.locator(".files-bookmarks a")).toHaveCount(0);
});

test("all six sort orders apply to the tree and Bookmarks and survive reopening", async ({
  page,
}) => {
  const now = Date.now(),
    stem = `sort-${test
      .info()
      .testId.replace(/[^a-z0-9]/gi, "")
      .toLowerCase()}`;
  const entries = [
    { title: "Alpha", at: 2, created: 3 },
    { title: "Beta", at: 3, created: 1 },
    { title: "Gamma", at: 1, created: 2 },
  ];
  for (const [i, e] of entries.entries()) {
    const dir = path.join(server.root, "app", "maps", `${stem}-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({
        ...SAMPLE,
        title: e.title,
        createdAt: now - (4 - e.created) * 86400000,
        modifiedAt: now - (4 - e.at) * 3600000,
      }),
    );
  }
  await page.goto(server.origin);
  // Keep these orders focused on this test's three actual sample files, regardless of other maps in this worker.
  await page.route("**/api/library", async (route) => {
    const r = await route.fetch({
        headers: {
          ...route.request().headers(),
          "sec-fetch-site": "same-origin",
        },
      }),
      data = await r.json();
    data.files = data.files.filter((f: { name: string }) =>
      f.name.startsWith(stem),
    );
    await route.fulfill({ response: r, json: data });
  });
  await page
    .getByRole("button", { name: "Refresh files", exact: true })
    .click();
  const orders = {
    "name-asc": ["Alpha", "Beta", "Gamma"],
    "name-desc": ["Gamma", "Beta", "Alpha"],
    "modified-desc": ["Beta", "Alpha", "Gamma"],
    "modified-asc": ["Gamma", "Alpha", "Beta"],
    "created-desc": ["Alpha", "Gamma", "Beta"],
    "created-asc": ["Beta", "Gamma", "Alpha"],
  };
  for (const [value, expected] of Object.entries(orders)) {
    await page.getByLabel("Sort files", { exact: true }).selectOption(value);
    await expect(
      page.locator(
        "#files-tree > [data-file] .files-pick > span:first-of-type",
      ),
    ).toHaveText(expected);
  }
  await page.reload();
  await expect(page.getByLabel("Sort files", { exact: true })).toHaveValue(
    "created-asc",
  );
  for (const i of [0, 1, 2]) {
    const response = await page.request.post(`${server.origin}/api/maps/pin`, {
      data: { name: `${stem}-${i}`, pinned: true },
      headers: { origin: server.origin },
    });
    expect(response.ok()).toBe(true);
  }
  await page
    .getByRole("button", { name: "Refresh files", exact: true })
    .click();
  await expect(
    page.locator(".files-bookmarks .files-pick > span:first-of-type"),
  ).toHaveText(orders["created-asc"]);
  await page
    .getByLabel("Sort files", { exact: true })
    .selectOption("name-desc");
  await expect(page.getByLabel("Sort files", { exact: true })).toHaveValue(
    "name-desc",
  );
  await expect(
    page.locator(".files-bookmarks .files-pick > span:first-of-type"),
  ).toHaveText(orders["name-desc"]);
});

test("file information duplicates saved notes and Trash offers Undo", async ({
  page,
}) => {
  const name = await openSample(page, {
    ...SAMPLE,
    title: "A document to copy",
  });
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await noteBody(page, "pricing").fill("The saved copy includes this draft.");
  await page
    .getByRole("button", { name: "File information", exact: true })
    .click();
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== `/${name}/`);
  const copiedPath = new URL(page.url()).pathname;
  const copy = await (
    await page.request.get(`${server.origin}${copiedPath}api/state`)
  ).json();
  expect(copy.title).toBe("A document to copy (copy)");
  expect(copy.nodes.find((n: { id: string }) => n.id === "pricing").desc).toBe(
    "The saved copy includes this draft.",
  );
  await page
    .getByRole("button", { name: "File information", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page.waitForURL(`${server.origin}/`);
  await expect(page.locator("#file-notice")).toContainText("Moved");
  await page
    .locator("#file-notice")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(page.locator("#file-notice")).toContainText("File restored.");
  expect(
    (await page.request.get(`${server.origin}${copiedPath}api/state`)).ok(),
  ).toBe(true);
});

test("Trash stays available after reload and restores a file to its folder and Bookmarks", async ({
  page,
}) => {
  const title = "A file to restore",
    name = await openSample(page, { ...SAMPLE, title });
  const readLibrary = async () =>
    (
      await page.request.get(`${server.origin}/api/library`, {
        headers: { "sec-fetch-site": "same-origin" },
      })
    ).json();
  const library = await readLibrary();
  const folderResponse = await page.request.post(
    `${server.origin}/api/library`,
    {
      headers: { origin: server.origin },
      data: {
        op: "createfolder",
        title: "restore here",
        revision: library.revision,
      },
    },
  );
  expect(folderResponse.ok()).toBe(true);
  const folder = await folderResponse.json();
  const moved = await page.request.post(`${server.origin}/api/library`, {
    headers: { origin: server.origin },
    data: {
      op: "movefile",
      name,
      parent: folder.id,
      revision: library.revision + 1,
    },
  });
  expect(moved.ok()).toBe(true);
  expect(
    (
      await page.request.post(`${server.origin}/api/maps/pin`, {
        headers: { origin: server.origin },
        data: { name, pinned: true },
      })
    ).ok(),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Refresh files", exact: true })
    .click();
  await page
    .getByRole("button", { name: "File information", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await page.waitForURL(`${server.origin}/`);
  await page.getByRole("link", { name: "Trash", exact: true }).click();
  await expect(page.locator(`[data-trashed-file="${name}"]`)).toBeVisible();
  await expect(
    page.locator(`.files-bookmarks [data-file="${name}"]`),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Trash", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#files-pane [data-trashed-file]")).toHaveCount(0);
  const restore = page.getByRole("button", {
    name: `Restore ${title}`,
    exact: true,
  });
  await expect(restore).toBeInViewport();
  await page.screenshot({
    path: test.info().outputPath("files-and-trash.png"),
  });
  await page.route("**/api/maps/restore", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Your file is kept. Try again." },
    }),
  );
  await restore.click();
  await expect(page.locator("#files-trash-error")).toHaveText(
    "Your file is kept. Try again.",
  );
  await expect(restore).toBeEnabled();
  await page.unroute("**/api/maps/restore");
  await restore.click();
  await expect(page.locator(`[data-trashed-file="${name}"]`)).toHaveCount(0);
  await expect(page.locator("#file-notice")).toContainText("File restored.");
  await expect(
    page.locator(`.files-bookmarks [data-file="${name}"]`),
  ).toBeVisible();
  expect(
    (await readLibrary()).files.find((f: { name: string }) => f.name === name)
      .parent,
  ).toBe(folder.id);
  const state = await (
    await page.request.get(`${server.origin}/${name}/api/state`)
  ).json();
  expect(state.nodes.map((n: { id: string }) => n.id)).toEqual(
    SAMPLE.nodes.map((n) => n.id),
  );
  await page.screenshot({
    path: test.info().outputPath("restored-file.png"),
  });
});

test("Trash opens in the middle, saves a note before leaving it and keeps long lists clear on a narrow screen", async ({
  page,
}) => {
  const name = await openSample(page, { ...SAMPLE, title: "Keep my note" });
  for (let i = 0; i < 30; i++) {
    const slug = `trash-layout-${i}`,
      title = `Saved map ${String(i + 1).padStart(2, "0")}`;
    const archive = path.join(server.root, "app", "maps", ".deleted", slug);
    fs.mkdirSync(archive, { recursive: true });
    fs.writeFileSync(
      path.join(archive, "state.json"),
      JSON.stringify({ ...SAMPLE, title, admins: ["Duy"] }),
    );
    fs.writeFileSync(
      path.join(archive, "trash.json"),
      JSON.stringify({ name: slug, project: "", at: Date.now() - i * 60000 }),
    );
  }
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await noteBody(page, "pricing").fill("Keep this draft when I open Trash.");
  await page.getByRole("link", { name: "Trash", exact: true }).click();
  await expect(page).toHaveURL(/\?folder=trash$/);
  const middle = page.locator("#files-trash-view"),
    sidebar = page.locator("#files-pane");
  await expect(
    middle.locator('[data-trashed-file^="trash-layout-"]'),
  ).toHaveCount(30);
  await expect(sidebar.locator("[data-restore-file]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Start a new map", exact: true }),
  ).toBeHidden();
  const heading = middle.getByRole("heading", { name: "Trash", exact: true });
  const headerBounds = await heading.boundingBox(),
    firstBounds = await middle
      .locator('[data-trashed-file="trash-layout-0"]')
      .boundingBox();
  expect(firstBounds!.y).toBeGreaterThan(
    headerBounds!.y + headerBounds!.height,
  );
  const last = middle.getByRole("button", {
    name: "Restore Saved map 30",
    exact: true,
  });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const saved = await (
    await page.request.get(`${server.origin}/${name}/api/state`)
  ).json();
  expect(saved.nodes.find((n: { id: string }) => n.id === "pricing").desc).toBe(
    "Keep this draft when I open Trash.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(middle).toBeVisible();
  await expect(sidebar).toBeHidden();
  await heading.scrollIntoViewIfNeeded();
  const bounds = await middle.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await middle
    .getByRole("link", { name: "Back to files", exact: true })
    .click();
  await expect(page).toHaveURL(`${server.origin}/`);
  await expect(
    page.getByRole("heading", { name: "Start a new map", exact: true }),
  ).toBeVisible();
});
