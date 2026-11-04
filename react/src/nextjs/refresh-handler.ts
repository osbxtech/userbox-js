/**
 * Cookie-mode refresh route for the Next.js App Router:
 *
 * ```ts
 * // app/api/auth/refresh/route.ts
 * import { createRefreshHandler } from "@userbox/react/nextjs";
 * export const { POST } = createRefreshHandler();
 * ```
 *
 * Built on the Web `Request` / `Response` API only (no `next/*` import), so it
 * also runs in any runtime with `fetch`.
 */

export type RefreshHandlerConfig = {
  /** Tenant API base URL. Default: `NEXT_PUBLIC_USERBOX_API_URL`, then `USERBOX_API_URL`. */
  apiUrl?: string;
  /** Tenant slug (`X-Tenant-ID`). Default: `NEXT_PUBLIC_USERBOX_TENANT_SLUG`. */
  tenantSlug?: string;
  /**
   * The app's own origin, e.g. `https://app.example.com`. A request whose
   * `Origin` header is present and differs is refused (403). It also decides
   * the cookie's `Secure` flag (`https:` → Secure). Default: `APP_ORIGIN`.
   */
  appOrigin?: string;
  /** Refresh cookie name. Default `ub_refresh`. */
  cookieName?: string;
  /** Cookie `Path`; must contain the route. Default `/api/auth`. */
  cookiePath?: string;
  /** Cookie `Max-Age` in seconds. Default 7 days (the refresh-token TTL). */
  cookieMaxAge?: number;
};

export type RefreshRouteHandlers = {
  POST: (req: Request) => Promise<Response>;
};

const DEFAULT_COOKIE_NAME = "ub_refresh";
const DEFAULT_COOKIE_PATH = "/api/auth";
const DEFAULT_COOKIE_MAX_AGE = 7 * 24 * 3600;
const REJECTED_UPSTREAM: ReadonlySet<number> = new Set([400, 401, 403, 404, 422]);
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

