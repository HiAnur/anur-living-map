import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  openSample,
  SAMPLE,
  server,
  useTeamServer,
} from "./team-map.harness.ts";
import { noteBody, noteInput } from "./team-note.harness.ts";

useTeamServer();

function another(name: string, title: string) {
  const state = {
    ...SAMPLE,
    title,
    admins: ["Duy"],
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "pricing" ? { ...n, label: title } : { ...n },
    ),
  };
  const folder = path.join(server.root, "app", "maps", name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "state.json"), JSON.stringify(state));
  return state;
}
const link = (page: Page, name: string) =>
  page.locator(`#files-tree [data-file="${name}"] a`);
const state = async (page: Page, name: string) =>
  (await page.request.get(`${server.origin}/${name}/api/state`)).json();
const refresh = (page: Page) =>
  page.getByRole("button", { name: "Refresh files", exact: true }).click();

test("file switching saves the right notes and keeps the sidebar and editor mounted through Back and Forward", async ({
  page,
}) => {
  const first = await openSample(page),
    second = `${first}-second`;
  another(second, "Second file");
  await page.evaluate(
    (second) => localStorage.setItem(`lm.mind-layout:/${second}/`, "left"),
    second,
  );
  await refresh(page);
  await page.evaluate(() => {
    document.body.dataset.fileSwitchMarker = "kept";
    document.getElementById("files-pane")!.dataset.fileSwitchMarker = "kept";
    document.getElementById("document-tabs")!.dataset.fileSwitchMarker = "kept";
  });
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await noteBody(page, "pricing").fill("This belongs to the first file.");
  await link(page, second).click();
  await expect(page.locator("#crumbs .nm")).toHaveText("Second file");
  await expect
    .poll(async () => (await state(page, second)).mindLayout)
    .toBe("left");
  await expect(page.locator("body")).toHaveAttribute(
    "data-file-switch-marker",
    "kept",
  );
  await expect(page.locator("#files-pane")).toHaveAttribute(
    "data-file-switch-marker",
    "kept",
  );
  await expect(page.locator("#document-tabs")).toHaveAttribute(
    "data-file-switch-marker",
    "kept",
  );
  expect(
    (await state(page, first)).nodes.find(
      (n: { id: string }) => n.id === "pricing",
    ).desc,
  ).toBe("This belongs to the first file.");
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await noteBody(page, "pricing").fill("This belongs to the second file.");
  await page.goBack();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Launch plan",
  );
  await expect(noteBody(page, "pricing")).toHaveText(
    "This belongs to the first file.",
  );
  expect(
    (await state(page, second)).nodes.find(
      (n: { id: string }) => n.id === "pricing",
    ).desc,
  ).toBe("This belongs to the second file.");
  await page.goForward();
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Second file",
  );
  await expect(noteBody(page, "pricing")).toHaveText(
    "This belongs to the second file.",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-file-switch-marker",
    "kept",
  );
  await page.request.post(`${server.origin}/${first}/api/act`, {
    data: {
      type: "renamebox",
      id: "pricing",
      label: "Changed in first file",
      by: "Duy",
    },
  });
  await expect(page.getByLabel("Note title", { exact: true })).toHaveValue(
    "Second file",
  );
  await link(page, first).click();
  await expect(page.locator("#crumbs .nm")).toHaveText("Launch plan");
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  await expect(noteBody(page, "pricing")).toHaveText(
    "This belongs to the first file.",
  );
});

