import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  SAMPLE,
  box,
  hub,
  openSample,
  server,
  useTeamServer,
} from "./team-map.harness.ts";

// The team map's page (team/live/index.html) on a copy of the team server with a sample topic map, driven the way
// you use it: what the unit tests that read the page's script cannot see.

useTeamServer();

test("draws the map's boxes and lines", async ({ page }) => {
  await openSample(page);
  await expect(page).toHaveTitle("Living Map · Launch plan");
  for (const name of ["Launch plan", "Pricing", "Audience", "Free trial"])
    await expect(box(page, name)).toBeVisible();
  await expect(page.locator("#edges path")).not.toHaveCount(0);
});

test("carries the HiAnur mark and Claude's own mark", async ({ page }) => {
  await openSample(page);
  // the tab icon and the top left: HiAnur's dark square with its light diamond
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    /^data:image\/svg\+xml,.*%231f1b14/,
  );
  await expect(page.locator("#top .brand")).toHaveText("Anur");
  // Claude's spark, never the old text star
  await expect(page.locator("#bot .claude-mark")).toBeVisible();
  await page.locator("#bot").click();
  await expect(page.locator("#chat .ct .claude-mark")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("\u2733");
});

test("Tab adds a topic under the selected box, and the map keeps it", async ({
  page,
}) => {
  const name = await openSample(page);
  await box(page, "Pricing").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("Annual plan");
  await page.keyboard.press("Enter");
  await expect(box(page, "Annual plan")).toBeVisible();
  await expect
    .poll(async () => {
      const state = await (
        await page.request.get(`${server.origin}/${name}/api/state`)
      ).json();
      return state.edges.map(
        (e: { from: string; to: string }) => `${e.from}>${e.to}`,
      );
    })
    .toContain("pricing>annual-plan");
});

test("search finds a box by its words, and Enter selects it", async ({
  page,
}) => {
  await openSample(page);
  await page.getByLabel("Search map").click();
  await page.keyboard.type("fourteen");
  await expect(page.locator("#search-results")).toContainText("Free trial");
  await page.keyboard.press("Enter");
  await expect(page.locator("#nodes .node.sel")).toHaveText(/Free trial/);
});

test("folding a box hides its branch", async ({ page }) => {
  await openSample(page);
  await box(page, "Pricing").getByText("−").click();
  await expect(box(page, "Free trial")).toHaveCount(0);
  await expect(box(page, "Audience")).toBeVisible();
});

test("someone with a view link, not signed in, sees the map", async ({
  page,
  browser,
}) => {
  const name = await openSample(page);
  const shared = await page.request.post(
    `${server.origin}/${name}/api/sharing`,
    {
      headers: { origin: server.origin, "content-type": "application/json" },
      data: { mode: "view" },
    },
  );
  expect(shared.ok()).toBe(true);
  const { token } = (await shared.json()) as { token: string };

  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  const errors: string[] = [];
  visitor.on("pageerror", (e) => errors.push(String(e)));
  await visitor.goto(`${server.origin}/${name}/?share=${token}`);
  for (const box_ of ["Launch plan", "Pricing", "Audience", "Free trial"])
    await expect(box(visitor, box_)).toBeVisible();
  expect(errors).toEqual([]);
  await guest.close();
});

test("the plan's go-ahead reads Build the plan", async ({ page }) => {
  await openSample(page, { ...SAMPLE, prompt: "Add billing" });
  await expect(page.locator("[data-execute]")).toHaveText("Build the plan");
  await expect(page.locator("body")).not.toContainText("Execute on Claude");
});

test("a comment thread opens from the Comments panel and takes a reply", async ({
  page,
}) => {
  await openSample(page, {
    ...SAMPLE,
    comments: [
      {
        id: 1,
        x: 300,
        y: -160,
        view: "system",
        node: "pricing",
        resolved: false,
        msgs: [{ who: "Ana", text: "Is @Duy on <annual> pricing?", at: 1 }],
      },
    ],
  });
  await page.locator('#rail [data-rail="comments"]').click();
  const item = page.locator('#cpanel [data-goto="1"]');
  await expect(item).toContainText("#1 · Pricing");
  await item.click();
  // the thread opens beside its pin, the mention marked and the words kept as written
  await expect(page.locator("#thread .th-body")).toContainText(
    "Is Duy on <annual> pricing?",
  );
  await expect(page.locator("#thread .at")).toHaveText("Duy");
  await page.locator("#thread .th-reply input").fill("Yes, both plans");
  await page.locator("#thread .th-reply input").press("Enter");
  await expect(page.locator("#thread .th-msg")).toHaveCount(2);
  await expect(item).toContainText("1 reply");
});

