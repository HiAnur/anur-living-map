import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  box,
  openSample,
  SAMPLE,
  server,
  useTeamServer,
} from "./team-map.harness.ts";

useTeamServer();

const middle = (node: Locator) =>
  node.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

async function usePm(page: Page) {
  await page.locator("#peopleb").click();
  await page.getByRole("radio", { name: "PM", exact: true }).click();
}

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
  await expect(page.locator("#nodes .fold")).toHaveCount(0);
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
