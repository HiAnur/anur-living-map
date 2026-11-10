import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

// The team map's page (team/live/index.html), on a copy of the team server
// with a sample topic map, driven the way you use it. These hold what the
// unit tests that read the page's script cannot see: that the page still
// loads and works as a whole after its script is moved or split, and that
// Share as a file still opens on its own.

const LIVE = path.resolve(import.meta.dirname, "../team/live");
const SAMPLE = {
  title: "Launch plan",
  start: "launch",
  nodes: [
    {
      id: "launch",
      label: "Launch plan",
      sub: "What we ship in spring",
      x: 0,
      y: 0,
    },
    {
      id: "pricing",
      label: "Pricing",
      sub: "Plans and trials",
      x: 300,
      y: -90,
    },
    { id: "audience", label: "Audience", sub: "Who it is for", x: 300, y: 90 },
    { id: "trial", label: "Free trial", sub: "Fourteen days", x: 600, y: -90 },
  ],
  edges: [
    { from: "launch", to: "pricing" },
    { from: "launch", to: "audience" },
    { from: "pricing", to: "trial" },
  ],
  calls: [],
  people: [],
};

let root = "";
let app = "";
let origin = "";
let session = "";
let server: ChildProcess | undefined;
let crashes: string[];

// One server per worker, from its own copy, so maps and sign-ins stay apart.
test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-team-page-"));
  app = path.join(root, "app");
  fs.mkdirSync(app);
  for (const f of fs.readdirSync(LIVE))
    if (/\.(js|html|json|md)$/.test(f) && f !== "projects.json")
      fs.copyFileSync(path.join(LIVE, f), path.join(app, f));
  fs.cpSync(path.join(LIVE, "agents"), path.join(app, "agents"), {
    recursive: true,
  });
  const env = {
    ...process.env,
    HOME: path.join(root, "home"),
    LIVING_MAP_USERS: path.join(root, "users.db"),
    LIVING_MAP_LOGIN_URL: "",
    LIVING_MAP_CLOUD_CONFIG: path.join(root, "no-cloud.json"),
  };
  session = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {users} from './users.js';console.log(users.start('Duy'))",
    ],
    { cwd: app, env, encoding: "utf8" },
  ).trim();
  const reserve = http.createServer();
  await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
  const port = (reserve.address() as AddressInfo).port;
  await new Promise((r) => reserve.close(r));
  origin = `http://localhost:${port}`;
  server = spawn(process.execPath, ["server.js", String(port)], {
    cwd: app,
    env,
    stdio: "ignore",
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${origin}/api/version`)).ok) break;
    } catch {
      // not listening yet
    }
    if (i > 100) throw new Error("The team server did not start");
    await new Promise((r) => setTimeout(r, 50));
  }
});

test.afterAll(() => {
  server?.kill();
  fs.rmSync(root, { recursive: true, force: true });
});

// Each test opens a map of its own, named after it, holding the sample.
const openSample = async (page: Page, state: object = SAMPLE) => {
  const name = `t-${test
    .info()
    .testId.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;
  fs.mkdirSync(path.join(app, "maps", name), { recursive: true });
  fs.writeFileSync(
    path.join(app, "maps", name, "state.json"),
    JSON.stringify(state),
  );
  await page.goto(`${origin}/${name}/`);
  await expect(page.locator("#nodes .node")).toHaveCount(4);
  return name;
};

const box = (page: Page, name: string) =>
  page.locator("#nodes .node", { hasText: name });

test.beforeEach(async ({ context, page }) => {
  crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e)));
  await context.addCookies([
    { name: "lm_session", value: session, domain: "localhost", path: "/" },
  ]);
});

test.afterEach(() => {
  expect(crashes).toEqual([]);
});

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
        await page.request.get(`${origin}/${name}/api/state`)
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
  const shared = await page.request.post(`${origin}/${name}/api/sharing`, {
    headers: { origin, "content-type": "application/json" },
    data: { mode: "view" },
  });
  expect(shared.ok()).toBe(true);
  const { token } = (await shared.json()) as { token: string };

  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  const errors: string[] = [];
  visitor.on("pageerror", (e) => errors.push(String(e)));
  await visitor.goto(`${origin}/${name}/?share=${token}`);
  for (const box_ of ["Launch plan", "Pricing", "Audience", "Free trial"])
    await expect(box(visitor, box_)).toBeVisible();
  expect(errors).toEqual([]);
  await guest.close();
});

test("an Action box shows where it stands", async ({ page }) => {
  const action = (id: string, stage: object) =>
    SAMPLE.nodes.map((n) => (n.id === id ? { ...n, action: stage } : n));
  await openSample(page, {
    ...SAMPLE,
    nodes: action("trial", {
      by: "Duy",
      stage: "finished",
      completion: { status: "completed", evidence: ["Trial page is live"] },
    }).map((n) =>
      n.id === "audience" ? { ...n, action: { by: "Duy", stage: "ready" } } : n,
    ),
  });
  await expect(
    box(page, "Free trial").getByLabel("Action status: Executed"),
  ).toBeVisible();
  await expect(
    box(page, "Audience").getByLabel("Action status: Ready to execute"),
  ).toBeVisible();
});

test("Export image downloads the view as a picture", async ({ page }) => {
  await openSample(page);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText("Local only")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-share-image]").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = path.join(root, "view.png");
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
  const file = path.join(root, "shared.html");
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
