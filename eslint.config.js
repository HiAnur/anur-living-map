// Lint rules: recommended JS and TypeScript rules, React hooks,
// imports ordered (external, blank line, internal), and Prettier as a rule.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import importX from "eslint-plugin-import-x";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // build output, and local folders that are not the app (see .gitignore)
  globalIgnores([
    "dist/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "out/**",
    "cache/**",
    "data/**",
    "lm/**",
    ".claude/**",
    "team/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["web/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      "server/**/*.ts",
      "eval/**/*.ts",
      "ledger/**/*.ts",
      "shared/**/*.ts",
      "e2e/**/*.ts",
      "*.config.{js,ts}",
      ".ncurc.cjs",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    plugins: { "import-x": importX },
    rules: {
      "import-x/order": [
        "error",
        {
          groups: [
            ["builtin", "external"],
            ["internal", "parent", "sibling", "index"],
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "linebreak-style": ["error", "unix"],
      // a file past this holds more than one thing: split it by what it does
      "max-lines": [
        "error",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // new code is TypeScript; the two below are tool settings read as they
    // are (team/ is not linted, and its JavaScript is type-checked instead)
    files: ["**/*.{js,jsx,mjs,cjs}"],
    ignores: ["eslint.config.js", ".ncurc.cjs"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message: "Write new files in TypeScript (.ts or .tsx).",
        },
      ],
    },
  },
  {
    // the one file still over the limit from when it was set: take it off
    // in the change that splits it, and add none
    files: ["eval/changes-retro.ts"],
    rules: { "max-lines": "off" },
  },
  prettierRecommended,
]);
