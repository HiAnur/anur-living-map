import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  box,
  openSample,
  SAMPLE,
  server,
  useTeamServer,
} from "./team-map.harness.ts";

useTeamServer();

test("remembers the last map view across local addresses", async ({ page }) => {
  await openSample(page);
  const map = new URL(page.url());
  const view = (name: string) => page.getByRole("radio", { name, exact: true });
  const openMenu = () => page.locator("#peopleb").click();
  const saved = () =>
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/me/map-view",
    );

  await openMenu();
  await expect(view("Engineer")).toHaveAttribute("aria-checked", "true");

  // Import the PM choice kept by an older version on this address.
  await page.evaluate(() => localStorage.setItem("lm.view", "pm"));
  const imported = saved();
  await page.reload();
  expect((await imported).ok()).toBe(true);
  await expect(page.locator("body")).toHaveClass(/mind-view/);

  const other = new URL(map);
  other.hostname = "127.0.0.1";
  await page.goto(other.href);
  await expect(page.locator("body")).toHaveClass(/mind-view/);
  await openMenu();
  await expect(view("PM")).toHaveAttribute("aria-checked", "true");

  const engineer = saved();
  await view("Engineer").click();
  expect((await engineer).ok()).toBe(true);
  await page.goto(map.href);
  await openMenu();
  await expect(view("Engineer")).toHaveAttribute("aria-checked", "true");

  const pm = saved();
  await view("PM").click();
  expect((await pm).ok()).toBe(true);
  await page.goto(other.href);
  await expect(page.locator("body")).toHaveClass(/mind-view/);
});

const middle = (node: Locator) =>
  node.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

async function usePm(page: Page) {
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "PM", exact: true }).click();
}

for (const id of ["trial", "pricing", "launch"]) {
  test(`PM wraps the full long ${id} name while typing and after saving`, async ({
    page,
  }) => {
    await openSample(page);
    await usePm(page);
    const title =
      "Understanding is still needed in the world of Claude and other AI tools";
    const fits = (element: Locator) =>
      element.evaluate(
        (el) =>
          el.isConnected &&
          el.clientHeight > 0 &&
          el.scrollWidth <= el.clientWidth + 1 &&
          el.scrollHeight <= el.clientHeight + 1,
      );
    const node = page.locator(`#nodes .node[data-id="${id}"]`);
    await node.click();
    await page.keyboard.press("F2");
    const editor = page.locator("#newbox textarea");
    await editor.fill(title);
    await expect.poll(() => fits(editor)).toBe(true);
    await expect(editor).toHaveValue(title);
    await page.keyboard.press("Enter");
    const name = node.locator(".nt");
    await expect(name).toHaveText(title);
    await expect.poll(() => fits(name)).toBe(true);
    await expect
      .poll(() =>
        name.evaluate(
          (el) =>
            el.isConnected &&
            el.clientHeight >
              parseFloat(getComputedStyle(el).lineHeight) * 1.5 &&
            el.clientWidth <= 302,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`full-${id}-name.png`),
    });
    await page.reload();
    await expect(name).toHaveText(title);
    await expect.poll(() => fits(name)).toBe(true);
  });
}

for (const parent of ["Launch plan", "Pricing"]) {
  test(`a new PM topic under ${parent} wraps while typing`, async ({
    page,
  }) => {
    await openSample(page);
    await usePm(page);
    await box(page, parent).click();
    await page.keyboard.press("Tab");
    const title =
      "Understanding is still needed in the world of Claude and other AI tools";
    const editor = page.locator("#newbox textarea");
    await page.keyboard.type(title);
    await expect(editor).toHaveValue(title);
    const size = await editor.evaluate((el) => ({
      clipped:
        el.scrollHeight > el.clientHeight + 1 ||
        el.scrollWidth > el.clientWidth + 1,
      lines: el.clientHeight / parseFloat(getComputedStyle(el).lineHeight),
      width: el.clientWidth,
    }));
    expect(size.clipped).toBe(false);
    expect(size.lines).toBeGreaterThan(1.5);
    expect(size.width).toBeLessThanOrEqual(332);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.locator("#nodes .nt", { hasText: title })).toHaveText(
      title,
    );
  });
}

