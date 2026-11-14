import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { openSample, server, useTeamServer } from "./team-map.harness.ts";

// The first run: the list of maps with nothing on it yet, a repo's blank map that offers to draw the repo, and Share
// saying plainly who can open what.

useTeamServer();

test("with no maps yet, the first screen says to make one and New map opens", async ({
  page,
}) => {
  // this worker's server may hold other tests' maps: the list is empty here
  await page.route("**/api/maps", (r) =>
    r.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.goto(`${server.origin}/`);
  await expect(page.getByText("No maps yet — make one")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/acme/i);
  await page.locator("[data-empty-new]").click();
  await expect(page.getByRole("button", { name: /System map/ })).toBeVisible();
});

test("a repo's blank map offers to draw the repo, and New map offers its folder", async ({
  page,
}) => {
  // Duy is the person on this Mac, an Admin of every map here, so Duy may draw
  const repo = path.join(server.root, "home", "code", "shop-api");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const added = await fetch(`${server.origin}/api/projects`, {
    method: "POST",
    body: JSON.stringify({ folder: repo }),
  });
  expect(await added.json()).toEqual({ name: "shop-api", href: "/shop-api/" });
  await page.goto(`${server.origin}/shop-api/`);
  await expect(page).toHaveTitle(/shop-api/);
  const card = page.locator("#repocard");
  await expect(
    card.getByRole("heading", { name: "Draw this repo as a system map" }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Draw this repo" }),
  ).toBeVisible();
  // the card's button is the screen's one filled button
  await expect(page.locator("#tidyb")).toBeHidden();

  await page.goto(`${server.origin}/`);
  await page.locator("#new-map").click();
  await page.getByRole("button", { name: /System map/ }).click();
  await page.getByRole("button", { name: "A folder on this Mac" }).click();
  await expect(
    page.locator("#local-repos label", { hasText: "shop-api" }),
  ).toContainText("~/code/shop-api");
  await expect(page.locator("#code-go")).toBeEnabled();
});

test("Share says only this Mac can open the link, and offers no invite", async ({
  page,
}) => {
  await openSample(page);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(
    page.getByText("Only this Mac can open this link"),
  ).toBeVisible();
  await expect(page.locator("#share")).toContainText("send it as a file");
  await expect(page.getByText("Send as a file", { exact: true })).toBeVisible();
  await expect(page.locator("#share input")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Publish online" }),
  ).toHaveCount(0);
});
