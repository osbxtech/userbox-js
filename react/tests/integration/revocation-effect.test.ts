import { describe, expect, it } from "vitest";
import {
  API_URL,
  TENANT_SLUG,
  integrationEnabled,
  loginViaApi,
} from "./fixtures";

const ADMIN_TOKEN = process.env.USERBOX_TEST_ADMIN_TOKEN ?? "";

describe.skipIf(!integrationEnabled || !ADMIN_TOKEN)(
  "integration: admin session revocation invalidates user refresh tokens",
  () => {
    it("POST /v1/users/{id}/sessions/revoke kills the refresh token", async () => {
      const login = await loginViaApi();
      const revoke = await fetch(
        `${API_URL}/v1/users/${login.userId}/sessions/revoke`,
        {
          method: "POST",
          headers: {
            "X-Tenant-ID": TENANT_SLUG,
            Authorization: `Bearer ${ADMIN_TOKEN}`,
          },
        },
      );
      expect([200, 204]).toContain(revoke.status);

      const retry = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant-ID": TENANT_SLUG,
        },
        body: JSON.stringify({ refresh_token: login.refreshToken }),
      });
      expect(retry.status).toBe(400);
    });
  },
);