test("the latest file click wins when another file is still connecting", async ({
  page,
}) => {
  const first = await openSample(page),
    second = `${first}-slow`,
    third = `${first}-third`;
  const slow = another(second, "Slow file");
  another(third, "Latest file");
  await refresh(page);
  let release!: () => void, entered!: () => void, finished!: () => void;
  const held = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    }),
    done = new Promise<void>((r) => {
      finished = r;
    });
  await page.route(`**/${second}/api/events`, async (route) => {
    entered();
    await held;
    try {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `event: state\ndata: ${JSON.stringify(slow)}\n\n`,
      });
    } catch {
      /* choosing the third file cancels this connection */
    } finally {
      finished();
    }
  });
  await page.evaluate(() => {
    document.body.dataset.fileSwitchMarker = "kept";
  });
  await link(page, second).click();
  await started;
  await link(page, third).click();
  await expect(page.locator("#crumbs .nm")).toHaveText("Latest file");
  release();
  await done;
  await expect(page.locator("#crumbs .nm")).toHaveText("Latest file");
  await expect(page.locator("body")).toHaveAttribute(
    "data-file-switch-marker",
    "kept",
  );
  await expect(link(page, third)).toHaveAttribute("aria-current", "page");
});

test("a failed file connection leaves the current file open and connected", async ({
  page,
}) => {
  const first = await openSample(page),
    second = `${first}-missing`;
  another(second, "Unavailable file");
  await refresh(page);
  await page.route(`**/${second}/api/events`, (route) =>
    route.fulfill({ status: 403, body: "Unavailable" }),
  );
  await link(page, second).click();
  await expect(page.locator("#toast")).toContainText(
    "This file could not be opened",
  );
  await expect(page.locator("#crumbs .nm")).toHaveText("Launch plan");
  await expect(page).toHaveURL(new RegExp(`/${first}/`));
  await page.request.post(`${server.origin}/${first}/api/act`, {
    data: {
      type: "renamebox",
      id: "pricing",
      label: "Still connected",
      by: "Duy",
    },
  });
  await expect(
    page.locator("#nodes .node", { hasText: "Still connected" }),
  ).toBeVisible();
});

test("the header keeps Save and the sidebar toggle fixed while Map and Note stay on the right", async ({
  page,
}) => {
  await openSample(page);
  const toggle = page.getByRole("button", {
    name: "Toggle files sidebar",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.locator("#files-pane [aria-controls='files-pane']"),
  ).toHaveCount(0);
  const mapSave = await page
    .getByRole("button", { name: "Save", exact: true })
    .boundingBox();
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox!.x + toggleBox!.width).toBeLessThan(mapSave!.x);
  await toggle.click();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("complementary", { name: "Files", exact: true }),
  ).toBeHidden();
  await toggle.click();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("tab", { name: "Note", exact: true }).click();
  const saveNote = page.getByRole("button", { name: "Save note", exact: true });
  await expect(saveNote).toHaveText("Save");
  const noteSave = await saveNote.boundingBox();
  expect(noteSave!.x).toBe(mapSave!.x);
  expect(noteSave!.width).toBe(mapSave!.width);
  const pricing = await noteBody(page, "pricing").boundingBox(),
    trial = await noteBody(page, "trial").boundingBox();
  expect(pricing!.x).toBe(trial!.x);
  const top = await page.locator("#top").boundingBox(),
    tabs = await page.locator("#document-tabs").boundingBox(),
    heading = await page.locator("#file-heading").boundingBox();
  expect(tabs!.y).toBeGreaterThanOrEqual(top!.y);
  expect(tabs!.y + tabs!.height).toBeLessThanOrEqual(top!.y + top!.height);
  expect(tabs!.x).toBeGreaterThanOrEqual(heading!.x + heading!.width);
  await expect(page.locator("#top #map-query")).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("top-bar-and-note.png"),
  });
  await page.setViewportSize({ width: 800, height: 950 });
  const narrowTitle = await page
      .getByLabel("Note title", { exact: true })
      .boundingBox(),
    sidebar = await page.locator("#files-pane").boundingBox();
  expect(narrowTitle!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Search map", exact: true })
    .fill("fourteen");
  await expect(page.locator("#search-results")).toContainText("Free trial");
  await page.keyboard.press("Enter");
  await expect(noteInput(page)).toBeFocused();
  await expect(page.locator("#map-search")).toBeHidden();
});
