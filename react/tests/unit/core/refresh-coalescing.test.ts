import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RefreshEngine } from "../../../src/core/refresh-engine";
import { MemoryStore } from "../../../src/core/session-store";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RefreshEngine single-flight coalescing", () => {
  it("N concurrent refresh() calls produce exactly 1 outbound HTTP call", async () => {
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(pending);

    const store = new MemoryStore();
    store.setRefreshToken("rt-initial");
    const engine = new RefreshEngine({
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
      now: () => 1_000_000,
    });

    const promises = [engine.refresh(), engine.refresh(), engine.refresh(), engine.refresh()];
    resolveFetch(
      new Response(
        JSON.stringify({
          access_token: makeJwt({ sub: "u", tid: "t", exp: 9999 }),
          refresh_token: "rt-2",
          expires_in: 900,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const results = await Promise.all(promises);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.kind).toBe("ok");
    }
    // All callers see the same session reference.
    if (results[0]!.kind === "ok" && results[1]!.kind === "ok") {
      expect(results[0]!.session).toBe(results[1]!.session);
    }
    engine.dispose();
  });
});
