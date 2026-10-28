import { NextResponse, type NextRequest } from "next/server";
import { request } from "../core/http";
import {
  authFailed,
  networkError,
  refreshFailed,
  type UserboxError,
} from "../core/errors";

export type MiddlewareConfig = {
  tenantSlug: string;
  baseUrl: string;
  refreshCookieName?: string;
  accessTokenHeader?: string;
  cookieDomain?: string;
  cookieSecure?: boolean;
  cookieSameSite?: "lax" | "strict" | "none";
  matcher?: string[];
  onError?: (err: UserboxError, req: NextRequest) => void;
};

const DEFAULT_REFRESH_COOKIE_NAME = "ub_refresh";
const DEFAULT_ACCESS_TOKEN_HEADER = "x-userbox-access-token";
const PERMANENT_STATUSES: ReadonlySet<number> = new Set([400, 401, 403]);

let warnedNoCookie = false;

type RefreshHttpResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
};

export function userboxMiddleware(
  config: MiddlewareConfig,
): (req: NextRequest) => Promise<NextResponse> {
  const refreshCookieName = config.refreshCookieName ?? DEFAULT_REFRESH_COOKIE_NAME;
  const accessTokenHeader = config.accessTokenHeader ?? DEFAULT_ACCESS_TOKEN_HEADER;
  const cookieSecure = config.cookieSecure ?? process.env.NODE_ENV !== "development";
  const sameSite = config.cookieSameSite ?? "lax";

  return async function middleware(req: NextRequest): Promise<NextResponse> {
    const cookie = req.cookies.get(refreshCookieName);
    if (!cookie || !cookie.value) {
      if (!warnedNoCookie) {
        warnedNoCookie = true;
        // Warn on storage-mode mismatch.
        console.warn(
          "[@userbox/react] userboxMiddleware: no refresh cookie present on this request. " +
            "If the app uses tokenStorage: 'memory', the middleware should not be installed.",
        );
      }
      return NextResponse.next();
    }

    const res = await request<RefreshHttpResponse>({
      url: `${config.baseUrl}/v1/auth/refresh`,
      method: "POST",
      tenantSlug: config.tenantSlug,
      body: { refresh_token: cookie.value },
      errorKind: "refresh",
    });

    if (!res.ok) {
      const err = res.error;
      const isPermanent =
        (err.kind === "refresh_failed" || err.kind === "auth_failed") &&
        PERMANENT_STATUSES.has(err.httpStatus);
      const response = NextResponse.next();
      if (isPermanent) {
        response.cookies.delete(refreshCookieName);
        config.onError?.(err, req);
      } else {
        // Transient — preserve the cookie; surface error; let next request retry.
        config.onError?.(err, req);
      }
      return response;
    }

    const data = res.data;
    const accessToken = typeof data.access_token === "string" ? data.access_token : "";
    const newRefresh = typeof data.refresh_token === "string" ? data.refresh_token : "";
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 0;
    const refreshExpiresIn =
      typeof data.refresh_expires_in === "number"
        ? data.refresh_expires_in
        : expiresIn;
    if (!accessToken || !newRefresh || !expiresIn) {
      const response = NextResponse.next();
      config.onError?.(
        networkError("Refresh response missing fields"),
        req,
      );
      return response;
    }

    // Forward the access token via a request header. We mutate the incoming
    // headers in a new NextResponse since req.headers is readable but tunnels
    // must be set on the response's request rewrite.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set(accessTokenHeader, accessToken);

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    response.cookies.set(refreshCookieName, newRefresh, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite,
      ...(config.cookieDomain ? { domain: config.cookieDomain } : {}),
      maxAge: refreshExpiresIn,
      path: "/",
    });

    // refreshFailed reference suppression
    void refreshFailed; void authFailed;
    return response;
  };
}
