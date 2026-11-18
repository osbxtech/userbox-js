import { defineConfig } from "vitest/config";

// DOM-dependent tests run under jsdom; everything else under node.
// (vitest 3 removed `environmentMatchGlobs`; `projects` replaces it.)
const JSDOM_TESTS = ["tests/unit/react/**/*.test.{ts,tsx}", "tests/unit/UserboxCallback*.test.{ts,tsx}"];

export default defineConfig({
  test: {
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**", "**/tests/integration/**"],
    setupFiles: ["./tests/setup.ts"],
    projects: [
      {
        extends: true,
        test: { name: "jsdom", environment: "jsdom", include: JSDOM_TESTS },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/unit/**/*.test.{ts,tsx}", "tests/architectural/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**", "**/tests/integration/**", ...JSDOM_TESTS],
        },
      },
    ],
  },
});
