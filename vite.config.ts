import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: { "/api": "http://localhost:4317" } },
  test: {
    // e2e/ holds the browser tests, which Playwright runs
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      include: ["{ledger,server,web,skill,shared}/**/*.{ts,tsx}"],
      exclude: ["**/*.test.{ts,tsx}", "ledger/fixtures/**"],
      reporter: ["text", "html"],
      // a floor under the part every map depends on, a little below what
      // the tests reach, so a drop fails and a small move does not
      thresholds: {
        "ledger/**": { statements: 88, branches: 76, functions: 90, lines: 90 },
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // libraries in their own files: smaller chunks, cached across updates
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: "flow",
              test: /node_modules[\\/](@xyflow|@dagrejs|d3-[\w-]+)[\\/]/,
            },
            { name: "vendor", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
