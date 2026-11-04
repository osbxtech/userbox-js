import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createRefreshHandler } from "../../../src/nextjs";

const API = "https://api.example.test";
const ORIGIN = "https://app.example.test";
const URL_ = `${ORIGIN}/api/auth/refresh`;

function post(
  body: unknown,
  opts: { origin?: string | null; contentType?: string | null; cookie?: string; authorization?: string; raw?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (opts.contentType !== null) headers["content-type"] = opts.contentType ?? "application/json";
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.authorization) headers.authorization = opts.authorization;
  return new Request(URL_, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

const handler = () => createRefreshHandler({ apiUrl: API, tenantSlug: "acme", appOrigin: ORIGIN });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("createRefreshHandler: CSRF guards", () => {
  let fetchMock: MockInstance<typeof fetch>;
  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch");
  });

  it("refuses a cross-origin refresh (403) without calling upstream or touching the cookie", async () => {
    const res = await handler().POST(post({}, { origin: "https://evil.example", cookie: "ub_refresh=rt" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "ORIGIN_NOT_ALLOWED" } });
    expect(cookies(res)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin init (cookie injection)", async () => {
    const res = await handler().POST(post({ action: "init", refresh_token: "attacker" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(cookies(res)).toEqual([]);
  });

  it("refuses an origin that differs only by scheme or port", async () => {
    for (const origin of ["http://app.example.test", "https://app.example.test:8443", "null"]) {
      expect((await handler().POST(post({}, { origin, cookie: "ub_refresh=rt" }))).status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"])(
    "refuses content-type %s (415)",
    async (contentType) => {
      const res = await handler().POST(post({}, { contentType, cookie: "ub_refresh=rt" }));
      expect(res.status).toBe(415);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("refuses an invalid JSON body (400)", async () => {
    const res = await handler().POST(post(null, { raw: "{not json" }));
    expect(res.status).toBe(400);
  });

  it("refuses an unknown action (400)", async () => {
    const res = await handler().POST(post({ action: "steal" }, { cookie: "ub_refresh=rt" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a request without an Origin header (same as the doc snippet)", async () => {
    fetchMock.mockResolvedValue(json({ access_token: "at", refresh_token: "rt2", expires_in: 900 }));
    const res = await handler().POST(post({}, { origin: null, cookie: "ub_refresh=rt" }));
    expect(res.status).toBe(200);
  });

  it("normalises APP_ORIGIN with a trailing slash", async () => {
    fetchMock.mockResolvedValue(json({ access_token: "at", refresh_token: "rt2", expires_in: 900 }));
    const h = createRefreshHandler({ apiUrl: API, tenantSlug: "acme", appOrigin: `${ORIGIN}/` });
    expect((await h.POST(post({}, { cookie: "ub_refresh=rt" }))).status).toBe(200);
  });
});

describe("createRefreshHandler: init", () => {
  it("stores the refresh token in an HttpOnly, Secure, SameSite=Strict cookie on /api/auth", async () => {
    const res = await handler().POST(post({ action: "init", refresh_token: "rt-1" }));
    expect(res.status).toBe(204);
    const [c] = cookies(res);
    expect(c).toBe("ub_refresh=rt-1; Path=/api/auth; Max-Age=604800; HttpOnly; SameSite=Strict; Secure");
  });

  it("omits Secure when the app origin is http (local development)", async () => {
    const h = createRefreshHandler({ apiUrl: API, tenantSlug: "acme", appOrigin: "http://localhost:3000" });
    const res = await h.POST(post({ action: "init", refresh_token: "rt-1" }, { origin: "http://localhost:3000" }));
    expect(cookies(res)[0]).not.toContain("Secure");
    expect(cookies(res)[0]).toContain("HttpOnly");
  });

  it.each([undefined, "", 42])("rejects refresh_token %j", async (refresh_token) => {
    const res = await handler().POST(post({ action: "init", refresh_token }));
    expect(res.status).toBe(400);
    expect(cookies(res)).toEqual([]);
  });
});

describe("createRefreshHandler: refresh", () => {
  it("returns 401 NO_REFRESH_COOKIE without calling upstream when the cookie is missing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const res = await handler().POST(post({}, { cookie: "other=1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "NO_REFRESH_COOKIE" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the cookie, rotates it, and returns only the access token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ access_token: "at-2", refresh_token: "rt-2", expires_in: 900, refresh_expires_in: 604800 }),
    );
    const res = await handler().POST(post({}, { cookie: "a=b; ub_refresh=rt-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ access_token: "at-2", expires_in: 900, refresh_expires_in: 604800 });
    expect(JSON.stringify(body)).not.toContain("rt-2");
    expect(cookies(res)[0]).toMatch(/^ub_refresh=rt-2; Path=\/api\/auth; .*HttpOnly; SameSite=Strict; Secure$/);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/v1/auth/refresh`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["X-Tenant-ID"]).toBe("acme");
    expect(JSON.parse(init?.body as string)).toEqual({ refresh_token: "rt-1" });
  });

  it.each([400, 401, 403, 404, 422])("clears the cookie when upstream rejects the token (%i → 401)", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ code: "X" }, status));
    const res = await handler().POST(post({}, { cookie: "ub_refresh=rt-1" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "REFRESH_REJECTED" } });
    expect(cookies(res)[0]).toMatch(/^ub_refresh=; Path=\/api\/auth; Max-Age=0;/);
  });

  it.each([429, 500, 503])("keeps the cookie on a transient upstream error (%i → 502)", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}, status));
    const res = await handler().POST(post({}, { cookie: "ub_refresh=rt-1" }));
    expect(res.status).toBe(502);
    expect(cookies(res)).toEqual([]);
  });

  it("returns 502 and keeps the cookie on a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const res = await handler().POST(post({}, { cookie: "ub_refresh=rt-1" }));
    expect(res.status).toBe(502);
    expect(cookies(res)).toEqual([]);
  });

  it("returns 502 when upstream 200 lacks the expected fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ access_token: "at" }));
    const res = await handler().POST(post({}, { cookie: "ub_refresh=rt-1" }));
    expect(res.status).toBe(502);
    expect(cookies(res)).toEqual([]);
  });
});

describe("createRefreshHandler: logout", () => {
  it("revokes upstream with the caller's Bearer token and clears the cookie", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const res = await handler().POST(post({ action: "logout" }, { cookie: "ub_refresh=rt-1", authorization: "Bearer at-1" }));
    expect(res.status).toBe(204);
    expect(cookies(res)[0]).toMatch(/^ub_refresh=; .*Max-Age=0/);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/v1/auth/logout`);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
    expect(JSON.parse(init?.body as string)).toEqual({ refresh_token: "rt-1" });
  });

  it("clears the cookie even when the upstream logout fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("down"));
    const res = await handler().POST(post({ action: "logout" }, { cookie: "ub_refresh=rt-1", authorization: "Bearer at-1" }));
    expect(res.status).toBe(204);
    expect(cookies(res)[0]).toContain("Max-Age=0");
  });

  it("skips upstream without a cookie or a Bearer token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect((await handler().POST(post({ action: "logout" }, { authorization: "Bearer at-1" }))).status).toBe(204);
    expect((await handler().POST(post({ action: "logout" }, { cookie: "ub_refresh=rt-1" }))).status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createRefreshHandler: configuration", () => {
  it("reads defaults from the documented environment variables", async () => {
    vi.stubEnv("NEXT_PUBLIC_USERBOX_API_URL", `${API}/`);
    vi.stubEnv("NEXT_PUBLIC_USERBOX_TENANT_SLUG", "envslug");
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ access_token: "at", refresh_token: "rt2", expires_in: 900 }),
    );
    const { POST } = createRefreshHandler();
    expect((await POST(post({}, { cookie: "ub_refresh=rt" }))).status).toBe(200);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${API}/v1/auth/refresh`);
    expect((fetchMock.mock.calls[0]![1]?.headers as Record<string, string>)["X-Tenant-ID"]).toBe("envslug");
  });

  it("creating the handler never throws; a request without config gets 500 CONFIG_ERROR", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { POST } = createRefreshHandler();
    const res = await POST(post({}, { cookie: "ub_refresh=rt" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "CONFIG_ERROR" } });
    expect(String(warn.mock.calls[0]![0])).toContain("APP_ORIGIN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honours a custom cookie name and path", async () => {
    const h = createRefreshHandler({
      apiUrl: API,
      tenantSlug: "acme",
      appOrigin: ORIGIN,
      cookieName: "my_rt",
      cookiePath: "/auth",
    });
    const res = await h.POST(post({ action: "init", refresh_token: "rt" }));
    expect(cookies(res)[0]).toMatch(/^my_rt=rt; Path=\/auth;/);
  });

  it("round-trips a refresh token with characters that need encoding", async () => {
    const init = await handler().POST(post({ action: "init", refresh_token: "a;b=c d" }));
    const cookie = cookies(init)[0]!.split(";")[0]!;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({}, 401));
    await handler().POST(post({}, { cookie }));
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({ refresh_token: "a;b=c d" });
  });
});
