/**
 * Shared helpers for integration tests. All tests in this directory are
 * skipped via `describe.skipIf` unless the four env vars below are set; with
 * USERBOX_INTEGRATION_REQUIRED=1 (CI) a missing variable fails the run instead
 * (global-setup.ts).
 *
 * The suite runs in public CI logs with a real user password. Never log these
 * values, and report a failed request by status and error code only.
 */

export const API_URL = process.env.USERBOX_API_URL ?? "";
export const TENANT_SLUG = process.env.USERBOX_TEST_TENANT_SLUG ?? "";
export const USER_EMAIL = process.env.USERBOX_TEST_USER_EMAIL ?? "";
export const USER_PASSWORD = process.env.USERBOX_TEST_USER_PASSWORD ?? "";

export const REQUIRED_ENV = [
  "USERBOX_API_URL",
  "USERBOX_TEST_TENANT_SLUG",
  "USERBOX_TEST_USER_EMAIL",
  "USERBOX_TEST_USER_PASSWORD",
] as const;

export const integrationEnabled = REQUIRED_ENV.every((name) => Boolean(process.env[name]));

/** The platform's error code from a failed response, or "none". Never the body. */
export async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : "none";
  } catch {
    return "none";
  }
}

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
    throw new Error(`integration: login failed: status ${res.status} code ${await errorCode(res)}`);
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
