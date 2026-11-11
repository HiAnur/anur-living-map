import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { server, useTeamServer } from "./team-map.harness.ts";

// Trace a request on a system map box: the card's button follows the facts behind the box through the code and opens
// the steps as the box's sequence.

useTeamServer();

const app = {
  repo: "app",
  facts: [
    {
      id: "f1",
      kind: "api_call",
      at: "src/orders.ts:3",
      method: "GET",
      path: "/orders/{id}",
    },
  ],
};
const orders = {
  repo: "orders",
  facts: [
    {
      id: "f1",
      kind: "function",
      at: "cdk.out/Orders.json#GetOrderFn",
      name: "GetOrder",
      routes: ["GET /orders/{orderId}"],
      may: [{ services: ["dynamodb:GetItem"], on: ["OrdersTable"] }],
    },
    {
      id: "f2",
      kind: "table",
      at: "cdk.out/Orders.json#OrdersTable",
      name: "orders-table",
    },
  ],
};
const links = [
  {
    id: "x1",
    kind: "calls_route",
    at: "links",
    route: "GET /orders/{}",
    from: "app:f1",
    to: "orders:f1",
    fromRepo: "app",
    toRepo: "orders",
  },
];

test("Trace a request follows a box's call through the code and opens the steps", async ({
  page,
}) => {
  const name = `t-trace`;
  const dir = path.join(server.root, "app", "maps", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "system-facts.json"),
    JSON.stringify({ readings: [app, orders], links }),
  );
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({
      title: "Shop system",
      people: [{ id: "Duy", role: "Admin", sees: "all" }],
      calls: [],
      edges: [],
      start: "app",
      drawing: { status: "done", at: 1, by: "Duy", repos: 2, progress: [] },
      nodes: [
        {
          id: "app",
          label: "Shop app",
          sub: "Where people order",
          x: 0,
          y: 0,
          source: { kind: "code", repo: "app", facts: ["f1"] },
        },
        {
          id: "orders",
          label: "Orders",
          sub: "Takes orders",
          x: 300,
          y: 0,
          source: { kind: "code", repo: "orders", facts: ["f2"] },
        },
      ],
    }),
  );
  await page.goto(`${server.origin}/${name}/?brain-box=app`);
  await page.getByRole("button", { name: "Trace a request" }).click();
  // the box opens into its sequence: the call, then what the function reads
  const stage = page.locator("body");
  await expect(stage).toContainText("Trace: Shop app");
  await expect(stage).toContainText("GET /orders/{}");
  await expect(stage).toContainText("dynamodb:GetItem");
  await expect(stage).toContainText("orders-table");
});
