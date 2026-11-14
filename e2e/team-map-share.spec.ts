import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { box, openSample, useTeamServer } from "./team-map.harness.ts";

// Share → Publish online, by email: the owner signs in with Google, publishes, lists people with Can view or
// Can edit, and a teammate opens the online copy by signing in. Google is a stand-in key set and the login
// service a stand-in on this machine, run beside a copy of the cloud with its maps in memory: nothing here
// reaches Google, the real login service or the real cloud.
const CLOUD = path.resolve(import.meta.dirname, "../team/cloud");
const PUBLISH_KEY = "a".repeat(64);
const FAKES = `
import http from 'node:http';
import { createCloudServer } from ${JSON.stringify(pathToFileURL(path.join(CLOUD, "server.js")).href)};
import { fakeGoogle } from ${JSON.stringify(pathToFileURL(path.join(CLOUD, "google-id.harness.js")).href)};
const google = fakeGoogle();
const records = new Map();
const store = {
  async get(id) { return structuredClone(records.get(id) || null); },
  async put(id, value, version) {
    if ((records.get(id)?.version || null) !== version) throw Object.assign(new Error('Conflict'), { status: 409 });
    const record = { value: structuredClone(value), version: String(Number(version) + 1) }; records.set(id, record); return structuredClone(record);
  },
  async delete(id) { records.delete(id); },
};
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
// the stand-in login service signs in whoever the test says is at the keyboard
let who = { email: 'duy@example.com', name: 'Duy' };
const login = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/as') { let b = ''; for await (const c of req) b += c; who = JSON.parse(b); return res.end('{}'); }
  if (url.pathname === '/start') return res.writeHead(302, { location: url.searchParams.get('return') + '?' + new URLSearchParams({ code: 'one-time', state: url.searchParams.get('state') }) }).end();
  if (url.pathname === '/exchange') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...who, listed: true, picture: '', id_token: google.token(who.email, { name: who.name }) }));
  res.writeHead(404).end();
});
const loginPort = await listen(login);
const reserve = http.createServer(); const cloudPort = await listen(reserve); await new Promise((r) => reserve.close(r));
const cloud = createCloudServer({ store, publishKey: ${JSON.stringify(PUBLISH_KEY)}, publicUrl: 'http://127.0.0.1:' + cloudPort, checkIdToken: google.check, loginUrl: 'http://127.0.0.1:' + loginPort });
await new Promise((r) => cloud.listen(cloudPort, '127.0.0.1', r));
console.log(JSON.stringify({ login: 'http://127.0.0.1:' + loginPort, cloud: 'http://127.0.0.1:' + cloudPort }));
`;

let fakes: ChildProcess | undefined;
let login = "";
let cloud = "";
let home = "";
test.beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "lm-share-"));
  fakes = spawn(process.execPath, ["--input-type=module", "-e", FAKES], {
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const first = await new Promise<string>((resolve) =>
    fakes?.stdout?.once("data", (d: Buffer) => resolve(String(d))),
  );
  ({ login, cloud } = JSON.parse(first) as { login: string; cloud: string });
  fs.writeFileSync(
    path.join(home, "cloud.json"),
    JSON.stringify({ url: cloud, publishKey: PUBLISH_KEY }),
  );
});
test.afterAll(() => {
  fakes?.kill();
  fs.rmSync(home, { recursive: true, force: true });
});
useTeamServer({
  env: () => ({
    LIVING_MAP_LOGIN_URL: login,
    LIVING_MAP_CLOUD_CONFIG: path.join(home, "cloud.json"),
    LIVING_MAP_CLOUD_TEST: "1",
  }),
});

const signInAs = (email: string, name: string) =>
  fetch(`${login}/as`, {
    method: "POST",
    body: JSON.stringify({ email, name }),
  });

test("the owner signs in with Google to publish, then shares the online copy by email", async ({
  page,
  browser,
}) => {
  await signInAs("duy@example.com", "Duy");
  await openSample(page);
  await page.getByRole("button", { name: "Share" }).click();
  const share = page.locator("#share");

  // not published, and Google has not said who you are on this Mac yet
  await share
    .getByRole("link", { name: "Sign in with Google to publish" })
    .click();
  // back from Google, with Share open again
  await expect(
    share.getByRole("button", { name: "Publish online" }),
  ).toBeVisible();
  await share.getByRole("button", { name: "Publish online" }).click();
  await page.getByRole("button", { name: "Upload and copy link" }).click();
  await expect(share.getByText("Who has access online")).toBeVisible();
  await expect(share).toContainText("duy@example.com");
  await expect(share).toContainText(
    "Only the people you add can open its link",
  );

  // add a teammate, change what they can do, and someone else to remove
  const email = share.getByLabel("Email address to add");
  await email.fill("Teammate@Example.com");
  await share.getByRole("button", { name: "Add" }).click();
  const teammate = share.locator('[data-online-person="teammate@example.com"]');
  await expect(teammate).toBeVisible();
  await expect(email).toHaveValue("");
  await teammate
    .getByLabel("What teammate@example.com can do")
    .selectOption("edit");
  await expect(page.locator("#toast")).toContainText(
    "teammate@example.com can edit now",
  );
  await email.fill("not an address");
  await share.getByRole("button", { name: "Add" }).click();
  await expect(page.locator("#toast")).toContainText(
    "Type a whole email address",
  );
  await email.fill("leaving@example.com");
  await share.getByRole("button", { name: "Add" }).click();
  await share
    .getByRole("button", { name: "Remove leaving@example.com" })
    .click();
  await expect(
    share.locator('[data-online-person="leaving@example.com"]'),
  ).toHaveCount(0);

  // anyone with the link can view: off by default, one switch
  const linkView = share.getByRole("switch", {
    name: "Anyone with the link can view",
  });
  await expect(linkView).toHaveAttribute("aria-checked", "false");
  await linkView.click();
  await expect(linkView).toHaveAttribute("aria-checked", "true");
  await linkView.click();
  await expect(linkView).toHaveAttribute("aria-checked", "false");
  await expect(
    share.getByRole("button", { name: "Turn off link" }),
  ).toBeVisible();
  await expect(
    share.getByRole("button", { name: "Delete online copy" }),
  ).toBeVisible();

  const status = (await page.evaluate(() =>
    window.fetch("api/cloud").then((r) => r.json()),
  )) as { url: string; access: { people: Record<string, string> } };
  expect(status.access.people).toEqual({ "teammate@example.com": "edit" });
  // the address never rides in the link
  expect(status.url).not.toContain("example.com");

  // someone not on the list signs in and is told whom to ask, with nothing of the map
  const stranger = await browser.newContext();
  const outside = await stranger.newPage();
  await outside.goto(status.url);
  await expect(
    outside.getByRole("heading", { name: "Sign in to open this map" }),
  ).toBeVisible();
  await signInAs("stranger@example.com", "Stranger");
  await outside.getByRole("link", { name: "Sign in with Google" }).click();
  await expect(
    outside.getByRole("heading", { name: "Ask Duy for access" }),
  ).toBeVisible();
  await expect(outside.locator("body")).not.toContainText("Pricing");
  await stranger.close();

  // the teammate signs in and edits under their own name
  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  await visitor.goto(status.url);
  await signInAs("teammate@example.com", "Teammate");
  await visitor.getByRole("link", { name: "Sign in with Google" }).click();
  await expect(box(visitor, "Pricing")).toBeVisible();
  await expect(visitor.locator("body")).not.toHaveClass(/view-only/);
  await expect(visitor.locator("#faces .face.me")).toHaveAttribute(
    "title",
    /Teammate/,
  );
  await guest.close();
});
