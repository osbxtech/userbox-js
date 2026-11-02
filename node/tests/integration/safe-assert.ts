/**
 * Assertions for the integration suite that never print a credential.
 *
 * The suite runs in public CI logs with a real API key and a real user
 * password. A failure therefore reports the HTTP status and the platform's
 * error code only: never a request header, a token, a key, a response body
 * or an SDK error message.
 */

import { UserboxError } from "../../src/errors";
import { API_URL, TENANT_SLUG, USER_EMAIL, USER_PASSWORD } from "./fixtures";

function describeFailure(err: unknown): string {
  if (err instanceof UserboxError) return `status ${err.status} code ${err.code}`;
  return `non-HTTP error ${err instanceof Error ? err.name : typeof err}`;
}

/** Awaits an SDK call that must succeed. */
export async function expectOk<T>(call: Promise<T>, what: string): Promise<T> {
  try {
    return await call;
  } catch (err) {
    throw new Error(`${what}: expected success, got ${describeFailure(err)}`);
  }
}

/** Awaits an SDK call that must fail with this status and error code. */
export async function expectUserboxError(
  call: Promise<unknown>,
  what: string,
  expected: { status: number; code: string },
): Promise<void> {
  const want = `status ${expected.status} code ${expected.code}`;
  let err: unknown;
  try {
    await call;
  } catch (e) {
    err = e;
  }
  if (err === undefined) throw new Error(`${what}: expected ${want}, got success`);
  if (!(err instanceof UserboxError) || err.status !== expected.status || err.code !== expected.code) {
    throw new Error(`${what}: expected ${want}, got ${describeFailure(err)}`);
  }
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === "string" ? body.code : "none";
  } catch {
    return "none";
  }
}

/** Signs the synthetic user in and returns its access token (a JWT). */
export async function loginAccessToken(): Promise<string> {
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tenant-ID": TENANT_SLUG },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login: expected 200, got status ${res.status} code ${await errorCode(res)}`);
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") throw new Error("login: response has no access_token");
  return body.access_token;
}

/** The synthetic user's id, from GET /v1/users/me with its JWT. */
export async function currentUserId(accessToken: string): Promise<string> {
  const res = await fetch(`${API_URL}/v1/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, "X-Tenant-ID": TENANT_SLUG },
  });
  if (!res.ok) throw new Error(`users/me: expected 200, got status ${res.status} code ${await errorCode(res)}`);
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new Error("users/me: response has no id");
  return body.id;
}
