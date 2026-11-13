import { defineConfig, devices } from "@playwright/test";

// The team map's browser tests (e2e/team-map*.spec.ts). Each file starts its
// own copy of the team server (team-map.harness.ts), so this config starts
// nothing. The chat map's tests run under playwright.chat.config.ts.
export default defineConfig({
  testDir: "e2e",
  testMatch: /team-map.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
