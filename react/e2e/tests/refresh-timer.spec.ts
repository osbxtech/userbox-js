import { test, expect } from "@playwright/test";

test.skip(!process.env.USERBOX_E2E_STACK, "e2e stack not running");

test("12-minute refresh tick keeps session signed-in", async ({ page }) => {
  await page.goto("/dashboard");
  await page.clock.install({ time: new Date() });
  await page.clock.fastForward("12:30");
  await expect(page.getByTestId("signed-in-user-id")).toBeVisible();
});
