import { afterEach, describe, expect, it, vi } from "vitest";
import { UserboxClient } from "../src/client";
import { UserboxError } from "../src/errors";

function makeClient() {
  return new UserboxClient({ apiKey: "jwt-token-value", tenantId: "tenant-abc" });
}

function mockJson(body: unknown, status = 200, statusText = "OK") {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      statusText,
      headers: { "content-type": "application/json" },
    }),
  );
}

const sampleRecord = {
  id: "log-1",
  action: "api_key.created",
  actor_id: "u-1",
  actor_type: "tenant_admin",
  target_type: "api_key",
  target_id: "k-1",
  metadata: { name: "ci" },
  request_id: "req-1",
  created_at: "2026-05-01T00:00:00Z",
};

describe("UserboxClient.getAuditLogs()", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("request shape", () => {
    it("issues GET /v1/audit-logs with default page/per_page when no args", async () => {
      const fetchMock = mockJson({ items: [], total: 0, page: 1, per_page: 20 });
      const client = makeClient();
      await client.getAuditLogs();
      const [url, init] = fetchMock.mock.calls[0]!;
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/v1/audit-logs");
      expect(parsed.searchParams.get("page")).toBe("1");
      expect(parsed.searchParams.get("per_page")).toBe("20");
      expect(parsed.searchParams.get("action")).toBeNull();
      expect(parsed.searchParams.get("target_type")).toBeNull();
      expect(parsed.searchParams.get("from")).toBeNull();
      expect(parsed.searchParams.get("to")).toBeNull();
      expect(init?.method).toBe("GET");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer jwt-token-value");
      expect(headers["X-Tenant-ID"]).toBe("tenant-abc");
    });

    it("translates camelCase args to snake_case wire query", async () => {
      const fetchMock = mockJson({ items: [], total: 0, page: 2, per_page: 50 });
      const client = makeClient();
      await client.getAuditLogs({
        page: 2,
        perPage: 50,
        targetType: "api_key",
        action: "api_key.created",
        from: "2026-05-01T00:00:00Z",
        to: "2026-05-02T00:00:00Z",
      });
      const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(parsed.searchParams.get("page")).toBe("2");
      expect(parsed.searchParams.get("per_page")).toBe("50");
      expect(parsed.searchParams.get("target_type")).toBe("api_key");
      expect(parsed.searchParams.get("action")).toBe("api_key.created");
      expect(parsed.searchParams.get("from")).toBe("2026-05-01T00:00:00Z");
      expect(parsed.searchParams.get("to")).toBe("2026-05-02T00:00:00Z");
      // The SDK never sends the camelCase variants verbatim.
      expect(parsed.searchParams.get("targetType")).toBeNull();
      expect(parsed.searchParams.get("perPage")).toBeNull();
    });

    it("skips undefined filter args (no empty query keys)", async () => {
      const fetchMock = mockJson({ items: [], total: 0, page: 1, per_page: 20 });
      const client = makeClient();
      await client.getAuditLogs({ action: "auth.login" });
      const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(parsed.searchParams.get("action")).toBe("auth.login");
      expect(parsed.searchParams.has("target_type")).toBe(false);
      expect(parsed.searchParams.has("from")).toBe(false);
      expect(parsed.searchParams.has("to")).toBe(false);
    });
  });

  describe("response shape", () => {
    it("translates wire items→data envelope", async () => {
      mockJson({ items: [sampleRecord], total: 1, page: 1, per_page: 20 });
      const client = makeClient();
      const result = await client.getAuditLogs();
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe("log-1");
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.per_page).toBe(20);
    });

    it("returns empty data when items are empty", async () => {
      mockJson({ items: [], total: 0, page: 99, per_page: 20 });
      const client = makeClient();
      const result = await client.getAuditLogs({ page: 99 });
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe("error paths", () => {
    it("surfaces 403 INSUFFICIENT_SCOPE (sentinel rejection for API-key callers) without pre-validation", async () => {
      mockJson(
        { code: "INSUFFICIENT_SCOPE", error: "API key missing required scope" },
        403,
        "Forbidden",
      );
      // The SDK doesn't introspect the credential — it forwards the platform's 403.
      const apiKeyClient = new UserboxClient({
        apiKey: "fake_api_key_for_some_key",
        tenantId: "t-1",
      });
      const err = await apiKeyClient.getAuditLogs().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserboxError);
      expect((err as UserboxError).status).toBe(403);
      expect((err as UserboxError).code).toBe("INSUFFICIENT_SCOPE");
    });

    it("surfaces 422 VALIDATION_ERROR for malformed timestamp without SDK pre-validation", async () => {
      mockJson(
        { code: "VALIDATION_ERROR", error: "Invalid datetime" },
        422,
        "Unprocessable Entity",
      );
      const client = makeClient();
      const err = await client
        .getAuditLogs({ from: "not-a-date" })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserboxError);
      expect((err as UserboxError).status).toBe(422);
      expect((err as UserboxError).code).toBe("VALIDATION_ERROR");
    });
  });
});
