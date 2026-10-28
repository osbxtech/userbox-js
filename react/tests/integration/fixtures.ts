/**
 * Shared helpers for integration tests. All tests in this directory are
 * skipped via `describe.skipIf` unless the four env vars below are set.
 */

export const API_URL = process.env.USERBOX_API_URL ?? "";
export const TENANT_SLUG = process.env.USERBOX_TEST_TENANT_SLUG ?? "";
export const USER_EMAIL = process.env.USERBOX_TEST_USER_EMAIL ?? "";
export const USER_PASSWORD = process.env.USERBOX_TEST_USER_PASSWORD ?? "";

export const integrationEnabled =
  Boolean(API_URL) && Boolean(TENANT_SLUG) && Boolean(USER_EMAIL) && Boolean(USER_PASSWORD);

export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
};

export async function loginViaApi(): Promise<LoginResult> {
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-ID": TENANT_SLUG,
    },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`integration: login failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user?: { id?: string };
  };
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    userId: body.user?.id ?? "",
  };
}