test("PM topic names stay vertically centered while typing", async ({
  page,
}) => {
  await openSample(page);
  await usePm(page);
  for (const parent of ["Launch plan", "Pricing"]) {
    await box(page, parent).click();
    await page.keyboard.press("Tab");
    const editor = page.locator("#newbox textarea");
    await expect(editor).toBeVisible();
    await page.keyboard.type("Customer");
    const offset = await editor.evaluate((el) => {
      const style = getComputedStyle(el);
      const textMiddle =
        parseFloat(style.borderTopWidth) +
        parseFloat(style.paddingTop) +
        parseFloat(style.lineHeight) / 2;
      return Math.abs(textMiddle - parseFloat(style.height) / 2);
    });
    await page.screenshot({
      path: test
        .info()
        .outputPath(`${parent.toLowerCase().replaceAll(" ", "-")}-name.png`),
    });
    expect(offset, `name under ${parent}`).toBeLessThan(1);
    await page.keyboard.press("Escape");
  }
});

async function dragTo(page: Page, source: Locator, x: number, y: number) {
  const start = await middle(source);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
}

test("repeated Tab extends a PM branch horizontally without moving it down", async ({
  page,
}) => {
  await openSample(page);
  await usePm(page);
  const root = page.locator("#nodes .mind-root");
  await expect(root).toHaveText("Launch plan");
  await expect(root).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(root).toHaveCSS("border-radius", "999px");
  await expect(
    page.getByRole("button", { name: "Collapse Pricing", exact: true }),
  ).toBeVisible();
  const parent = box(page, "Free trial");
  await parent.click();
  await expect(parent).toHaveClass(/sel/);
  const start = await middle(parent);
  const editor = page.locator("#newbox.on");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await expect(editor).toBeVisible();
    await expect(page.locator(".mind-pending")).toHaveCount(0);
    const at = await middle(editor);
    expect(Math.abs(at.y - start.y), `draft after Tab ${i + 1}`).toBeLessThan(
      2,
    );
    expect(
      Math.abs((await middle(parent)).y - start.y),
      `parent after Tab ${i + 1}`,
    ).toBeLessThan(2);
    expect(at.x).toBeGreaterThan((await middle(parent)).x);
    const bounds = await editor.boundingBox();
    const canvas = await page.locator("#canvas").boundingBox();
    expect(bounds).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
      canvas!.x + canvas!.width - 15,
    );
  }
});

test("dropping a PM branch onto a topic saves the new parent and carries its children", async ({
  page,
}) => {
  const name = await openSample(page);
  await usePm(page);
  const pricing = box(page, "Pricing"),
    trial = box(page, "Free trial");
  const audience = await middle(box(page, "Audience"));
  await dragTo(page, pricing, audience.x, audience.y);
  await expect(page.locator("#rubber .drag-ghost-box")).toHaveCount(2);
  const marker = page.locator("#rubber .attach-box");
  await expect(marker).toBeVisible();
  await expect(marker).toHaveCSS("stroke-dasharray", "none");
  await expect(marker).toHaveCSS("fill-opacity", "1");
  const outline = page.locator("#rubber .attach-target");
  const join = await page
    .locator("#rubber .attach-line")
    .evaluate((el: SVGPathElement) => ({
      start: el.getPointAtLength(0).x,
      end: el.getPointAtLength(el.getTotalLength()).x,
    }));
  const outlineRight =
    Number(await outline.getAttribute("x")) +
    Number(await outline.getAttribute("width"));
  expect(join.start).toBeCloseTo(outlineRight);
  expect(join.end).toBeCloseTo(Number(await marker.getAttribute("x")));
  await page.mouse.up();
  await expect(page.locator("#rubber .drag-ghost")).toHaveCount(0);
  await expect
    .poll(async () => {
      const state = await (
        await page.request.get(`${server.origin}/${name}/api/state`)
      ).json();
      return state.edges;
    })
    .toEqual([
      { from: "launch", to: "audience" },
      { from: "pricing", to: "trial" },
      { from: "audience", to: "pricing" },
    ]);
  await page.reload();
  await expect(pricing).toHaveClass(/mind-leaf/);
  expect((await middle(trial)).x).toBeGreaterThan((await middle(pricing)).x);
});