test("History shows an earlier version over the map, and goes back to now", async ({
  page,
}) => {
  await openSample(page);
  await box(page, "Pricing").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("Annual plan");
  await page.keyboard.press("Enter");
  await expect(box(page, "Annual plan")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('#rail [data-rail="history"]').click();
  const versions = page.locator("#hist [data-hver]");
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText("Now");
  await versions.last().click();
  // the earlier version shows over the live map, without the box added since
  await expect(page.locator("#histbar")).toContainText("Restore this version");
  await expect(box(page, "Annual plan")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to now" }).click();
  await expect(page.locator("#histbar")).not.toBeVisible();
  await expect(box(page, "Annual plan")).toBeVisible();
});

test("a box inside a box inside a box opens level by level, and Back goes up one", async ({
  page,
}) => {
  await openSample(page, {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "trial"
        ? {
            ...n,
            inside: {
              nodes: [
                {
                  id: "billing",
                  label: "Billing",
                  x: 0,
                  y: 0,
                  inside: {
                    nodes: [{ id: "charge", label: "Charge card", x: 0, y: 0 }],
                    edges: [],
                  },
                },
              ],
              edges: [],
            },
          }
        : n,
    ),
  });
  await page.locator('[data-expand="trial"]').click();
  await expect(box(page, "Billing")).toBeVisible();
  // inside a box, its first box keeps its name: only the map's own centre is a circle
  await expect(hub(page)).toHaveCount(0);
  await page.locator('[data-expand="billing"]').click();
  await expect(box(page, "Charge card")).toBeVisible();
  // the path shows every level, and each one goes back to it
  await expect(page.locator("#crumbs")).toContainText("Free trial");
  await expect(page.locator("#crumbs")).toContainText("Billing");
  await expect(page.locator("#backb")).toHaveText("‹ Back to Free trial");
  await page.locator("#backb").click();
  await expect(box(page, "Billing")).toBeVisible();
  await expect(page.locator("#backb")).toHaveText("‹ Back to the map");
  await page.locator('[data-expand="billing"]').click();
  await page.locator('#crumbs [data-enter="trial"]').click();
  await expect(box(page, "Billing")).toBeVisible();
});

test("Export image downloads the view as a picture", async ({ page }) => {
  await openSample(page);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(
    page.getByText("Only this Mac can open this link"),
  ).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-share-image]").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = path.join(server.root, "view.png");
  await download.saveAs(file);
  // a PNG, and not an empty one
  expect(fs.readFileSync(file).subarray(1, 4).toString()).toBe("PNG");
  expect(fs.statSync(file).size).toBeGreaterThan(1000);
});

test("Share as a file opens on its own, with no server", async ({
  page,
  browser,
}) => {
  await openSample(page);
  await page.getByRole("button", { name: "Share" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-share-file]").click(),
  ]);
  expect(download.suggestedFilename()).toBe("Launch plan.html");
  const file = path.join(server.root, "shared.html");
  await download.saveAs(file);

  const offline = await browser.newPage();
  const errors: string[] = [];
  offline.on("pageerror", (e) => errors.push(String(e)));
  // only the file itself, and the fonts it asks Google for, which it can do without
  await offline.route("**/*", (r) =>
    r.request().url().startsWith("file:") ? r.continue() : r.abort(),
  );
  await offline.goto(`file://${file}`);
  for (const name of ["Launch plan", "Pricing", "Audience", "Free trial"])
    await expect(box(offline, name)).toBeVisible();
  expect(errors).toEqual([]);
  await offline.close();
});

test("boxes show titles and reveal descriptions without moving on hover", async ({
  page,
}) => {
  await openSample(page);
  const pricing = box(page, "Pricing");
  await expect(pricing).not.toContainText("Plans and trials");
  const before = await pricing.boundingBox();
  await pricing.hover();
  const hint = page.getByRole("tooltip");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText("Plans and trials");
  expect(await pricing.boundingBox()).toEqual(before);
  await expect(page.locator("#side")).not.toBeVisible();
  await page.screenshot({ path: test.info().outputPath("box-hover.png") });
  await pricing.click();
  await expect(hint).not.toBeVisible();
  await expect(page.locator("#side .side-summary")).toHaveText(
    "Plans and trials",
  );
  await page.locator("#side .side-summary").dblclick();
  await expect(
    page.getByRole("textbox", { name: "Box description" }),
  ).toHaveValue("Plans and trials");
  await page.keyboard.press("Escape");
  await pricing.dblclick();
  await expect(page.locator("#newbox textarea")).toHaveValue("Pricing");
  await page.keyboard.press("Escape");
});

