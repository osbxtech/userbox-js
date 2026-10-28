import { test, expect } from "@playwright/test";

test.skip(!process.env.USERBOX_E2E_STACK, "e2e stack not running");

test("server-side revocation forces sign-out on next refresh", async ({ page, request }) => {
  await page.goto("/dashboard");
  const userId = await page.getByTestId("signed-in-user-id").textContent();
  await request.post(`${process.env.USERBOX_API_URL}/v1/users/${userId}/sessions/revoke`, {
    headers: {
      "X-Tenant-ID": process.env.USERBOX_TEST_TENANT_SLUG ?? "acme-test",
      Authorization: `Bearer ${process.env.USERBOX_TEST_ADMIN_TOKEN}`,
    },
  });
  await page.clock.install({ time: new Date() });
  await page.clock.fastForward("13:00");
  await expect(page.getByTestId("signed-out")).toBeVisible();
});
