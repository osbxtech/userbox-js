import { afterEach, describe, expect, it, vi } from "vitest";
import { UserboxClient } from "../src/client";
import { buildUrl, normaliseBaseUrl, DEFAULT_BASE_URL } from "../src/http";

describe("normaliseBaseUrl", () => {
  it("returns the default when undefined", () => {
    expect(normaliseBaseUrl(undefined)).toBe(DEFAULT_BASE_URL);
  });

  it("strips a single trailing slash", () => {
    expect(normaliseBaseUrl("https://api.userbox.app/")).toBe("https://api.userbox.app");
  });

  it("strips multiple trailing slashes", () => {
    expect(normaliseBaseUrl("https://api.userbox.app///")).toBe("https://api.userbox.app");
  });

  it("leaves a clean URL untouched", () => {
    expect(normaliseBaseUrl("https://api.userbox.app")).toBe("https://api.userbox.app");
  });

  it("preserves a non-default host", () => {
    expect(normaliseBaseUrl("https://userbox.internal.acme.com")).toBe("https://userbox.internal.acme.com");
  });
});

describe("buildUrl", () => {
  it("joins base + path with exactly one slash", () => {
    expect(buildUrl({ baseUrl: "https://api.userbox.app", path: "/v1/users/abc" })).toBe(
      "https://api.userbox.app/v1/users/abc",
    );
  });

  it("tolerates a trailing slash on the base", () => {
    expect(buildUrl({ baseUrl: "https://api.userbox.app/", path: "/v1/users/abc" })).toBe(
      "https://api.userbox.app/v1/users/abc",
    );
  });

  it("adds a leading slash if path is missing one", () => {
    expect(buildUrl({ baseUrl: "https://api.userbox.app", path: "v1/users/abc" })).toBe(
      "https://api.userbox.app/v1/users/abc",
    );
  });

  it("appends URL-encoded query params", () => {
    const url = buildUrl({
      baseUrl: "https://api.userbox.app",
      path: "/v1/audit-logs",
      query: { action: "API_KEY_CREATED", from: "2026-05-01T00:00:00Z", page: 2, per_page: 50 },
    });
    expect(url).toContain("action=API_KEY_CREATED");
    expect(url).toContain("from=2026-05-01T00%3A00%3A00Z");
    expect(url).toContain("page=2");
    expect(url).toContain("per_page=50");
  });

  it("omits query params whose value is undefined or null", () => {
    const url = buildUrl({
      baseUrl: "https://api.userbox.app",
      path: "/v1/audit-logs",
      query: { action: undefined, target_type: null, page: 1 },
    });
    expect(url).not.toContain("action=");
    expect(url).not.toContain("target_type=");
    expect(url).toContain("page=1");
  });

  it("includes empty-string query values verbatim (caller's choice)", () => {
    const url = buildUrl({
      baseUrl: "https://api.userbox.app",
      path: "/v1/audit-logs",
      query: { action: "" },
    });
    expect(url).toContain("action=");
  });
});

describe("UserboxClient — baseUrl normalisation through fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function captureRequestUrl(baseUrl: string | undefined): Promise<string> {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ allowed: true }), { status: 200 }));

    const config: { apiKey: string; tenantId: string; baseUrl?: string } = {
      apiKey: "fake_api_key_for_xx",
      tenantId: "tenant-1",
    };
    if (baseUrl !== undefined) {
      config.baseUrl = baseUrl;
    }
    const client = new UserboxClient(config) as unknown as {
      _request: (args: { method: string; path: string }) => Promise<unknown>;
    };
    await client._request({ method: "GET", path: "/v1/ping" });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch was not invoked");
    return String(call[0]);
  }

  it("produces identical URLs whether or not baseUrl has a trailing slash", async () => {
    const withSlash = await captureRequestUrl("https://api.userbox.app/");
    const withoutSlash = await captureRequestUrl("https://api.userbox.app");
    expect(withSlash).toBe(withoutSlash);
  });

  it("uses the default base URL when baseUrl is omitted", async () => {
    const captured = await captureRequestUrl(undefined);
    expect(captured.startsWith("https://api.userbox.app/")).toBe(true);
  });

  it("routes through a self-hosted baseUrl when provided", async () => {
    const captured = await captureRequestUrl("https://userbox.internal.acme.com");
    expect(captured.startsWith("https://userbox.internal.acme.com/")).toBe(true);
  });
});
