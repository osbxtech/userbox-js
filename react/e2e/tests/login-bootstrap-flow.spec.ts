import { test, expect } from "@playwright/test";

/**
 * Cross-subdomain bootstrap.
 * Skipped unless the local stack is up (USERBOX_E2E_STACK=1).
 */
test.skip(!process.env.USERBOX_E2E_STACK, "e2e stack not running");

test("user signs in on auth-surface subdomain, lands on sample app signed-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /sign in/i }).click();
  // Auth surface lives on a sibling subdomain. The sample-next-app's middleware
  // refreshes the access token after the callback.
  await page.fill('input[type="email"]', "test@acme.test");
  await page.fill('input[type="password"]', "changeme");
  await page.getByRole("button", { name: /continue|sign in/i }).click();
  await expect(page.getByTestId("signed-in-user-id")).toBeVisible({ timeout: 10_000 });
});
