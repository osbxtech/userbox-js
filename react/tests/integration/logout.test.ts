import { describe, expect, it } from "vitest";
import {
  API_URL,
  TENANT_SLUG,
  integrationEnabled,
  loginViaApi,
} from "./fixtures";

describe.skipIf(!integrationEnabled)("integration: logout invalidates refresh token", () => {
  it("/v1/auth/logout makes the refresh token unusable", async () => {
    const login = await loginViaApi();
    const logout = await fetch(`${API_URL}/v1/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": TENANT_SLUG,
        Authorization: `Bearer ${login.accessToken}`,
      },
      body: JSON.stringify({ refresh_token: login.refreshToken }),
    });
    expect([200, 204]).toContain(logout.status);

    const retry = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": TENANT_SLUG,
      },
      body: JSON.stringify({ refresh_token: login.refreshToken }),
    });
    expect(retry.status).toBe(400);
    const body = (await retry.json()) as { code?: string };
    expect(body.code).toBe("INVALID_REFRESH_TOKEN");
  });
});
