import { misconfigured, type UserboxError } from "./errors";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const MAX_RETURN_TO_LENGTH = 2048;

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

export function assertValidSlug(slug: string): void {
  if (typeof slug !== "string" || slug.length === 0) {
    throw misconfiguredField("tenantSlug", "tenantSlug is required");
  }
  if (!SLUG_REGEX.test(slug)) {
    throw misconfiguredField(
      "tenantSlug",
      "tenantSlug must match /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/",
    );
  }
}

export type AuthSurfaceUrlInput = {
  tenantSlug: string;
  /**
   * Userbox API base URL — e.g. `https://api.example.com` or
   * `http://api.example.localhost`. The auth-surface origin is derived
   * from this by replacing the leading DNS label with `{slug}.auth`:
   *   `https://api.example.com` → `https://{slug}.auth.example.com`
   *   `http://api.example.localhost` → `http://{slug}.auth.example.localhost`
   * This convention is intentional and hardcoded — tenant code never needs
   * to configure the auth URL separately.
   */
  baseUrl: string;
  /**
   * Optional override for the auth-surface origin. Use ONLY for
   * self-hosted Userbox deployments whose hostnames don't follow the
   * standard `api.{userbox-domain}` ↔ `{slug}.auth.{userbox-domain}`
   * convention. Managed (SaaS) deployments should leave this unset.
   */
  baseAuthUrl?: string;
  path: "/login" | "/signup";
  returnTo: string;
  state: string;
  flowId: string;
};

/**
 * Derive the auth surface origin from a Userbox API base URL by replacing
 * the leading DNS label with `{slug}.auth`.
 *
 * Examples:
 *   api.example.com + acme → acme.auth.example.com
 *   api.example.localhost + acme → acme.auth.example.localhost
 *   api.example.com:8443 + acme → acme.auth.example.com:8443
 */
export function deriveAuthOrigin(baseUrl: string, tenantSlug: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw misconfiguredField("baseUrl", "baseUrl must be a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw misconfiguredField("baseUrl", "baseUrl must be http(s)");
  }
  const host = url.hostname;
  const dotIdx = host.indexOf(".");
  if (dotIdx === -1) {
    throw misconfiguredField(
      "baseUrl",
      "baseUrl host must have at least two DNS labels (e.g. api.example.localhost)",
    );
  }
  const parent = host.substring(dotIdx + 1);
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${tenantSlug}.auth.${parent}${port}`;
}

export function buildAuthSurfaceUrl(input: AuthSurfaceUrlInput): string {
  assertValidSlug(input.tenantSlug);
  assertValidReturnTo(input.returnTo);
  const origin = input.baseAuthUrl ?? deriveAuthOrigin(input.baseUrl, input.tenantSlug);
  const trimmed = origin.replace(/\/+$/, "");
  const u = new URL(trimmed + input.path);
  u.searchParams.set("return_to", input.returnTo);
  u.searchParams.set("state", input.state);
  u.searchParams.set("flow_id", input.flowId);
  return u.toString();
}

export function assertValidReturnTo(returnTo: string, currentOrigin?: string): void {
  if (typeof returnTo !== "string" || returnTo.length === 0) {
    throw misconfiguredField("callbackUrl", "returnTo is required");
  }
  if (returnTo.length > MAX_RETURN_TO_LENGTH) {
    throw misconfiguredField(
      "callbackUrl",
      `returnTo exceeds maximum length (${MAX_RETURN_TO_LENGTH})`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(returnTo);
  } catch {
    throw misconfiguredField("callbackUrl", "returnTo must be an absolute URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw misconfiguredField("callbackUrl", "returnTo must be http(s)");
  }
  const origin = currentOrigin ?? safeWindowOrigin();
  if (origin && parsed.origin !== origin) {
    throw misconfiguredField(
      "callbackUrl",
      "returnTo must be same-origin with the calling app",
    );
  }
}

function safeWindowOrigin(): string | null {
  if (typeof window === "undefined") return null;
  if (typeof window.location?.origin !== "string") return null;
  return window.location.origin;
}

function misconfiguredField(
  field: Parameters<typeof misconfigured>[0],
  message: string,
): UserboxError {
  return misconfigured(field, message);
}
