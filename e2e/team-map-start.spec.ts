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
  await expect(
    page.getByRole("button", { name: /Engineering Map/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /PM Map/ })).toBeVisible();
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
  await page.getByRole("button", { name: /Engineering Map/ }).click();
  await expect(
    page.getByRole("heading", { name: "Engineering Map" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "A folder on this Mac" }).click();
  await expect(
    page.locator("#local-repos label", { hasText: "shop-api" }),
  ).toContainText("~/code/shop-api");
  await expect(page.locator("#code-go")).toBeEnabled();
});

for (const submit of ["Enter", "send arrow", "New map"]) {
  test(`${submit} asks which map to make and keeps the prompt through cancellation`, async ({
    page,
  }) => {
    const requests: unknown[] = [];
    await page.route("**/api/newmap", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ json: { href: "/prompt-pm/" } });
    });
    await page.goto(`${server.origin}/`);
    const prompt = "  Plan our launch\nInclude pricing and rollout.  ";
    const input = page.getByRole("textbox", {
      name: "What should Claude map?",
    });
    await input.fill(prompt);
    const send = async () => {
      if (submit === "Enter") await input.press("Enter");
      else if (submit === "send arrow")
        await page
          .getByRole("button", { name: "Start the map", exact: true })
          .click();
      else await page.locator("#new-map").click();
    };
    await send();
    await expect(page.locator("#newmap")).toBeVisible();
    await expect(page.locator("#nm-prompt")).toHaveText(prompt.trim());
    expect(requests).toEqual([]);
    await page.locator("#newmap").press("Escape");
    await expect(page.locator("#newmap")).not.toBeVisible();
    await expect(input).toHaveValue(prompt);
    await send();
    await page.getByRole("button", { name: /PM Map/ }).click();
    await expect(page).toHaveURL(`${server.origin}/prompt-pm/?chat=1`);
    expect(requests).toEqual([{ prompt: prompt.trim() }]);
  });
}

for (const source of ["local", "github"]) {
  test(`a chat prompt opens the ${source} repo picker and stays with the Engineering Map`, async ({
    page,
  }) => {
    const requests: unknown[] = [];
    const pmRequests: unknown[] = [];
    await page.route("**/api/newmap", async (route) => {
      pmRequests.push(route.request().postDataJSON());
      await route.fulfill({ status: 500, json: { error: "Wrong map type." } });
    });
    await page.route("**/api/systemmap/can", (route) =>
      route.fulfill({ json: { may: true, engineers: [] } }),
    );
    await page.route("**/api/systemmap/folders", (route) =>
      route.fulfill({
        json: {
          folders: [
            {
              folder: "/code/shop-api",
              name: "shop-api",
              where: "~/code/shop-api",
            },
          ],
        },
      }),
    );
    await page.route("**/api/systemmap/github", (route) =>
      route.fulfill({ json: { linked: "octo", pending: null } }),
    );
    await page.route("**/api/systemmap/github/repos", (route) =>
      route.fulfill({
        json: { repos: [{ owner: "shop", name: "api" }], installed: ["shop"] },
      }),
    );
    await page.route("**/api/systemmap", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ json: { href: "/prompt-engineering/" } });
    });
    await page.goto(`${server.origin}/`);
    const prompt =
      "Map the services, data and dependencies for our product launch.\nKeep the full request even when I change the map's name.";
    await page
      .getByRole("textbox", { name: "What should Claude map?" })
      .fill(prompt);
    await page
      .getByRole("textbox", { name: "What should Claude map?" })
      .press("Enter");
    await page.getByRole("button", { name: /Engineering Map/ }).click();
    await page
      .getByRole("button", {
        name: source === "local" ? "A folder on this Mac" : "On GitHub",
      })
      .click();
    await expect(page.locator("#code-title")).toHaveValue(
      prompt.replace(/\s+/g, " ").slice(0, 80),
    );
    await page.locator("#code-title").fill("Launch architecture");
    await page
      .getByRole("button", { name: "Draw the map", exact: true })
      .click();
    await expect(page).toHaveURL(`${server.origin}/prompt-engineering/`);
    expect(pmRequests).toEqual([]);
    expect(requests).toEqual([
      {
        title: "Launch architecture",
        ...(source === "local"
          ? { folders: ["/code/shop-api"] }
          : { repos: [{ owner: "shop", name: "api" }] }),
        description: prompt,
      },
    ]);
  });
}

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
