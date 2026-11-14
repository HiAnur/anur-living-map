import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

// What the team map's browser tests share: a copy of the team server per worker, with its own maps and its own
// person on this Mac, a sample topic map, and opening a map of its own for each test. A test file calls
// useTeamServer() once.

const LIVE = path.resolve(import.meta.dirname, "../team/live");
export const SAMPLE = {
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
let env: NodeJS.ProcessEnv = {};
let child: ChildProcess | undefined;
let crashes: string[];

// Names the one person on this copy's Mac, as Settings does: every page here is them, with no sign-in.
const nameYou = (who: string) =>
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {users} from './users.js';users.rename(${JSON.stringify(who)})`,
    ],
    { cwd: app, env },
  );

// One server per worker, from its own copy, so maps and their person stay apart.

// Each test opens a map of its own, named after it, holding the sample.
export const openSample = async (page: Page, state: object = SAMPLE) => {
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

// A box by its name; the map's centre circle shows no name, so it is found by its accessible name.
export const box = (page: Page, name: string) =>
  page
    .locator("#nodes .node", { hasText: name })
    .or(page.locator(`#nodes .node.hub[aria-label="${name}"]`));

/** The map's centre circle: its start box, drawn empty. */
export const hub = (page: Page) => page.locator("#nodes .node.hub");

/** Where the server's copy and its maps live, and its address, for tests that need them. */
export const server = {
  get origin() {
    return origin;
  },
  get root() {
    return root;
  },
};

/**
 * Starts the team server for this test file, with Duy as the person on its Mac, and fails a test the page throws in.
 * `agentless` leaves the agent off the server's PATH, for a test whose click starts preparing an Action: the
 * preparation fails at once instead of reaching a real agent. `env` adds to the server's environment, asked once
 * the file's earlier beforeAll hooks have run (a stand-in login service or cloud they started, say).
 */
export function useTeamServer({
  agentless = false,
  env: more = () => ({}),
}: { agentless?: boolean; env?: () => NodeJS.ProcessEnv } = {}) {
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
    env = {
      ...process.env,
      HOME: path.join(root, "home"),
      // the maps stay in this copy, where the tests write them, and never reach a real data folder
      ANUR_LIVING_MAP_MAPS: app,
      LIVING_MAP_USERS: path.join(root, "users.db"),
      LIVING_MAP_LOGIN_URL: "",
      LIVING_MAP_CLOUD_CONFIG: path.join(root, "no-cloud.json"),
      ...(agentless ? { PATH: "/usr/bin:/bin" } : {}),
      ...more(),
    };
    nameYou("Duy");
    const reserve = http.createServer();
    await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
    const port = (reserve.address() as AddressInfo).port;
    await new Promise((r) => reserve.close(r));
    origin = `http://localhost:${port}`;
    child = spawn(process.execPath, ["server.js", String(port)], {
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
    child?.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test.beforeEach(({ page }) => {
    crashes = [];
    page.on("pageerror", (e) => crashes.push(String(e)));
  });

  test.afterEach(() => {
    expect(crashes).toEqual([]);
  });
}
