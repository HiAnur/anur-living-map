import { expect, test, type Page } from "@playwright/test";

// The chat map is retired: every screen says so, names what replaces it and
// how to remove it, signed in or not.

const notice = (page: Page) => page.locator("[data-retired]");

async function expectNotice(page: Page) {
  await expect(notice(page)).toBeVisible();
  await expect(notice(page)).toHaveText(
    "Living Map (chat) is retired. Use Anur Living Map: /anur-living-map. To remove this one: node skill/uninstall.ts",
  );
}

test.beforeEach(async ({ page }) => {
  // no server behind the page: answer its calls here, not through the proxy
  await page.route("**/api/**", (r) => r.fulfill({ status: 502 }));
});

test("the map says it is retired, above the map itself", async ({ page }) => {
  await page.goto("/?fixture=1");
  await expect(
    page.getByRole("application").getByRole("button", {
      name: /^Networking for the clusters/,
    }),
  ).toBeVisible();
  await expectNotice(page);
  const bar = await notice(page).boundingBox();
  expect(bar?.y).toBe(0);
});

test("the signed-out page says it too", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Show my maps" }),
  ).toBeVisible();
  await expectNotice(page);
});
