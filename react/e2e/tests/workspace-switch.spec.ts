import { test, expect } from "@playwright/test";

test.skip(!process.env.USERBOX_E2E_STACK, "e2e stack not running");

test("workspace switch issues exactly one new permissions fetch", async ({ page }) => {
  await page.goto("/dashboard");
  const calls: string[] = [];
  await page.route("**/v1/access/permissions*", async (route) => {
    calls.push(route.request().url());
    await route.continue();
  });
  await page.getByTestId("workspace-w1").click();
  await page.getByTestId("workspace-w2").click();
  expect(calls.length).toBe(2);
});
