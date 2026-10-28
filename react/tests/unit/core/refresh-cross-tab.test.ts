import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RefreshEngine, type RefreshEngineOptions, type Session } from "../../../src/core/refresh-engine";
import { MemoryStore } from "../../../src/core/session-store";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>();
  name: string;
  private listeners: ((evt: MessageEvent) => void)[] = [];

  constructor(name: string) {
    this.name = name;
    let set = MockBroadcastChannel.channels.get(name);
    if (!set) {
      set = new Set();
      MockBroadcastChannel.channels.set(name, set);
    }
    set.add(this);
  }
  addEventListener(_type: "message", fn: (evt: MessageEvent) => void): void {
    this.listeners.push(fn);
  }
  removeEventListener(_type: "message", fn: (evt: MessageEvent) => void): void {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
  postMessage(data: unknown): void {
    const set = MockBroadcastChannel.channels.get(this.name);
    if (!set) return;
    for (const ch of set) {
      if (ch === this) continue;
      for (const l of ch.listeners) {
        l({ data } as MessageEvent);
      }
    }
  }
  close(): void {
    const set = MockBroadcastChannel.channels.get(this.name);
    set?.delete(this);
  }
}

beforeEach(() => {
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = MockBroadcastChannel;
  MockBroadcastChannel.channels.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
});

function makeOptions(): RefreshEngineOptions {
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
    broadcastChannelName: "acme",
    now: () => 1_000_000,
  };
}

describe("RefreshEngine cross-tab coordination", () => {
  it("two engines on the same BroadcastChannel produce exactly 1 outbound HTTP call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: makeJwt({ sub: "u", tid: "t", exp: 9999 }),
          refresh_token: "rt-rotated",
          expires_in: 900,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const onSessionA = vi.fn();
    const onSessionB = vi.fn();
    const engineA = new RefreshEngine({ ...makeOptions(), onSession: onSessionA });
    const engineB = new RefreshEngine({ ...makeOptions(), onSession: onSessionB });

    // Both engines call refresh "concurrently". Engine A wins the claim window
    // because it issues the HTTP call first; engine B observes the broadcast
    // and adopts the session without issuing its own fetch.
    const pA = engineA.refresh();
    const pB = engineB.refresh();
    await vi.advanceTimersByTimeAsync(250);
    const [resA, resB] = await Promise.all([pA, pB]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(resA.kind).toBe("ok");
    expect(resB.kind).toBe("ok");
    if (resA.kind === "ok" && resB.kind === "ok") {
      expect(resA.session.user.id).toBe(resB.session.user.id);
      expect(resA.session.accessToken).toBe(resB.session.accessToken);
    }

    engineA.dispose();
    engineB.dispose();
    // Reference suppression for type-narrowing only
    void resA; void resB;
    void ({} as Session);
  });
});
