import { expect, test, type Page } from "@playwright/test";

// What the map's screen itself decides, on the fixture map: where the
// camera starts and goes, what Esc closes first, the tips, the strip alone,
// what an empty map says, and how a lens and the list work together.

const NOW = "i36"; // the topic Claude is on in the fixture
const TASK = "i46"; // "Add peering routes # both directions", under it
const TASK_TITLE = "Add peering routes # both directions";
const CARD_W = 400;

let crashes: string[];

async function open(page: Page, fixture = "1") {
  // no server behind the fixture: answer its calls here, not through the proxy
  await page.route("**/api/**", (r) => r.fulfill({ status: 502 }));
  await page.goto(`/?fixture=${fixture}`);
}

const box = (page: Page, name: string | RegExp) =>
  page.getByRole("application").getByRole("button", { name });
const tool = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name, exact: true });
const noTips = (page: Page) =>
  page.getByRole("button", { name: "No more tips" }).click();

// where a box sits in the pane the map is drawn in, once the camera rests
async function place(page: Page, id: string) {
  const pane = (await page.getByRole("main").boundingBox())!;
  const b = (await page
    .locator(`.react-flow__node[data-id="${id}"]`)
    .boundingBox())!;
  return {
    left: b.x - pane.x,
    top: b.y - pane.y,
    midX: b.x - pane.x + b.width / 2,
    midY: b.y - pane.y + b.height / 2,
    paneW: pane.width,
    paneH: pane.height,
  };
}
type Place = Awaited<ReturnType<typeof place>>;

// the camera glides: asked again until the box is where it should be
const lands = (
  page: Page,
  id: string,
  want: (p: Place) => Partial<Record<keyof Place, number>>,
) =>
  expect(async () => {
    const p = await place(page, id);
    for (const [k, v] of Object.entries(want(p)))
      expect(Math.abs(p[k as keyof Place] - v), k).toBeLessThanOrEqual(2);
  }).toPass({ timeout: 5000 });

async function search(page: Page, text: string) {
  await tool(page, "Search").click();
  await page.getByLabel("Search the map").fill(text);
  await page
    .getByRole("main")
    .getByRole("listitem")
    .first()
    .getByRole("button")
    .click();
}

test.beforeEach(({ page }) => {
  crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e)));
});

test.afterEach(() => {
  expect(crashes).toEqual([]);
});

test.describe("the camera on a wide pane", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("starts at the chat's root, top left", async ({ page }) => {
    await open(page);
    await lands(page, "root", () => ({ left: 16, top: 16 }));
  });

  test("Now frames the topic Claude is on and follows it until you move the map", async ({
    page,
  }) => {
    await open(page);
    await noTips(page);
    await tool(page, "Now").click();
    await expect(tool(page, "Now")).toHaveAttribute("aria-pressed", "true");
    await lands(page, NOW, () => ({ left: 16, top: 120 }));
    const pane = (await page.getByRole("main").boundingBox())!;
    await page.mouse.move(pane.x + 900, pane.y + 500);
    await page.mouse.down();
    await page.mouse.move(pane.x + 860, pane.y + 460, { steps: 4 });
    await page.mouse.up();
    await expect(tool(page, "Now")).toHaveAttribute("aria-pressed", "false");
  });

  test("a picked item lands beside its card, and above its side chat", async ({
    page,
  }) => {
    await open(page);
    await noTips(page);
    await search(page, TASK_TITLE);
    await expect(page.getByRole("dialog", { name: TASK_TITLE })).toBeVisible();
    await lands(page, TASK, (p) => ({
      midX: (p.paneW - CARD_W) / 2,
      midY: p.paneH / 2,
    }));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Ask about this" })
      .click();
    await expect(
      page.getByRole("region", { name: `Side chat on ${TASK_TITLE}` }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await lands(page, TASK, (p) => ({
      midX: p.paneW / 2,
      midY: p.paneH / 4,
    }));
  });

  test("Fold all brings the camera back to the root", async ({ page }) => {
    await open(page);
    await noTips(page);
    await tool(page, "Now").click();
    await lands(page, NOW, () => ({ left: 16, top: 120 }));
    await tool(page, "Fold all").click();
    await expect(tool(page, "Now")).toHaveAttribute("aria-pressed", "false");
    await lands(page, "root", () => ({ left: 16, top: 120 }));
  });
});

test.describe("the camera on a narrow pane", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("starts on the topic Claude is on, and Now puts it at the top", async ({
    page,
  }) => {
    await open(page);
    await lands(page, NOW, () => ({ left: 8 }));
    await noTips(page);
    await tool(page, "Now").click();
    await lands(page, NOW, () => ({ left: 8, top: 16 }));
  });

  test("a picked item comes down from under its card", async ({ page }) => {
    await open(page);
    await noTips(page);
    await search(page, TASK_TITLE);
    await lands(page, TASK, (p) => ({
      midX: p.paneW / 2,
      midY: p.paneH * 0.75,
    }));
  });
});

