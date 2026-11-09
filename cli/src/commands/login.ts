import { homedir } from "node:os";
import { ApiError, DEFAULT_API_URL, Session, expiryFrom, rawRequest, type TokenPair } from "../api.js";
import type { Flags } from "../bin.js";
import { clearCredentials, credentialsPath, loadCredentials, saveCredentials } from "../credentials.js";
import { CliError, type Output } from "../output.js";
import { ask, requireTty } from "../prompt.js";
import { resolveSignupUrl } from "../signup.js";
import { pickEnvironment, type Environment } from "../userbox.js";

/**
 * POST /v1/auth/login. A 401 means unknown email, wrong password or unknown
 * tenant slug; the API does not say which, and neither does the CLI. The error
 * points to founder sign-up, which only receives a link, never the password.
 */
export async function logIn(
  apiUrl: string,
  creds: { email: string; password: string; tenantSlug: string },
): Promise<TokenPair> {
  try {
    return await rawRequest<TokenPair>(apiUrl, "/v1/auth/login", {
      method: "POST",
      body: { email: creds.email, password: creds.password, tenant_slug: creds.tenantSlug },
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const signupUrl = await resolveSignupUrl(apiUrl);
      throw new CliError(
        "INVALID_CREDENTIALS",
        "login failed: invalid email, password or tenant slug",
        `No account yet? Create one at ${signupUrl}`,
        { signup_url: signupUrl },
      );
    }
    throw err;
  }
}

interface Tenant {
  id: string;
  slug: string;
  name: string;
}

export async function login(flags: Flags, out: Output): Promise<void> {
  requireTty("login");
  const previous = loadCredentials();
  const apiUrl = (flags.apiUrl ?? previous?.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
  const tenantSlug = await ask("Tenant slug", { fallback: previous?.tenantSlug ?? "" });
  const email = await ask("Email", { fallback: previous?.email ?? "" });
  const password = await ask("Password", { secret: true });

  const tokens = await logIn(apiUrl, { email, password, tenantSlug });
  const tenant = await rawRequest<Tenant>(apiUrl, "/v1/tenants/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const sessionMinutes = await sessionDurationMinutes(apiUrl, tokens.access_token);
  saveCredentials({
    apiUrl,
    tenantSlug: tenant.slug,
    tenantId: tenant.id,
    email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiresAt: expiryFrom(tokens),
  });
  out.done({ tenant: { id: tenant.id, slug: tenant.slug }, email, apiUrl }, [
    `Logged in to ${tenant.name} (${tenant.slug}) as ${email}.`,
    `The login is stored in ${displayPath(credentialsPath())}. ${loginDurationLine(sessionMinutes)}`,
  ]);
}

/** The API caps a refresh token's lifetime at 7 days, whatever the setting. */
const MAX_SESSION_MINUTES = 7 * 24 * 60;

/**
 * The default environment's `session_duration_minutes`: refresh uses that
 * environment's setting. Best effort; `undefined` when it cannot be read.
 */
async function sessionDurationMinutes(apiUrl: string, accessToken: string): Promise<number | undefined> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    const { environments } = await rawRequest<{ environments: Environment[] }>(apiUrl, "/v1/environments", { headers });
    const env = pickEnvironment(environments);
    const settings = await rawRequest<{ session_duration_minutes?: number }>(
      apiUrl,
      `/v1/environments/${env.id}/auth-settings`,
      { headers },
    );
    const minutes = settings.session_duration_minutes;
    return typeof minutes === "number" && minutes > 0 ? minutes : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How long the stored login lasts. Each refresh rotates the refresh token
 * with a new lifetime of `session_duration_minutes` (at most 7 days), so the
 * login expires after that long without use, not at a fixed date.
 */
export function loginDurationLine(minutes: number | undefined): string {
  if (minutes === undefined) {
    return "It expires after a period without use set by the tenant's session duration (Console → Auth settings; 24 hours by default, at most 7 days).";
  }
  const window = formatMinutes(Math.min(minutes, MAX_SESSION_MINUTES));
  return `It expires after ${window} without use (the tenant's session duration).`;
}

export function formatMinutes(minutes: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes >= 2880 && minutes % 1440 === 0) return plural(minutes / 1440, "day");
  if (minutes % 60 === 0) return plural(minutes / 60, "hour");
  return plural(minutes, "minute");
}

/** `/home/ana/.config/userbox/credentials.json` → `~/.config/userbox/credentials.json`. */
export function displayPath(path: string, home: string = homedir()): string {
  return home && (path === home || path.startsWith(home + "/")) ? "~" + path.slice(home.length) : path;
}

export function logout(out: Output): void {
  clearCredentials();
  out.done({}, ["Logged out."]);
}

export async function whoami(out: Output): Promise<void> {
  const session = Session.load();
  const tenant = await session.request<Tenant>("/v1/tenants/me");
  out.done(
    { tenant: { id: tenant.id, slug: tenant.slug }, email: session.email, apiUrl: session.apiUrl },
    [`${session.email} on ${tenant.name} (${tenant.slug}), ${session.apiUrl}`],
  );
}
