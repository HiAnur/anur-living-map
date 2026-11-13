import { defineConfig } from "@playwright/test";

import team from "./playwright.config.ts";

// The chat map's browser tests: every spec in e2e/ but the team map's. They
// draw the fixture map (?fixture=1), which only a dev build lets past the
// sign-in, so they run on Vite alone: no server, no store, no model. The port
// is its own, so a dev server can stay up.
const PORT = 5199;

export default defineConfig({
  ...team,
  testMatch: undefined,
  testIgnore: /team-map.*\.spec\.ts$/,
  use: { ...team.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
