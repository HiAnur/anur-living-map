import { defineConfig, devices } from "@playwright/test";

// The browser tests draw the fixture map (?fixture=1), which only a dev
// build lets past the sign-in, so they run on Vite alone: no server, no
// store, no model. The port is its own, so a dev server can stay up.
const PORT = 5199;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