for (const layout of ["Right", "Left"]) {
  test(`${layout} PM child drop marks the space below existing children`, async ({
    page,
  }) => {
    const state = {
      ...SAMPLE,
      edges: [
        { from: "launch", to: "pricing" },
        { from: "launch", to: "audience" },
        { from: "audience", to: "trial" },
      ],
    };
    const name = await openSample(page, state);
    await usePm(page);
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.getByRole("button", { name: layout, exact: true }).click();
    await page.keyboard.press("Escape");
    const target = await middle(box(page, "Audience"));
    const child = box(page, "Free trial");
    const before = await child.boundingBox();
    await dragTo(page, box(page, "Pricing"), target.x, target.y);
    const marker = page.locator("#rubber .attach-box");
    await expect(marker).toBeVisible();
    const hint = await marker.boundingBox();
    expect(hint!.y).toBeGreaterThan(before!.y + before!.height);
    expect(await child.boundingBox()).toEqual(before);
    await page.screenshot({
      path: test.info().outputPath("child-drop-marker.png"),
    });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const saved = await (
          await page.request.get(`${server.origin}/${name}/api/state`)
        ).json();
        return saved.edges.some(
          (edge: { from: string; to: string }) =>
            edge.from === "audience" && edge.to === "pricing",
        );
      })
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await middle(box(page, "Pricing"))).y - (await middle(child)).y,
      )
      .toBeGreaterThan(0);
  });
}

test("PM vertical drops reorder siblings and keep their line labels", async ({
  page,
}) => {
  const state = {
    ...SAMPLE,
    edges: [{ ...SAMPLE.edges[0], label: "Plans" }, ...SAMPLE.edges.slice(1)],
  };
  const name = await openSample(page, state);
  await usePm(page);
  const pricing = box(page, "Pricing"),
    audience = box(page, "Audience");
  for (const direction of [1, -1]) {
    const target = await audience.boundingBox();
    expect(target).not.toBeNull();
    await dragTo(
      page,
      pricing,
      target!.x + target!.width / 2,
      target!.y + target!.height / 2 + direction * (target!.height / 2 + 6),
    );
    const marker = page.locator("#rubber rect.mind-drop-slot");
    await expect(marker).toHaveAttribute("rx", "8");
    await expect(marker).toHaveCSS("stroke-dasharray", "none");
    await expect(marker).not.toHaveCSS("fill", "none");
    await expect(page.locator("#rubber .attach-line")).toBeVisible();
    const slot = await marker.boundingBox();
    expect(slot).not.toBeNull();
    const gap =
      direction > 0
        ? slot!.y - (target!.y + target!.height)
        : target!.y - (slot!.y + slot!.height);
    expect(gap).toBeGreaterThan(0);
    await page.mouse.up();
    await expect
      .poll(async () => {
        const saved = await (
          await page.request.get(`${server.origin}/${name}/api/state`)
        ).json();
        const rows = new Map<string, number>(
          saved.nodes.map((n: { id: string; y: number }) => [n.id, n.y]),
        );
        return {
          order: Math.sign(rows.get("pricing")! - rows.get("audience")!),
          edges: saved.edges,
        };
      })
      .toEqual({ order: direction, edges: state.edges });
    await page.reload();
    expect(
      Math.sign((await middle(pricing)).y - (await middle(audience)).y),
    ).toBe(direction);
  }
});

