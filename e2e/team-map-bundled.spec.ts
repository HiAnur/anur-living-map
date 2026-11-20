import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { openSample, useTeamServer } from "./team-map.harness.ts";

// The map inside the Mac app: the app brings every update, so the page shows the package version and says so,
// with nothing to click.

useTeamServer({ env: () => ({ ANUR_LIVING_MAP_BUNDLED: "1" }) });

test("the version pill shows the package version, says updates come with the app, and never updates", async ({
  page,
}) => {
  const { version } = JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dirname, "../team/live/package.json"),
      "utf8",
    ),
  );
  let asked = false;
  await page.route("**/api/update", (r) => {
    asked = true;
    return r.fulfill({ contentType: "application/json", body: "{}" });
  });
  await openSample(page);
  const pill = page.locator("#verb");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText(`v${version}`);
  await expect(pill).toHaveAttribute(
    "data-tip",
    `Living Map ${version}\nUpdates come with the app`,
  );
  await expect(pill).not.toHaveClass(/\bdue\b/);
  await pill.click();
  await expect(pill).toHaveText(`v${version}`);
  expect(asked).toBe(false);
});
