import { describe, expect, it, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { userboxMiddleware } from "../../../src/nextjs/middleware";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function makeReq(opts: {
  url?: string;
  cookies?: Record<string, string>;
} = {}): NextRequest {
  const url = opts.url ?? "http://localhost:3000/dashboard";
  const req = new NextRequest(new URL(url), {
    headers: opts.cookies
      ? { cookie: Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join("; ") }
      : {},
  });
  return req;
}

afterEach(() => vi.restoreAllMocks());

describe("userboxMiddleware: refresh success", () => {
  it("rotates the refresh cookie and forwards the access token header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          access_token: makeJwt({ sub: "u", tid: "t", exp: 9999 }),
          refresh_token: "rt-rotated",
          expires_in: 900,
          refresh_expires_in: 60 * 60 * 24 * 7,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const mw = userboxMiddleware({
      tenantSlug: "acme",
      baseUrl: "https://api.example.test",
    });
    const res = await mw(makeReq({ cookies: { ub_refresh: "rt-old" } }));
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ub_refresh=rt-rotated");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
  });
});

describe("userboxMiddleware: permanent failure", () => {
  it("clears the refresh cookie on 400 INVALID_REFRESH_TOKEN", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({ code: "INVALID_REFRESH_TOKEN", error: "invalid" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    const onError = vi.fn();
    const mw = userboxMiddleware({
      tenantSlug: "acme",
      baseUrl: "https://api.example.test",
      onError,
    });
    const res = await mw(makeReq({ cookies: { ub_refresh: "rt-bad" } }));
    const setCookie = res.headers.get("set-cookie") ?? "";
    // Expect a cookie-deletion directive (Max-Age=0 or expires past).
    expect(setCookie).toContain("ub_refresh=");
    expect(/Max-Age=0|Expires=/.test(setCookie)).toBe(true);
    expect(onError).toHaveBeenCalled();
  });
});

describe("userboxMiddleware: transient failure preserves cookie", () => {
  it("on 503 the refresh cookie is NOT cleared", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({ code: "UPSTREAM_DOWN", error: "down" }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      ),
    );
    const onError = vi.fn();
    const mw = userboxMiddleware({
      tenantSlug: "acme",
      baseUrl: "https://api.example.test",
      onError,
    });
    const res = await mw(makeReq({ cookies: { ub_refresh: "rt-survives" } }));
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toBe("");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("userboxMiddleware: no cookie pass-through", () => {
  it("returns NextResponse.next() with no auth header when no refresh cookie", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const mw = userboxMiddleware({
      tenantSlug: "acme",
      baseUrl: "https://api.example.test",
    });
    const res = await mw(makeReq());
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
