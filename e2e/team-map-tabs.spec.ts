import { expect, test, type Page } from "@playwright/test";

import { openSample, server, useTeamServer } from "./team-map.harness.ts";

useTeamServer();

// A test browser shows every tab at once, so a tab goes behind another, or comes back, by its page being told so.
const lookAt = (page: Page, looking: boolean) =>
  page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, !looking);

const boxes = (page: Page) => page.locator("#nodes .node");

// A browser keeps six connections to one site, and a map being followed holds one of them.
test("a seventh tab of a map loads while six are open behind it", async ({
  context,
  page,
}) => {
  const name = await openSample(page);
  const behind = [page];
  for (let i = 0; i < 5; i++) {
    const tab = await context.newPage();
    await tab.goto(`${server.origin}/${name}/`);
    await expect(boxes(tab)).toHaveCount(4);
    behind.push(tab);
  }
  for (const tab of behind) await lookAt(tab, false);

  const seventh = await context.newPage();
  await seventh.goto(`${server.origin}/${name}/`, { timeout: 10_000 });
  await expect(boxes(seventh)).toHaveCount(4);
});

test("a tab that was behind another shows what changed, where you left it", async ({
  page,
}) => {
  const name = await openSample(page);
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 240);
  const stage = page.locator("#stage");
  await expect(stage).not.toHaveAttribute("style", /scale\(1\)/);
  const camera = await stage.getAttribute("style");

  await lookAt(page, false);
  const added = await fetch(`${server.origin}/${name}/api/act`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "edit",
      by: "Duy",
      nodes: [{ id: "late", label: "Late box", sub: "Added while away" }],
      edges: [{ from: "launch", to: "late" }],
    }),
  });
  expect(added.ok).toBe(true);

  await lookAt(page, true);
  await expect(boxes(page)).toHaveCount(5);
  expect(await stage.getAttribute("style")).toBe(camera);
});
