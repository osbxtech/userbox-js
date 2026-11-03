import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

// getUnverifiedSession() reads next/headers; point it at the headers the
// middleware forwarded.
let forwarded = new Headers();
vi.mock("next/headers.js", () => ({ headers: async () => forwarded }));

import { userboxMiddleware } from "../../../src/nextjs/middleware";
import { getUnverifiedSession } from "../../../src/nextjs/server";

const FAR_FUTURE = 4_102_444_800; // 2100-01-01, seconds

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

const FORGED = makeJwt({ sub: "attacker-chosen", tid: "victim-tenant", exp: FAR_FUTURE });

function makeReq(opts: { cookie?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers.cookie = `ub_refresh=${opts.cookie}`;
  return new NextRequest(new URL("http://localhost:3000/dashboard"), { headers });
}

// The request headers Next.js hands to Server Components after the middleware ran.
function forwardedHeaders(res: NextResponse): Headers {
  const names = res.headers.get("x-middleware-override-headers");
  expect(names, "middleware must override the forwarded request headers").not.toBeNull();
  const out = new Headers();
  for (const name of (names ?? "").split(",").filter(Boolean)) {
    const value = res.headers.get(`x-middleware-request-${name}`);
    if (value !== null) out.set(name, value);
  }
  return out;
}

function mockRefresh(status: number, body: Record<string, unknown>): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

const config = { tenantSlug: "acme", baseUrl: "https://api.example.test" };

beforeEach(() => {
  forwarded = new Headers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("forged access-token header", () => {
  it("no cookie: the header is stripped and getUnverifiedSession() returns null", async () => {
    const res = await userboxMiddleware(config)(
      makeReq({ headers: { "x-userbox-access-token": FORGED } }),
    );
    forwarded = forwardedHeaders(res);
    expect(forwarded.get("x-userbox-access-token")).toBeNull();
    expect(await getUnverifiedSession()).toBeNull();
  });

  it("permanent refresh failure: stripped, null", async () => {
    mockRefresh(401, { code: "INVALID_REFRESH_TOKEN", error: "invalid" });
    const res = await userboxMiddleware({ ...config, onError: () => {} })(
      makeReq({ cookie: "rt-bad", headers: { "x-userbox-access-token": FORGED } }),
    );
    forwarded = forwardedHeaders(res);
    expect(await getUnverifiedSession()).toBeNull();
  });

  it("transient refresh failure: stripped, null", async () => {
    mockRefresh(503, { code: "UPSTREAM_DOWN", error: "down" });
    const res = await userboxMiddleware({ ...config, onError: () => {} })(
      makeReq({ cookie: "rt-ok", headers: { "x-userbox-access-token": FORGED } }),
    );
    forwarded = forwardedHeaders(res);
    expect(await getUnverifiedSession()).toBeNull();
  });

  it("malformed refresh response: stripped, null", async () => {
    mockRefresh(200, { access_token: "", refresh_token: "" });
    const res = await userboxMiddleware({ ...config, onError: () => {} })(
      makeReq({ cookie: "rt-ok", headers: { "x-userbox-access-token": FORGED } }),
    );
    forwarded = forwardedHeaders(res);
    expect(await getUnverifiedSession()).toBeNull();
  });

  it("refresh success: the refreshed token replaces the forged one", async () => {
    const real = makeJwt({ sub: "real-user", tid: "acme-tenant", exp: FAR_FUTURE });
    mockRefresh(200, { access_token: real, refresh_token: "rt-new", expires_in: 900 });
    const res = await userboxMiddleware(config)(
      makeReq({ cookie: "rt-ok", headers: { "x-userbox-access-token": FORGED } }),
    );
    forwarded = forwardedHeaders(res);
    expect(forwarded.get("x-userbox-access-token")).toBe(real);
    const session = await getUnverifiedSession();
    expect(session?.user.id).toBe("real-user");
  });

  it("a custom accessTokenHeader is stripped too", async () => {
    const res = await userboxMiddleware({ ...config, accessTokenHeader: "x-app-token" })(
      makeReq({ headers: { "x-app-token": FORGED } }),
    );
    forwarded = forwardedHeaders(res);
    expect(forwarded.get("x-app-token")).toBeNull();
    expect(await getUnverifiedSession({ accessTokenHeader: "x-app-token" })).toBeNull();
  });

  it("other request headers are still forwarded", async () => {
    const res = await userboxMiddleware(config)(
      makeReq({ headers: { "x-userbox-access-token": FORGED, "accept-language": "pt" } }),
    );
    expect(forwardedHeaders(res).get("accept-language")).toBe("pt");
  });
});

describe("getUnverifiedSession()", () => {
  it("returns null for an expired token", async () => {
    forwarded = new Headers({
      "x-userbox-access-token": makeJwt({ sub: "u", tid: "t", exp: 1 }),
    });
    expect(await getUnverifiedSession()).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    forwarded = new Headers({ "x-userbox-access-token": "not-a-jwt" });
    expect(await getUnverifiedSession()).toBeNull();
  });
});
