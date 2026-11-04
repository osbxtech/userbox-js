import { DEFAULT_API_URL, Session, expiryFrom, rawRequest, type TokenPair } from "../api.js";
import type { Flags } from "../bin.js";
import { clearCredentials, loadCredentials, saveCredentials } from "../credentials.js";
import type { Output } from "../output.js";
import { ask, requireTty } from "../prompt.js";

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

  const tokens = await rawRequest<TokenPair>(apiUrl, "/v1/auth/login", {
    method: "POST",
    body: { email, password, tenant_slug: tenantSlug },
  });
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