type ResolvedConfig = {
  apiUrl: string;
  tenantSlug: string;
  appOrigin: string;
  cookieName: string;
  cookiePath: string;
  cookieMaxAge: number;
  secure: boolean;
};

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function pick(option: string | undefined, ...names: string[]): string | undefined {
  if (option !== undefined && option.trim() !== "") return option.trim();
  for (const name of names) {
    const value = env(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

class ConfigError extends Error {}

function resolveConfig(config: RefreshHandlerConfig): ResolvedConfig {
  const apiUrl = pick(config.apiUrl, "NEXT_PUBLIC_USERBOX_API_URL", "USERBOX_API_URL");
  const tenantSlug = pick(config.tenantSlug, "NEXT_PUBLIC_USERBOX_TENANT_SLUG");
  const rawOrigin = pick(config.appOrigin, "APP_ORIGIN");
  const missing = [
    apiUrl ? null : "apiUrl (NEXT_PUBLIC_USERBOX_API_URL)",
    tenantSlug ? null : "tenantSlug (NEXT_PUBLIC_USERBOX_TENANT_SLUG)",
    rawOrigin ? null : "appOrigin (APP_ORIGIN)",
  ].filter((m): m is string => m !== null);
  if (missing.length > 0) throw new ConfigError(`missing ${missing.join(", ")}`);

  let appOrigin: string;
  try {
    const url = new URL(rawOrigin!);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    appOrigin = url.origin;
  } catch {
    throw new ConfigError("appOrigin (APP_ORIGIN) must be an http(s) origin such as https://app.example.com");
  }
  const cookieName = config.cookieName ?? DEFAULT_COOKIE_NAME;
  if (!COOKIE_NAME.test(cookieName)) throw new ConfigError("cookieName is not a valid cookie name");
  const cookiePath = config.cookiePath ?? DEFAULT_COOKIE_PATH;
  if (!cookiePath.startsWith("/") || /[;\s]/.test(cookiePath)) throw new ConfigError("cookiePath must be an absolute path");

  return {
    apiUrl: apiUrl!.replace(/\/+$/, ""),
    tenantSlug: tenantSlug!,
    appOrigin,
    cookieName,
    cookiePath,
    cookieMaxAge: Math.floor(config.cookieMaxAge ?? DEFAULT_COOKIE_MAX_AGE),
    secure: appOrigin.startsWith("https:"),
  };
}

function error(status: number, code: string): Response {
  return Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function serializeCookie(c: ResolvedConfig, value: string, maxAge: number): string {
  const parts = [
    `${c.cookieName}=${encodeURIComponent(value)}`,
    `Path=${c.cookiePath}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (maxAge === 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (c.secure) parts.push("Secure");
  return parts.join("; ");
}

function setCookie(res: Response, c: ResolvedConfig, value: string): Response {
  res.headers.append("Set-Cookie", serializeCookie(c, value, c.cookieMaxAge));
  return res;
}

function clearCookie(res: Response, c: ResolvedConfig): Response {
  res.headers.append("Set-Cookie", serializeCookie(c, "", 0));
  return res;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      const value = decodeURIComponent(raw);
      return value === "" ? null : value;
    } catch {
      return null;
    }
  }
  return null;
}

type RefreshBody = { action?: unknown; refresh_token?: unknown };
type UpstreamRefresh = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
};

async function handle(req: Request, c: ResolvedConfig): Promise<Response> {
  // CSRF guards: JSON only (no simple form posts), and a present Origin must be ours.
  if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return error(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== c.appOrigin) return error(403, "ORIGIN_NOT_ALLOWED");

  const body = (await req.json().catch(() => null)) as RefreshBody | null;
  if (body === null || typeof body !== "object") return error(400, "INVALID_REQUEST");

  if (body.action === "init") {
    if (typeof body.refresh_token !== "string" || body.refresh_token === "") return error(400, "INVALID_REQUEST");
    return setCookie(noContent(), c, body.refresh_token);
  }

  const refreshToken = readCookie(req, c.cookieName);

  if (body.action === "logout") {
    const auth = req.headers.get("authorization");
    if (refreshToken && auth?.startsWith("Bearer ")) {
      await fetch(`${c.apiUrl}/v1/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth, "X-Tenant-ID": c.tenantSlug },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }).catch(() => undefined);
    }
    return clearCookie(noContent(), c);
  }

  if (body.action !== undefined) return error(400, "INVALID_REQUEST");
  if (refreshToken === null) return error(401, "NO_REFRESH_COOKIE");

  const upstream = await fetch(`${c.apiUrl}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Tenant-ID": c.tenantSlug },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }).catch(() => null);
  if (upstream === null) return error(502, "UPSTREAM_UNAVAILABLE");

  if (upstream.ok) {
    const d = (await upstream.json().catch(() => null)) as UpstreamRefresh | null;
    if (
      d === null ||
      typeof d.access_token !== "string" ||
      typeof d.refresh_token !== "string" ||
      typeof d.expires_in !== "number"
    ) {
      return error(502, "UPSTREAM_UNAVAILABLE");
    }
    // The refresh token never reaches the browser: only the access token and lifetimes.
    const res = Response.json(
      {
        access_token: d.access_token,
        expires_in: d.expires_in,
        ...(typeof d.refresh_expires_in === "number" ? { refresh_expires_in: d.refresh_expires_in } : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    // Refresh tokens are single-use: always store the rotated one.
    return setCookie(res, c, d.refresh_token);
  }
  if (REJECTED_UPSTREAM.has(upstream.status)) {
    return clearCookie(error(401, "REFRESH_REJECTED"), c);
  }
  return error(502, "UPSTREAM_UNAVAILABLE");
}

/**
 * Creates the route handler that `<UserboxProvider tokenStorage="cookie">`
 * calls at `refreshUrl` (default `/api/auth/refresh`). It accepts three JSON
 * bodies:
 *
 * - `{ action: "init", refresh_token }` (from `<UserboxCallback>`): stores the
 *   refresh token in an `HttpOnly; SameSite=Strict` cookie scoped to
 *   `/api/auth` (`Secure` when the app origin is `https:`).
 * - `{}`: exchanges the cookie at `POST /v1/auth/refresh`, stores the rotated
 *   refresh token and returns `{ access_token, expires_in }`. A rejected token
 *   clears the cookie (401 `REFRESH_REJECTED`).
 * - `{ action: "logout" }`: revokes the refresh token upstream (best effort)
 *   and clears the cookie.
 *
 * Requests that are not `application/json`, or whose `Origin` is present and
 * not `appOrigin`, are refused before anything else happens. The refresh token
 * is never returned to the browser or logged. Missing configuration is
 * reported at request time (500 `CONFIG_ERROR`), so `next build` does not
 * need the variables.
 */
export function createRefreshHandler(config: RefreshHandlerConfig = {}): RefreshRouteHandlers {
  let resolved: ResolvedConfig | null = null;
  return {
    async POST(req: Request): Promise<Response> {
      if (resolved === null) {
        try {
          resolved = resolveConfig(config);
        } catch (err) {
          if (!(err instanceof ConfigError)) throw err;
          console.warn(`[@userbox/react] createRefreshHandler: ${err.message}`);
          return error(500, "CONFIG_ERROR");
        }
      }
      return handle(req, resolved);
    },
  };
}
