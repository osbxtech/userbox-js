import { ApiError, DEFAULT_API_URL, Session, expiryFrom, rawRequest, type TokenPair } from "../api.js";
import type { Flags } from "../bin.js";
import { clearCredentials, loadCredentials, saveCredentials } from "../credentials.js";
import { CliError, type Output } from "../output.js";
import { ask, requireTty } from "../prompt.js";
import { resolveSignupUrl } from "../signup.js";

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
    "The login is stored in ~/.config/userbox/credentials.json and lasts 7 days of inactivity.",
  ]);
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
