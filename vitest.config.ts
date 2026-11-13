import { configDefaults, defineConfig } from "vitest/config";

// The tests of both maps, run by the root `vitest`. They need no page build,
// so this stands on its own, apart from vite.config.ts (the chat map's page).
export default defineConfig({
  test: {
    // e2e/ holds the browser tests, which Playwright runs
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["{ledger,server,web,skill,shared}/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "**/*.harness.ts", "ledger/fixtures/**"],
      reporter: ["text", "html"],
      // a floor under the part every map depends on, a little below what
      // the tests reach, so a drop fails and a small move does not
      thresholds: {
        "ledger/**": { statements: 88, branches: 76, functions: 90, lines: 90 },
      },
    },
  },
});
