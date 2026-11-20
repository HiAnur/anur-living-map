import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { server, useTeamServer } from "./team-map.harness.ts";

// A meeting's map as it grows: topics round the centre circle and points drawn under them one at a time, in the
// order talk comes back to them. On the page, each topic's points stay in a block of their own beside it, so two
// topics never share a stem.

useTeamServer();

type Rect = { id: string; x: number; y: number; w: number; h: number };

test("each topic's points stay in their own block as a meeting map grows", async ({
  page,
}) => {
  const name = "meeting-blocks";
  fs.mkdirSync(path.join(server.root, "app", "maps", name), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(server.root, "app", "maps", name, "state.json"),
    JSON.stringify({
      title: "Weekly sync",
      start: "meeting",
      nodes: [
        { id: "meeting", label: "Weekly sync", sub: "Meeting", x: 0, y: 0 },
      ],
      edges: [],
      calls: [],
      people: [],
    }),
  );
  await page.goto(`${server.origin}/${name}/`);
  await expect(page.locator("#nodes .node")).toHaveCount(1);

  const draw = (id: string, under: string) =>
    fetch(`${server.origin}/${name}/api/act`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "edit",
        by: "Duy",
        nodes: [{ id, label: `About ${id}`, sub: "From the call" }],
        edges: [{ from: under, to: id }],
      }),
    });
  const order = [
    ["t1", "meeting"],
    ["t1a", "t1"],
    ["t2", "meeting"],
    ["t2a", "t2"],
    ["t1b", "t1"],
    ["t3", "meeting"],
    ["t3a", "t3"],
    ["t2b", "t2"],
    ["t1c", "t1"],
    ["t4", "meeting"],
    ["t3b", "t3"],
    ["t2c", "t2"],
    ["t4a", "t4"],
    ["t1d", "t1"],
    ["t4b", "t4"],
    ["t3c", "t3"],
  ];
  for (const [id, under] of order)
    expect((await draw(id, under)).ok).toBe(true);
  await expect(page.locator("#nodes .node")).toHaveCount(order.length + 1);

  const rects: Rect[] = await page.$$eval("#nodes .node", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        id: (e as HTMLElement).dataset.id || "",
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        w: r.width,
        h: r.height,
      };
    }),
  );
  const at = new Map(rects.map((r) => [r.id, r]));
  const centre = at.get("meeting")!;
  const bands = ["t1", "t2", "t3", "t4"].map((t) => {
    const topic = at.get(t)!;
    const points = rects.filter((r) => r.id.startsWith(t) && r.id !== t);
    const side = Math.sign(topic.x - centre.x);
    // every point sits beside its topic, further out from the circle
    for (const p of points) expect(Math.sign(p.x - topic.x)).toBe(side);
    const tops = [topic, ...points].map((r) => r.y - r.h / 2);
    const bottoms = [topic, ...points].map((r) => r.y + r.h / 2);
    return {
      t,
      side,
      top: Math.min(...tops),
      bottom: Math.max(...bottoms),
    };
  });
  for (const a of bands)
    for (const b of bands)
      if (a.t < b.t && a.side === b.side)
        expect(
          a.bottom <= b.top || b.bottom <= a.top,
          `${a.t} and ${b.t} overlap`,
        ).toBe(true);
});
