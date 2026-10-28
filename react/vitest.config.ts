import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/architectural/**/*.test.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**", "**/tests/integration/**"],
    environmentMatchGlobs: [
      ["tests/unit/react/**", "jsdom"],
      ["tests/unit/UserboxCallback*", "jsdom"],
      ["tests/unit/core/**", "node"],
      ["tests/unit/nextjs/**", "node"],
      ["tests/architectural/**", "node"],
    ],
    setupFiles: ["./tests/setup.ts"],
  },
});
