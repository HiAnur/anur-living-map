import { expect, test, type Page } from "@playwright/test";

// The map's screen, driven the way you use it, on the fixture map. These hold
// what the unit tests cannot see: that the components still work together
// after one of them is moved or split.

const WAIT = "Keep Nebula or move to VPC peering?";
const WAIT_BOX = /^Keep Nebula or move to VPC peering\?/;
const TOPIC = /^Networking for the clusters/;

let crashes: string[];

const box = (page: Page, name: string | RegExp) =>
  page.getByRole("application").getByRole("button", { name });

test.beforeEach(async ({ page }) => {
  crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e)));
  // no server behind the fixture: answer its calls here, not through the proxy
  await page.route("**/api/**", (r) => r.fulfill({ status: 502 }));
  await page.goto("/?fixture=1");
  await expect(box(page, TOPIC)).toBeVisible();
  await page.getByRole("button", { name: "No more tips" }).click();
});

test.afterEach(() => {
  expect(crashes).toEqual([]);
});

test("draws the map with its lenses", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Waiting 4" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open 10" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Decided 8" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Changed 1" })).toBeVisible();
  await expect(box(page, WAIT_BOX)).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
});

test("a lens lights its items and steps through them", async ({ page }) => {
  const waiting = page.getByRole("button", { name: /^Waiting/ });
  await waiting.click();
  await expect(waiting).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("–/4")).toBeVisible();
  await page.getByRole("button", { name: "Next lit item" }).click();
  await expect(page.getByText("1/4")).toBeVisible();
  await page.getByRole("button", { name: "Next lit item" }).click();
  await expect(page.getByText("2/4")).toBeVisible();
  await waiting.click();
  await expect(waiting).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Next lit item" })).toHaveCount(
    0,
  );
});

test("a box opens its card, and Esc closes it", async ({ page }) => {
  await box(page, WAIT_BOX).click();
  const card = page.getByRole("dialog", { name: WAIT });
  await expect(card.getByRole("heading", { name: WAIT })).toBeVisible();
  const send = card.getByRole("button", { name: "Send" });
  await expect(send).toBeDisabled();
  await card.getByRole("textbox").fill("Move to peering");
  await expect(send).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("answering a wait takes it off the Waiting lens", async ({ page }) => {
  await box(page, WAIT_BOX).click();
  await page
    .getByRole("dialog", { name: WAIT })
    .getByRole("button", { name: "Answered" })
    .click();
  await expect(page.getByRole("button", { name: "Waiting 3" })).toBeVisible();
});

test("Fold all hides what topics hold, Unfold all brings it back", async ({
  page,
}) => {
  const inside = box(page, /^VPC peering between regions/);
  await expect(inside).toBeVisible();
  await page.getByRole("button", { name: "Fold all" }).click();
  await expect(inside).toHaveCount(0);
  await expect(box(page, TOPIC)).toBeVisible();
  await page.getByRole("button", { name: "Unfold all" }).click();
  await expect(inside).toBeVisible();
});

test("search finds an item by its title and opens it", async ({ page }) => {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search the map").fill("peering routes");
  const hits = page.getByRole("main").getByRole("listitem");
  await expect(hits).toHaveCount(2);
  await hits
    .filter({ hasText: "Add peering routes" })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("dialog", { name: /^Add peering routes/ }),
  ).toBeVisible();
});

test("the list shows the same items by group and opens one", async ({
  page,
}) => {
  await page.getByRole("button", { name: "List" }).click();
  const list = page.getByRole("complementary");
  await expect(
    list.getByRole("heading", { name: "Waiting on you 4" }),
  ).toBeVisible();
  await expect(list.getByRole("heading", { name: "Decided 8" })).toBeVisible();
  await list
    .getByRole("button", { name: /^Push ui\/chat-map-header\?/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Push ui/chat-map-header?" }),
  ).toBeVisible();
  await list.getByRole("button", { name: "Close the list" }).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);
});