test("Esc closes the search, then the card, then the side chat, then the list", async ({
  page,
}) => {
  await open(page);
  await noTips(page);
  await tool(page, "List").click();
  await box(page, /^Keep Nebula or move to VPC peering\?/).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ask about this" })
    .click();
  await box(page, /^Keep Nebula or move to VPC peering\?/).click();
  await page.keyboard.press("ControlOrMeta+f");
  const find = page.getByLabel("Search the map");
  const card = page.getByRole("dialog");
  const side = page.getByRole("region", { name: /^Side chat on/ });
  const list = page.getByRole("complementary");
  await expect(find).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(find).toHaveCount(0);
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(side).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(side).toHaveCount(0);
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
});

test("tips go one at a time, off for good, and back when asked", async ({
  page,
}) => {
  await open(page);
  const tip = page.getByRole("note");
  await expect(tip).toContainText("Amber means it waits on you");
  await tip.getByRole("button", { name: "Next" }).click();
  await expect(tip).toBeVisible();
  await expect(tip).not.toContainText("Amber means it waits on you");
  await noTips(page);
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(box(page, /^Networking for the clusters/)).toBeVisible();
  await expect(tip).toHaveCount(0);
  await tool(page, "More").click();
  await page.getByText("Show tips again").click();
  await expect(tip).toContainText("Amber means it waits on you");
});

test("Strip only hides the map, and the strip still opens what waits", async ({
  page,
}) => {
  await open(page);
  await noTips(page);
  await tool(page, "More").click();
  await page.getByText("Strip only").click();
  await expect(page.getByRole("application")).toHaveCount(0);
  await expect(tool(page, "Show the map")).toBeVisible();
  await page.reload();
  await expect(tool(page, "Show the map")).toBeVisible();
  await page.getByRole("button", { name: "Push ui/chat-map-header?" }).click();
  await expect(page.getByRole("application")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Push ui/chat-map-header?" }),
  ).toBeVisible();
});

test("an empty map says why it is empty", async ({ page }) => {
  await open(page, "empty");
  await expect(
    page.getByText("Nothing filed yet", { exact: true }),
  ).toBeVisible();
  await open(page, "reading");
  await expect(page.getByText("Reading your chat")).toBeVisible();
  await expect(page.getByText("120 of 400 turns so far.")).toBeVisible();
  await open(page, "error");
  await expect(
    page.getByText("The map couldn't file the latest turns."),
  ).toBeVisible();
});

test("the Changed lens offers the changes, and the list opens on them", async ({
  page,
}) => {
  await open(page);
  await noTips(page);
  await page.getByRole("button", { name: "Changed 1" }).click();
  await expect(
    page.getByText("changes in your system this session"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show them" }).click();
  await expect(
    page.getByRole("complementary").getByRole("heading").first(),
  ).toHaveText("Changed in your system");
});

test("the Decided lens puts decisions on top of the list", async ({ page }) => {
  await open(page);
  await noTips(page);
  const first = page.getByRole("complementary").getByRole("heading").first();
  await tool(page, "List").click();
  await expect(first).toHaveText(/^Waiting on you/);
  await page.getByRole("button", { name: "Decided 8" }).click();
  await expect(first).toHaveText(/^Decided/);
  await page.getByRole("button", { name: "Decided 8" }).click();
  await expect(first).toHaveText(/^Waiting on you/);
});

test("the new-items chip steps through what was filed since you looked", async ({
  page,
}) => {
  await open(page);
  await noTips(page);
  await page.getByRole("button", { name: "Next new item" }).click();
  await expect(page.getByText("1/7")).toBeVisible();
  await page.getByRole("button", { name: "Next new item" }).click();
  await expect(page.getByText("2/7")).toBeVisible();
  await page.getByTitle("Done looking").click();
  await expect(page.getByRole("button", { name: "Next new item" })).toHaveCount(
    0,
  );
});
