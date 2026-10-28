import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  use: {
    headless: true,
    baseURL: process.env.USERBOX_E2E_APP_URL ?? "http://app.userbox.localhost:3001",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
