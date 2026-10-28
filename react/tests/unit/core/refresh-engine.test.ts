import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { RefreshEngine, type RefreshEngineOptions } from "../../../src/core/refresh-engine";
import { MemoryStore } from "../../../src/core/session-store";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function makeRefreshResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeBaseOptions(overrides: Partial<RefreshEngineOptions> = {}): RefreshEngineOptions {
  const store = new MemoryStore();
  store.setRefreshToken("rt-initial");
  return {
    tenantSlug: "acme",
    baseUrl: "https://api.example.test",
    refreshUrl: "https://api.example.test/v1/auth/refresh",
    tokenStorage: "memory",
    sessionStore: store,
    refreshThresholdPct: 0.2,
    proactiveSkewMs: 5_000,
    onSession: vi.fn(),
    onSessionExpired: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RefreshEngine", () => {
  it("schedules a refresh at 80% of TTL when primed with a session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeRefreshResponse(200, {
        access_token: makeJwt({ sub: "u1", tid: "t1", exp: 9999 }),
        refresh_token: "rt-2",
        expires_in: 900,
      }),
    );
    const onSession = vi.fn();
    const engine = new RefreshEngine(
      makeBaseOptions({ onSession, now: () => 1_000_000 }),
    );
    engine.primeSession({
      accessToken: "at-initial",
      accessTokenExpiresAt: 1_000_000 + 900_000, // 15 minutes
      refreshExpiresAt: 1_000_000 + 7 * 24 * 60 * 60 * 1000,
      user: { id: "u1", tenantId: "t1", email: null, fullName: null },
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    // 80% of 900s consumed → fire at 720s in. Advance just past.
    await vi.advanceTimersByTimeAsync(720_001);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("permanent failure on 400 INVALID_REFRESH_TOKEN fires onSessionExpired once and latches", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeRefreshResponse(400, { code: "INVALID_REFRESH_TOKEN", error: "Invalid token" }),
    );
    const onSessionExpired = vi.fn();
    const onError = vi.fn();
    const engine = new RefreshEngine(
      makeBaseOptions({ onSessionExpired, onError, now: () => 1_000_000 }),
    );
    const result = await engine.refresh();
    expect(result.kind).toBe("permanent_fail");
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    // Subsequent attempts are short-circuited and do not re-fire onSessionExpired.
    const result2 = await engine.refresh();
    expect(result2.kind).toBe("permanent_fail");
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    engine.dispose();
  });

  it("transient failures retry with exponential backoff and then escalate", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      makeRefreshResponse(503, { code: "UPSTREAM_DOWN", error: "Upstream" }),
    );
    const onSessionExpired = vi.fn();
    const engine = new RefreshEngine(
      makeBaseOptions({ onSessionExpired, now: () => 1_000_000 }),
    );
    const r1 = await engine.refresh();
    expect(r1.kind).toBe("transient_fail");
    const r2 = await engine.refresh();
    expect(r2.kind).toBe("transient_fail");
    const r3 = await engine.refresh();
    expect(r3.kind).toBe("transient_fail");
    // After the 3rd transient failure the engine has latched permanent.
    const r4 = await engine.refresh();
    expect(r4.kind).toBe("permanent_fail");
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    engine.dispose();
  });
});
