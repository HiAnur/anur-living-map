import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { SAMPLE, box, hub, server, useTeamServer } from "./team-map.harness.ts";

// A system map's page, driven as people use it: locked repos say why, a redraw waits for review, a default map builds
// on a system map and its boxes point at the system's.

useTeamServer();

type Files = Record<string, unknown>;

/** A map of this test's own, from a state and the files beside it, opened in the page. */
function openState(
  state: object,
  files: Files = {},
  name = `t-${test
    .info()
    .testId.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`,
) {
  const dir = path.join(server.root, "app", "maps", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
  for (const [f, v] of Object.entries(files))
    fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  return name;
}

const repoBox = (repo: string, x: number, inside: object[] = []) => ({
  id: `system-${repo}`,
  label: repo,
  sub: `The ${repo} service`,
  x,
  y: 0,
  origin: "code",
  source: { kind: "code", repo },
  inside: { nodes: inside, edges: [] },
});

const systemMap = (more: object = {}) => ({
  title: "Shop system",
  people: [{ id: "Duy", role: "Admin", sees: "all" }],
  calls: [],
  drawing: {
    status: "done",
    at: Date.now() - 60_000,
    ms: 9_000,
    by: "Duy",
    repos: 2,
    progress: [
      { repo: "api", stage: "done", boxes: 1, facts: 12 },
      { repo: "web", stage: "done", boxes: 1, facts: 8 },
    ],
  },
  nodes: [
    repoBox("api", 0, [
      {
        id: "api-payments",
        label: "Payments",
        sub: "Takes card payments",
        x: 0,
        y: 0,
        origin: "code",
      },
    ]),
    repoBox("web", 300),
  ],
  edges: [
    { from: "system-web", to: "system-api", label: "calls", origin: "code" },
  ],
  start: "system-api",
  ...more,
});

test("a private repo you may not read is locked, says why, and is never named", async ({
  page,
}) => {
  const name = openState(systemMap(), {
    "system-folders.json": {
      folders: [],
      repos: [
        { owner: "Shop", name: "api", private: true },
        { owner: "Shop", name: "web", private: false },
      ],
    },
    "system-report.json": {
      repos: [
        { repo: "api", root: "/x/api", unread: [] },
        { repo: "web", root: "/x/web", unread: [] },
      ],
    },
  });
  await page.goto(`${server.origin}/${name}/`);
  await expect(box(page, "A private repo")).toBeVisible();
  await expect(box(page, "web")).toBeVisible();
  // the panel lists the repos it drew: the private one only as "A private repo"
  const panel = page.locator("#sysdraw");
  await expect(panel).toContainText("A private repo");
  await expect(panel).toContainText("web");
  await expect(panel).not.toContainText(/\bapi\b/);
  // why it is locked, and how to see it
  const why = page.locator("#lockwhy");
  await expect(why).toContainText("1 box is locked: private on GitHub.");
  await expect(
    why.getByRole("button", { name: "Connect GitHub" }),
  ).toBeVisible();
});

/** A system map drawn again where code no longer finds the web repo: web stays until an Engineer settles it. */
const waiting = () =>
  openState(
    systemMap({
      redraw: {
        at: Date.now(),
        by: "Duy",
        count: 1,
        changes: [
          {
            what: "gone",
            kind: "box",
            id: "system-web",
            label: "web",
            repo: "web",
          },
        ],
      },
    }),
    {
      "system-pending.json": {
        nodes: [repoBox("api", 0)],
        edges: [],
        start: "system-api",
      },
    },
  );

test("what code no longer finds waits for review, and Apply takes it off", async ({
  page,
}) => {
  const name = waiting();
  await page.goto(`${server.origin}/${name}/`);
  const panel = page.locator("#sysdraw");
  await expect(panel).toContainText("Code no longer finds 1 thing");
  await expect(panel).toContainText("Takes away web");
  await expect(box(page, "web")).toBeVisible();
  await panel.getByRole("button", { name: "Apply the changes" }).click();
  await expect(box(page, "web")).toHaveCount(0);
  await expect(panel).not.toContainText("no longer finds");
});

test("Keep the map as it is keeps what code no longer finds", async ({
  page,
}) => {
  const name = waiting();
  await page.goto(`${server.origin}/${name}/`);
  const panel = page.locator("#sysdraw");
  await panel.getByRole("button", { name: "Keep the map as it is" }).click();
  await expect(panel).not.toContainText("no longer finds");
  await expect(box(page, "web")).toBeVisible();
  await expect(box(page, "api")).toBeVisible();
});

test("a system map starts at a circle for the whole system, every repo hanging off it", async ({
  page,
}) => {
  const map = systemMap();
  // a person who uses the system, and a box someone drew under a repo, one level further out
  const name = openState({
    ...map,
    nodes: [
      ...map.nodes,
      {
        id: "system-customer",
        label: "Customer",
        kind: "actor",
        x: -300,
        y: 0,
        origin: "code",
      },
      { id: "mine", label: "My note", x: 300, y: 200 },
    ],
    edges: [
      ...map.edges,
      {
        from: "system-customer",
        to: "system-web",
        label: "uses",
        origin: "code",
      },
      { from: "system-web", to: "mine" },
    ],
  });
  await page.goto(`${server.origin}/${name}/`);
  const circle = hub(page);
  await expect(circle).toHaveAttribute("aria-label", "Shop system");
  await expect(circle).toHaveText("");
  // the drawing's panel sits in a corner, clear of the circle
  const panel = await page.locator("#sysdraw").boundingBox();
  const ring = await circle.boundingBox();
  expect(
    panel!.x + panel!.width <= ring!.x ||
      panel!.y + panel!.height <= ring!.y ||
      panel!.y >= ring!.y + ring!.height,
  ).toBe(true);
  // the repos are ordinary boxes round the circle, a line from it to each, as on any map; the person gets none and
  // sits beside the repo they use
  for (const repo of ["api", "web"]) {
    await expect(box(page, repo)).not.toHaveClass(/\bstart\b/);
    await expect(
      page.locator(`#edges .hit[data-edge="system>system-${repo}"]`),
    ).toHaveCount(1);
  }
  await expect(
    page.locator('#edges .hit[data-edge="system>system-customer"]'),
  ).toHaveCount(0);
  const [web, customer, centre] = await Promise.all(
    [box(page, "web"), box(page, "Customer"), circle].map((b) =>
      b.boundingBox(),
    ),
  );
  expect(Math.sign(customer!.x - centre!.x)).toBe(
    Math.sign(web!.x - centre!.x),
  );
  // the call between the repos is a curved cross-link, as on any map
  await expect(page.locator("#edges path.cross")).toHaveCount(1);
  // a click folds the map to the circle; another shows every box again
  await circle.click();
  await expect(page.locator("#levels")).toContainText("Level 0");
  for (const gone of ["api", "web", "My note", "Customer"])
    await expect(box(page, gone)).toHaveCount(0);
  await circle.click();
  for (const back of ["api", "web", "My note", "Customer"])
    await expect(box(page, back)).toBeVisible();
  // a repo opens into its own map, which starts at a circle standing for the repo, its parts round it
  await page.locator('[data-expand="system-api"]').click();
  await expect(box(page, "Payments")).toBeVisible();
  await expect(hub(page)).toHaveAttribute("aria-label", "api");
  await expect(box(page, "Payments")).not.toHaveClass(/\bstart\b/);
});

test("the map updating itself from new commits does not pop the panel up", async ({
  page,
}) => {
  const name = openState(
    systemMap({
      drawing: {
        status: "running",
        at: Date.now(),
        by: "Duy",
        repos: 2,
        auto: true,
        progress: [{ repo: "api", stage: "drawing" }],
      },
    }),
  );
  await page.goto(`${server.origin}/${name}/`);
  await expect(box(page, "api")).toBeVisible();
  await expect(page.locator("#sysdraw")).toBeHidden();
});

test("a default map opens empty at once, even with a system map there", async ({
  page,
}) => {
  openState(systemMap({ title: "Builds-on base" }), {}, "builds-on-base");
  await page.goto(`${server.origin}/maps.html`);
  await expect(
    page.locator(".row", { hasText: "Builds-on base" }),
  ).toBeVisible();
  await page.locator("#new-map").click();
  await page.getByRole("button", { name: /Default map/ }).click();
  await expect(page).toHaveURL(/\?new=1$/);
  await expect(page.locator("#crumbs .builds")).toHaveCount(0);
});

test("a map that builds on a system map points a box at a system box", async ({
  page,
}) => {
  const base = openState(
    systemMap({ title: "Builds-on base" }),
    {},
    "builds-on-base",
  );

  // a plan on that system: one of its boxes points at the box it changes
  const plan = openState({
    ...SAMPLE,
    buildsOn: { name: base, title: "Builds-on base" },
    contextMapIds: [base],
  });
  await page.goto(`${server.origin}/${plan}/?brain-box=pricing`);
  const pick = page.locator("#pts-in");
  await expect(page.locator("#pts-list option")).toHaveCount(3);
  await pick.fill("Payments (in api)");
  await pick.press("Tab");
  const link = page.locator(".pts a");
  await expect(link).toHaveText("Payments");
  await expect(link).toHaveAttribute(
    "href",
    `/${base}/?brain-box=api-payments`,
  );
  await expect(box(page, "Pricing")).toBeVisible();
});

test("a finished drawing's panel closes from its top, even with a long list of repos, and stays closed", async ({
  page,
}) => {
  const repos = Array.from({ length: 16 }, (_, i) => `repo-${i + 1}`);
  const name = openState(
    systemMap({
      drawing: {
        status: "done",
        at: 1,
        ms: 74_000,
        by: "Duy",
        repos: repos.length,
        progress: [
          ...repos.map((repo) => ({
            repo,
            stage: "done",
            boxes: 20,
            reused: true,
          })),
          { repo: "platform", stage: "done", boxes: 5 },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 1400, height: 700 });
  await page.goto(`${server.origin}/${name}/`);
  const panel = page.locator("#sysdraw");
  await expect(panel).toBeVisible();
  // the list is longer than the panel, and the close stays in view as it scrolls
  await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();
  await page.reload();
  await expect(box(page, "api")).toBeVisible();
  await expect(panel).toBeHidden();
});
