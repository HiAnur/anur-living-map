import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { box, openSample, useTeamServer } from "./team-map.harness.ts";

// Share → Publish online, by link: the owner signs in with Google and confirms publication, then anyone
// holding the link opens the cloud copy without signing in. Google is a stand-in key set and the login
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
// Google's front end removes reserved headers before the request reaches the cloud app.
cloud.prependListener('request', (req) => {
  for (const name of Object.keys(req.headers)) {
    if (name.startsWith('x-google-')) delete req.headers[name];
  }
});
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

test("the owner shares view and edit links, with people shown only while they are here", async ({
  page,
  browser,
}) => {
  await signInAs("owner@example.com", "Owner");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) =>
          sessionStorage.setItem("copied-link", text),
      },
    });
  });
  const copied = () =>
    page.evaluate(() => sessionStorage.getItem("copied-link"));
  await openSample(page);
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "PM", exact: true }).click();
  await page.locator("#rail .ri").first().click();
  await page
    .getByRole("button", { name: "Counterclockwise", exact: true })
    .click();
  const oldWindow = await page.context().newPage();
  await oldWindow.goto(page.url());
  await page.getByRole("button", { name: "Share" }).click();
  const share = page.locator("#share");

  // not published: its link opens only on this Mac, so there is no link setting to choose
  await expect(share.getByText("Link access")).toHaveCount(0);
  await expect(share.getByText("Anyone with the link can")).toHaveCount(0);
  const localLink = share.getByRole("button", {
    name: "Copy link",
    exact: true,
  });
  const confirm = page.getByRole("alertdialog", {
    name: "Upload this map to Google Cloud?",
  });
  // Copy link signs in first, then asks before any upload or clipboard write.
  await localLink.click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(
    "Upload a copy of this map to Google Cloud",
  );
  await expect(
    confirm.getByRole("button", { name: "Upload and copy link" }),
  ).toBeVisible();
  expect(await copied()).toBeNull();
  await confirm.getByRole("button", { name: "Keep local" }).click();
  await expect(share.getByText("Stored on this Mac")).toBeVisible();
  expect(await copied()).toBeNull();

  // Once signed in, Copy link goes straight to the same upload confirmation.
  await localLink.click();
  const upload = confirm.getByRole("button", { name: "Upload and copy link" });
  await expect(upload).toBeVisible();
  expect(await copied()).toBeNull();
  await upload.click();
  await expect(share.getByText("Shared online", { exact: true })).toBeVisible();
  await expect(page.locator("#toast")).toHaveText(
    "Uploaded to Google Cloud. Online link copied.",
  );
  await expect(share).toContainText("This map is stored in Google Cloud");
  const onlineLink = share.getByRole("button", { name: "Copy online link" });
  await expect(onlineLink).toBeVisible();
  await expect(share.getByText("On this Mac", { exact: true })).toHaveCount(0);
  await expect(share.getByText("Here now", { exact: true })).toHaveCount(0);
  const publishedUrl = await copied();
  expect(publishedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/m\//);
  await page.evaluate(() => sessionStorage.removeItem("copied-link"));
  await onlineLink.click();
  await expect.poll(copied).toBe(publishedUrl);
  await expect(
    share.getByRole("button", {
      name: "Anyone with the link can view",
      exact: true,
    }),
  ).toBeVisible();
  await expect(share.getByLabel("Email address to add")).toHaveCount(0);
  await expect(
    share.getByRole("button", { name: "Add", exact: true }),
  ).toHaveCount(0);

  const status = (await page.evaluate(() =>
    window.fetch("api/cloud").then((r) => r.json()),
  )) as {
    url: string;
    access: { people: Record<string, string>; linkView: boolean };
  };
  expect(status.access).toMatchObject({ people: {}, linkView: true });
  const shared = new URL(publishedUrl!);
  expect(shared.searchParams.get("view")).toBe("pm");
  shared.searchParams.delete("view");
  expect(shared.href).toBe(status.url);
  expect(status.url).not.toContain("example.com");

  // A remembered owner can inspect permissions and copy the link after verification expires.
  await oldWindow.route("**/api/cloud", async (route) => {
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        origin: new URL(page.url()).origin,
        "sec-fetch-site": "same-origin",
      },
    });
    const cloud = await response.json();
    await route.fulfill({
      json: { ...cloud, google: { ready: false, needs: "signin" } },
    });
  });
  let attempts = 0;
  await oldWindow.route("**/api/sharing", async (route) => {
    attempts++;
    await route.fulfill({
      status: 401,
      json: { needs: "signin", error: "Verify your account." },
    });
  });
  const oldShare = oldWindow.locator("#share");
  const signIn = oldShare.getByRole("link", { name: "Sign in with Google" });
  const permission = oldShare.getByRole("button", {
    name: "Anyone with the link can view",
  });
  await oldWindow.getByRole("button", { name: "Share", exact: true }).click();
  await expect(permission).toBeEnabled();
  await expect(signIn).toHaveCount(0);
  await oldShare.getByRole("button", { name: "Copy online link" }).click();
  await permission.click();
  await oldShare.getByRole("menuitemradio", { name: "Can view" }).click();
  await expect(signIn).toHaveCount(0);
  expect(attempts).toBe(0);
  await permission.click();
  await oldShare.getByRole("menuitemradio", { name: "Can edit" }).click();
  await expect(signIn).toBeVisible();
  expect(attempts).toBe(1);
  await expect(permission).toBeEnabled();
  await oldShare.locator("[data-close-share]").click();
  await oldWindow.getByRole("button", { name: "Share", exact: true }).click();
  await expect(permission).toBeEnabled();
  await expect(signIn).toHaveCount(0);
  await oldShare.locator("[data-close-share]").click();

  // A recipient opens the copied link directly, with no Google account or email invitation.
  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  await visitor.goto(publishedUrl!);
  await expect(visitor.locator("body")).toHaveClass(/mind-view/);
  await expect(box(visitor, "Pricing")).toBeVisible();
  await expect(visitor.locator("body")).toHaveClass(/view-only/);
  // The owner's branch layout reaches a fresh browser, including one with a view-only link.
  await visitor.locator("#rail .ri").first().click();
  await expect(
    visitor.getByRole("button", { name: "Counterclockwise", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const editStatus = await visitor.evaluate(() =>
    fetch("api/act" + location.search, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "renamebox",
        id: "pricing",
        label: "Changed",
        revision: 1,
      }),
    }).then((r) => r.status),
  );
  expect(editStatus).toBe(403);

  await expect(share.getByText("Here now", { exact: true })).toBeVisible({
    timeout: 12000,
  });
  await expect(share.getByText(/^Guest [a-f0-9]{6}$/)).toBeVisible();
  await expect(share.getByText("Duy", { exact: true })).toHaveCount(0);

  // The owner and a view-only visitor can point at the map without changing its contents.
  await share.locator("[data-close-share]").click();
  await visitor.getByRole("button", { name: "Zoom in" }).click();
  await expect(async () => {
    await box(visitor, "Pricing").hover();
    await expect(
      page.locator("#curs .tag").filter({ hasText: /^Guest / }),
    ).toBeVisible({ timeout: 600 });
  }).toPass({ timeout: 6000 });
  await expect
    .poll(async () => {
      const node = await box(page, "Pricing").boundingBox();
      const tip = await page.locator("#curs .cur svg").first().boundingBox();
      return node && tip
        ? Math.hypot(
            tip.x - node.x - node.width / 2,
            tip.y - node.y - node.height / 2,
          )
        : Infinity;
    })
    .toBeLessThan(8);
  await page.screenshot({
    path: test.info().outputPath("shared-pm-cursor.png"),
  });
  await expect(async () => {
    await box(page, "Pricing").hover();
    await expect(
      visitor.locator("#curs .tag").filter({ hasText: "Owner" }),
    ).toBeVisible({ timeout: 600 });
  }).toPass({ timeout: 6000 });
  await page.getByRole("button", { name: "Share", exact: true }).click();

  // Reconnecting to a view link fetches the layout saved while the visitor was offline.
  await guest.setOffline(true);
  await share.locator("[data-close-share]").click();
  if (
    !(await page
      .getByRole("button", { name: "Both sides", exact: true })
      .isVisible())
  ) {
    await page.getByRole("button", { name: "Design", exact: true }).click();
  }
  await page.getByRole("button", { name: "Both sides", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await guest.request.get(
        new URL("api/state" + shared.search, shared).href,
      );
      return (await response.json()).mindLayout;
    })
    .toBe("balanced");
  await guest.setOffline(false);
  await expect(
    visitor.getByRole("button", { name: "Both sides", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Left", exact: true }).click();
  await expect(
    visitor.getByRole("button", { name: "Left", exact: true }),
  ).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });
  await page.getByRole("button", { name: "Share", exact: true }).click();

  // Changing link permission applies to the anonymous recipient already viewing it.
  await share
    .getByRole("button", { name: "Anyone with the link can view", exact: true })
    .click();
  await share
    .getByRole("menuitemradio", { name: "Can edit", exact: true })
    .click();
  await expect(
    share.getByRole("button", {
      name: "Anyone with the link can edit",
      exact: true,
    }),
  ).toBeVisible();
  await expect(visitor.locator("body")).not.toHaveClass(/view-only/, {
    timeout: 10000,
  });
  // Both editors use the cloud link. One can keep typing while the other pans and edits.
  const second = await browser.newPage();
  await second.goto(publishedUrl!);
  await box(second, "Audience").click();
  await second.keyboard.press("F2");
  const draft = second.locator("#newbox textarea");
  await draft.fill("Audience draft");
  await draft.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 6));
  const camera = () =>
    second.locator("#stage").evaluate((el) => el.style.transform);
  const before = await camera();
  await box(visitor, "Pricing").hover();
  await visitor.mouse.wheel(0, 50);
  const arrow = second.locator("#curs .cur svg").first();
  await expect(arrow).toBeVisible();
  await expect
    .poll(async () => (await arrow.boundingBox())?.width)
    .toBeCloseTo(16);
  await box(visitor, "Pricing").click();
  await visitor.keyboard.press("F2");
  await visitor.locator("#newbox textarea").fill("Updated pricing");
  await visitor.keyboard.press("Enter");
  await expect(box(second, "Updated pricing")).toBeVisible({ timeout: 2000 });
  expect(await camera()).toBe(before);
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue("Audience draft");
  expect(
    await draft.evaluate((el: HTMLTextAreaElement) => [
      el.selectionStart,
      el.selectionEnd,
    ]),
  ).toEqual([2, 6]);
  await second.keyboard.type("new");
  await second.keyboard.press("Enter");
  await expect(box(visitor, "Aunewce draft")).toBeVisible({ timeout: 2000 });
  await second.close();
  await expect(box(page, "Updated pricing")).toHaveCount(1, { timeout: 2000 });

  await share
    .getByRole("button", { name: "Anyone with the link can edit", exact: true })
    .click();
  await share
    .getByRole("menuitemradio", { name: "Can view", exact: true })
    .click();
  await expect(visitor.locator("body")).toHaveClass(/view-only/, {
    timeout: 10000,
  });

  // Turning the link off revokes it. Turning it on creates a new link.
  await share
    .getByRole("button", { name: "Anyone with the link can view", exact: true })
    .click();
  await share
    .getByRole("menuitemradio", { name: "Turn off link", exact: true })
    .click();
  await expect(share.getByText("In cloud · link off")).toBeVisible();
  expect((await guest.request.get(status.url)).status()).toBe(403);
  await share
    .getByRole("button", { name: "Link sharing is off", exact: true })
    .click();
  await share
    .getByRole("menuitemradio", { name: "Can view", exact: true })
    .click();
  await expect(
    share.getByRole("button", {
      name: "Anyone with the link can view",
      exact: true,
    }),
  ).toBeVisible();
  await onlineLink.click();
  const freshUrl = await copied();
  expect(freshUrl).not.toBe(status.url);
  expect((await guest.request.get(status.url)).status()).toBe(403);
  await visitor.goto(freshUrl!);
  await expect(box(visitor, "Updated pricing")).toBeVisible();
  await guest.close();
  await oldWindow.close();
});
