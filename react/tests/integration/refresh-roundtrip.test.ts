import { describe, expect, it } from "vitest";
import {
  API_URL,
  TENANT_SLUG,
  integrationEnabled,
  loginViaApi,
} from "./fixtures";
import { RefreshEngine } from "../../src/core/refresh-engine";
import { MemoryStore } from "../../src/core/session-store";

describe.skipIf(!integrationEnabled)("integration: refresh round-trip", () => {
  it("rotates the refresh token via /v1/auth/refresh", async () => {
    const login = await loginViaApi();
    const store = new MemoryStore();
    store.setRefreshToken(login.refreshToken);
    const engine = new RefreshEngine({
      tenantSlug: TENANT_SLUG,
      baseUrl: API_URL,
      refreshUrl: `${API_URL}/v1/auth/refresh`,
      tokenStorage: "memory",
      sessionStore: store,
      refreshThresholdPct: 0.2,
      proactiveSkewMs: 5_000,
      onSession: () => undefined,
      onSessionExpired: () => undefined,
      onError: () => undefined,
    });
    const result = await engine.refresh();
    expect(result.kind).toBe("ok");
    // Compare as a boolean: a failed toBe() would print both tokens.
    expect(store.getRefreshToken() !== login.refreshToken).toBe(true);
    engine.dispose();
  });
});
