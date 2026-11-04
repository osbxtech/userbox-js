import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserboxClient, can } from "../../src/index";
import { _resetDefaultClient } from "../../src/server/can";
import type { UserboxError } from "../../src/errors";

const KEY = "fake_api_key_for_test_key";
const ARGS = { userId: "user-1", workspaceId: "ws-1", permission: "projects.delete" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function collect() {
  const errors: UserboxError[] = [];
  return { errors, onError: (e: UserboxError) => errors.push(e) };
}

beforeEach(() => {
  _resetDefaultClient();
  vi.stubEnv("USERBOX_API_KEY", KEY);
  vi.stubEnv("USERBOX_TENANT_ID", "tenant-abc");
  vi.stubEnv("NEXT_PUBLIC_USERBOX_API_URL", "https://api.example.test");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("can(): answers", () => {
  it("returns true when Userbox allows, using a client built from the environment", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ allowed: true }));
    expect(await can(ARGS)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.example.test/v1/access/check");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["X-Tenant-ID"]).toBe("tenant-abc");
    expect(JSON.parse(init?.body as string)).toEqual({
      user_id: "user-1",
      workspace_id: "ws-1",
      permission_key: "projects.delete",
    });
  });

  it("returns false when Userbox denies, without reporting an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ allowed: false }));
    const { errors, onError } = collect();
    expect(await can(ARGS, { onError })).toBe(false);
    expect(errors).toEqual([]);
  });

  it("uses the client passed in options", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ allowed: true }));
    const client = new UserboxClient({ apiKey: "fake_other_key", tenantId: "t2", baseUrl: "https://b.example.test" });
    expect(await can(ARGS, { client })).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://b.example.test/v1/access/check");
  });
});

describe("can(): deny on any error", () => {
  it.each([
    ["401 bad API key", () => json({ code: "UNAUTHORIZED", error: "bad key" }, 401), "UNAUTHORIZED"],
    ["403 missing scope", () => json({ code: "INSUFFICIENT_SCOPE", error: "scope" }, 403), "INSUFFICIENT_SCOPE"],
    ["404 unknown workspace", () => json({ code: "NOT_FOUND", error: "no ws" }, 404), "NOT_FOUND"],
    ["422 invalid key", () => json({ detail: [] }, 422), "UNKNOWN_ERROR"],
    ["429 rate limit", () => json({ code: "RATE_LIMITED", error: "slow" }, 429), "RATE_LIMITED"],
    ["500 server error", () => new Response("boom", { status: 500 }), "UNKNOWN_ERROR"],
    ["malformed body", () => json({ allowed: "yes" }), "UNKNOWN_ERROR"],
  ])("%s → false", async (_name, response, code) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => response());
    const { errors, onError } = collect();
    expect(await can(ARGS, { onError })).toBe(false);
    expect(errors.map((e) => e.code)).toEqual([code]);
  });

  it("network failure → false", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const { errors, onError } = collect();
    expect(await can(ARGS, { onError })).toBe(false);
    expect(errors[0]).toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });

  it("missing configuration → false with CONFIG_ERROR, no request", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("USERBOX_API_KEY", "");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { errors, onError } = collect();
    expect(await can(ARGS, { onError })).toBe(false);
    expect(errors.map((e) => e.code)).toEqual(["CONFIG_ERROR"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { ...ARGS, userId: "" },
    { ...ARGS, workspaceId: " " },
    { ...ARGS, permission: "" },
    { ...ARGS, workspaceId: undefined as unknown as string },
  ])("empty argument → false with INVALID_ARGUMENT, no request (%#)", async (args) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { errors, onError } = collect();
    expect(await can(args, { onError })).toBe(false);
    expect(errors.map((e) => e.code)).toEqual(["INVALID_ARGUMENT"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a throwing onError does not turn the denial into an exception", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      can(ARGS, {
        onError: () => {
          throw new Error("reporter bug");
        },
      }),
    ).resolves.toBe(false);
  });

  it("the default reporter warns with code and status, never the API key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ code: "INSUFFICIENT_SCOPE", error: "scope" }, 403));
    expect(await can(ARGS)).toBe(false);
    const line = String(warn.mock.calls[0]![0]);
    expect(line).toContain("INSUFFICIENT_SCOPE");
    expect(line).toContain("403");
    expect(line).not.toContain(KEY);
  });
});

describe("UserboxClient: environment defaults", () => {
  it("throws CONFIG_ERROR when the API key is neither passed nor in the environment", () => {
    vi.unstubAllEnvs();
    vi.stubEnv("USERBOX_API_KEY", "");
    expect(() => new UserboxClient({ tenantId: "t" })).toThrow(/USERBOX_API_KEY/);
  });

  it("explicit options win over the environment", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ allowed: true }));
    await new UserboxClient({ apiKey: "fake_explicit_key", tenantId: "t-explicit" }).can(ARGS);
    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fake_explicit_key");
    expect(headers["X-Tenant-ID"]).toBe("t-explicit");
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.example.test/v1/access/check");
  });
});

describe("can(): framework control flow", () => {
  it("lets a Next.js prerender signal thrown by fetch propagate instead of denying", async () => {
    const signal = Object.assign(new Error("prerender"), { digest: "NEXT_PRERENDER_INTERRUPTED" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(signal);
    await expect(can(ARGS)).rejects.toBe(signal);
  });
});