test("PM can reorder loose topics inside a box without adding lines", async ({
  page,
}) => {
  const inside = {
    nodes: [
      { id: "founders", label: "Founders", x: 300, y: -80 },
      { id: "teachers", label: "Teachers", x: 300, y: 80 },
    ],
    edges: [],
  };
  const name = await openSample(page, {
    ...SAMPLE,
    nodes: SAMPLE.nodes.map((n) =>
      n.id === "audience" ? { ...n, inside } : n,
    ),
  });
  await usePm(page);
  await box(page, "Audience").locator(".expand").click();
  const founders = box(page, "Founders"),
    teachers = box(page, "Teachers");
  const target = await teachers.boundingBox();
  expect(target).not.toBeNull();
  await dragTo(
    page,
    founders,
    target!.x + target!.width / 2,
    target!.y + target!.height + 6,
  );
  await expect(page.locator("#rubber rect.mind-drop-slot")).toHaveCount(1);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const saved = await (
        await page.request.get(`${server.origin}/${name}/api/state`)
      ).json();
      const nested = saved.nodes.find(
        (n: { id: string }) => n.id === "audience",
      ).inside;
      return {
        reordered: nested.nodes[0].y > nested.nodes[1].y,
        edges: nested.edges,
      };
    })
    .toEqual({ reordered: true, edges: [] });
  expect((await middle(founders)).y).toBeGreaterThan(
    (await middle(teachers)).y,
  );
});

test("a PM drop on empty canvas leaves the branch and camera in place", async ({
  page,
}) => {
  await openSample(page);
  await usePm(page);
  const source = box(page, "Pricing");
  const start = await middle(source);
  const canvas = await page.locator("#canvas").boundingBox();
  await dragTo(page, source, canvas!.x + 20, canvas!.y + 20);
  await expect(page.locator("#rubber .drag-ghost")).toBeVisible();
  await expect(page.locator("#rubber .attach-box")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("#rubber .drag-ghost")).toHaveCount(0);
  expect(await middle(source)).toEqual(start);
});

test("left layout joins a dropped branch on the left and keeps its children", async ({
  page,
}) => {
  const name = await openSample(page);
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Left", exact: true }).click();
  await page.keyboard.press("Escape");
  const pricing = box(page, "Pricing"),
    trial = box(page, "Free trial");
  const audience = await middle(box(page, "Audience"));
  await dragTo(page, pricing, audience.x, audience.y);
  const marker = page.locator("#rubber .attach-box");
  await expect(marker).toBeVisible();
  const hint = await marker.boundingBox();
  expect(hint!.x + hint!.width).toBeLessThan(audience.x);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const state = await (
        await page.request.get(`${server.origin}/${name}/api/state`)
      ).json();
      return state.edges.some(
        (edge: { from: string; to: string }) =>
          edge.from === "audience" && edge.to === "pricing",
      );
    })
    .toBe(true);
  expect((await middle(trial)).x).toBeLessThan((await middle(pricing)).x);
  await page.reload();
  expect((await middle(pricing)).x).toBeLessThan(
    (await middle(box(page, "Audience"))).x,
  );
});

for (const layout of ["Right", "Left"]) {
  test(`${layout} layout detects a sibling drop before the pointer reaches the topic`, async ({
    page,
  }) => {
    const name = await openSample(page);
    await page.getByRole("button", { name: "Design", exact: true }).click();
    await page.getByRole("button", { name: layout, exact: true }).click();
    await page.keyboard.press("Escape");
    if (layout === "Left") {
      await page.locator("#zoomout").click();
      await page.locator("#zoomout").click();
    }
    const pricing = box(page, "Pricing"),
      audience = box(page, "Audience");
    const target = await audience.boundingBox();
    expect(target).not.toBeNull();
    // Begin the preview while still 90 screen pixels below the topic and outside its title column.
    await dragTo(
      page,
      pricing,
      target!.x + target!.width + 24,
      target!.y + target!.height + 90,
    );
    const marker = page.locator("#rubber rect.mind-drop-slot");
    await expect(marker).toBeVisible();
    await expect(page.locator("#rubber .attach-target")).toBeVisible();
    const saved = await (
      await page.request.get(`${server.origin}/${name}/api/state`)
    ).json();
    expect(saved.edges).toEqual(SAMPLE.edges);
    await page.mouse.up();
    await expect
      .poll(async () => (await middle(pricing)).y > (await middle(audience)).y)
      .toBe(true);
    const state = await (
      await page.request.get(`${server.origin}/${name}/api/state`)
    ).json();
    expect(state.edges).toEqual(SAMPLE.edges);
    await page.reload();
    expect((await middle(pricing)).y).toBeGreaterThan(
      (await middle(audience)).y,
    );
  });
}