test("the map starts at an empty circle, with its main topics as ordinary boxes around it", async ({
  page,
}) => {
  await openSample(page);
  const circle = hub(page);
  await expect(circle).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Launch plan" })).toBeVisible();
  await expect(circle).toHaveText("");
  const size = await circle.boundingBox();
  expect(size!.width).toBeLessThan(40);
  expect(Math.abs(size!.width - size!.height)).toBeLessThan(1);
  // only the circle marks where the map starts: the main topics are ordinary boxes
  for (const name of ["Pricing", "Audience", "Free trial"])
    await expect(box(page, name)).not.toHaveClass(/\bstart\b|\bstart-rim\b/);
  // its lines leave from the circle's edge
  const ends = await page.evaluate(() => {
    const c = document.querySelector<HTMLElement>("#nodes .node.hub")!;
    const [x, y, w] = ["left", "top", "width"].map((k) =>
      parseFloat(c.style.getPropertyValue(k)),
    );
    return ["launch>pricing", "launch>audience"].map((id) => {
      const d = document
        .querySelector(`#edges .hit[data-edge="${id}"]`)!
        .getAttribute("d")!;
      const [, sx, sy] = d.match(/^M(-?[\d.]+) (-?[\d.]+)/)!.map(Number);
      return [Math.abs(sx - x) - w / 2, Math.abs(sy - y)];
    });
  });
  expect(ends).toEqual([
    [0, 0],
    [0, 0],
  ]);
});

test("on a map of several groups, only the start box is the circle", async ({
  page,
}) => {
  await openSample(page, {
    ...SAMPLE,
    nodes: [
      ...SAMPLE.nodes.slice(0, 2),
      { id: "notes", label: "Notes", x: 0, y: 300 },
      { id: "idea", label: "An idea", x: 300, y: 300 },
    ],
    edges: [
      { from: "launch", to: "pricing" },
      { from: "notes", to: "idea" },
    ],
  });
  await expect(hub(page)).toHaveAttribute("aria-label", "Launch plan");
  for (const name of ["Pricing", "Notes", "An idea"])
    await expect(box(page, name)).not.toHaveClass(/\bstart\b|\bhub\b/);
});

test("a click on the circle shows only the main topics, and another shows every box", async ({
  page,
}) => {
  await openSample(page);
  await hub(page).click();
  await expect(box(page, "Free trial")).toHaveCount(0);
  await expect(box(page, "Pricing")).toBeVisible();
  await expect(box(page, "Audience")).toBeVisible();
  await expect(page.locator("#levels")).toContainText("Level 1");
  await hub(page).click();
  await expect(box(page, "Free trial")).toBeVisible();
  await expect(page.locator("#levels")).toContainText("Level 2");
  // a main topic still opens its card
  await box(page, "Pricing").click();
  await expect(page.locator("#side .side-summary")).toHaveText(
    "Plans and trials",
  );
});

test("the arrow keys reach the circle, and Delete asks about it", async ({
  page,
}) => {
  await openSample(page);
  await box(page, "Pricing").click();
  await page.keyboard.press("ArrowLeft");
  await expect(hub(page)).toHaveClass(/\bsel\b/);
  await page.keyboard.press("ArrowRight");
  await expect(hub(page)).not.toHaveClass(/\bsel\b/);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Delete");
  await expect(hub(page).locator(".delq")).toContainText("Delete this topic");
  await page.keyboard.press("Escape");
  await expect(hub(page).locator(".delq")).toHaveCount(0);
  // F2 renames it as a box, with room for the name, and it is a circle again after
  await page.keyboard.press("F2");
  await expect(page.locator("#newbox textarea")).toHaveValue("Launch plan");
  await expect(hub(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(hub(page)).toHaveCount(1);
});

test("Tidy up lays out the circle and its topics with no box on another", async ({
  page,
}) => {
  const at = (id: string, x: number, y: number, label = id) => ({
    id,
    label,
    x,
    y,
  });
  const name = await openSample(page, {
    ...SAMPLE,
    nodes: [
      at("launch", 0, 0, "Launch plan"),
      at("pricing", 40, 20, "Pricing"),
      at("audience", -30, 10, "Audience"),
      at("trial", 60, -10, "Free trial"),
    ],
  });
  await page.locator("#tidyb").click();
  const state = async () =>
    (await (
      await page.request.get(`${server.origin}/${name}/api/state`)
    ).json()) as { nodes: { id: string; x: number; y: number }[] };
  const gap = async () => {
    const { nodes } = await state();
    const [launch, pricing] = ["launch", "pricing"].map((id) =>
      nodes.find((n) => n.id === id)!,
    );
    return Math.abs(pricing.x - launch.x);
  };
  // the circle's half, the gap between rings, then half of a main topic
  await expect.poll(gap).toBe(14 + 70 + 70);
  await expect(box(page, "Free trial")).toBeVisible();
  const overlaps = await page.evaluate(() => {
    const r = [...document.querySelectorAll("#nodes .node")].map((n) =>
      n.getBoundingClientRect(),
    );
    return r.flatMap((a, i) =>
      r
        .slice(i + 1)
        .filter(
          (b) =>
            a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom,
        ),
    ).length;
  });
  expect(overlaps).toBe(0);
});
