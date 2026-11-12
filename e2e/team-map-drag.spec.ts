import { expect, test } from "@playwright/test";

import { box, openSample, server, useTeamServer } from "./team-map.harness.ts";

useTeamServer();

for (const direction of [-1, 1]) {
  test(`vertical drop previews and saves ${direction < 0 ? "above" : "below"} a neighbor`, async ({
    page,
  }) => {
    const name = await openSample(page);
    const source = await box(page, "Free trial").boundingBox();
    const target = await box(page, "Audience").boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
    await page.mouse.move(
      source!.x + source!.width / 2,
      source!.y + source!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      target!.x + target!.width / 2,
      target!.y + target!.height / 2 + direction * (target!.height / 2 + 8),
      { steps: 12 },
    );
    const hint = page.locator("#rubber .attach-box");
    await expect(hint).toBeVisible();
    const landing = await hint.boundingBox();
    expect((landing!.y - target!.y) * direction).toBeGreaterThan(0);
    const x = Number(await hint.getAttribute("x"));
    const y = Number(await hint.getAttribute("y"));
    const width = Number(await hint.getAttribute("width"));
    const height = Number(await hint.getAttribute("height"));
    // Above Audience is between it and Pricing: a thin bar marks the gap instead of a full box over them.
    if (direction < 0) expect(height).toBe(10);
    await page.screenshot({
      path: test.info().outputPath("vertical-drop.png"),
    });
    await page.mouse.up();
    await expect(hint).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await (
          await page.request.get(`${server.origin}/${name}/api/state`)
        ).json();
        const moved = state.nodes.find((n: { id: string }) => n.id === "trial");
        return {
          x: moved.x,
          // Between Pricing (-90) and Audience (90) the box lands in that gap; below Audience it lands on the box.
          y: direction < 0 ? moved.y > -90 && moved.y < 90 : moved.y,
          parent: state.edges.find((e: { to: string }) => e.to === "trial")
            .from,
        };
      })
      .toEqual({
        x: x + width / 2,
        y: direction < 0 ? true : y + height / 2,
        parent: "launch",
      });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect
      .poll(async () => {
        const state = await (
          await page.request.get(`${server.origin}/${name}/api/state`)
        ).json();
        return state.edges.find((e: { to: string }) => e.to === "trial").from;
      })
      .toBe("pricing");
  });
}
