import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import {
  SAMPLE,
  box,
  hub,
  makeOwner,
  server,
  signIn,
  useTeamServer,
} from "./team-map.harness.ts";

// A system map's page, driven as people use it: locked repos say why, a redraw waits for review, a default map builds
// on a system map and its boxes point at the system's, and someone who may not draw a system map is told whom to ask.

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
  // a box someone drew under a repo, one level further out
  const name = openState({
    ...map,
    nodes: [...map.nodes, { id: "mine", label: "My note", x: 300, y: 200 }],
    edges: [...map.edges, { from: "system-web", to: "mine" }],
  });
  await page.goto(`${server.origin}/${name}/`);
  const circle = hub(page);
  await expect(circle).toHaveAttribute("aria-label", "Shop system");
  await expect(circle).toHaveText("");
  // the repos are ordinary boxes, each with a line from the circle
  for (const repo of ["api", "web"]) {
    await expect(box(page, repo)).not.toHaveClass(/\bstart\b/);
    await expect(
      page.locator(`#edges .hit[data-edge="system>system-${repo}"]`),
    ).toHaveCount(1);
  }
  // the calls between them stay plain lines, never curved cross-links
  await expect(page.locator("#edges path.cross")).toHaveCount(0);
  // a click shows only the repos; another, every box again
  await circle.click();
  await expect(box(page, "My note")).toHaveCount(0);
  await expect(box(page, "web")).toBeVisible();
  await circle.click();
  await expect(box(page, "My note")).toBeVisible();
  // a repo still opens into its own map, whose first box keeps its name
  await page.locator('[data-expand="system-api"]').click();
  await expect(box(page, "Payments")).toBeVisible();
  await expect(hub(page)).toHaveCount(0);
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

test("someone who may not draw a system map is told whom to ask", async ({
  context,
  page,
}) => {
  // the install's owner is whom to ask
  makeOwner("Duy");
  await context.clearCookies();
  await context.addCookies([
    {
      name: "lm_session",
      value: signIn("Priyanka"),
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.goto(`${server.origin}/maps.html`);
  await page.locator("#new-map").click();
  await page.getByRole("button", { name: /System map/ }).click();
  // a folder on this Mac, then GitHub: either way, whom to ask
  await expect(page.locator("#local-state")).toContainText("Ask Duy");
  await page.getByRole("button", { name: "On GitHub" }).click();
  await expect(page.locator("#gh-state")).toContainText(
    "Drawing a system map is for Engineers and Admins.",
  );
  await expect(page.locator("#gh-state")).toContainText("Duy");
  await expect(
    page.getByRole("button", { name: "Copy a request to send them" }),
  ).toBeVisible();
  // no repos to choose, and nothing to draw with
  await expect(page.locator("#code-pick")).toBeHidden();
});
