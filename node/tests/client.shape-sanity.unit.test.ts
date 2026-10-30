import { afterEach, describe, expect, it, vi } from "vitest";
import { UserboxClient } from "../src/client";
import { UserboxError } from "../src/errors";

function makeClient() {
  return new UserboxClient({ apiKey: "fake_api_key_for_test", tenantId: "t-1" });
}

function mock2xx(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      statusText: "OK",
      headers: { "content-type": "application/json" },
    }),
  );
}

async function captureError(promise: Promise<unknown>): Promise<UserboxError> {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(UserboxError);
  return err as UserboxError;
}

describe("top-level shape sanity guard", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("can()", () => {
    it("throws UNKNOWN_ERROR when 2xx body has no `allowed` field", async () => {
      mock2xx({}, 200);
      const client = makeClient();
      const err = await captureError(
        client.can({ userId: "u", workspaceId: "w", permission: "p" }),
      );
      expect(err.status).toBe(200);
      expect(err.code).toBe("UNKNOWN_ERROR");
      expect(err.message).toBe("Unexpected response shape");
    });

    it("throws UNKNOWN_ERROR when 2xx body has wrong-typed `allowed`", async () => {
      mock2xx({ allowed: "true" }, 200);
      const client = makeClient();
      const err = await captureError(
        client.can({ userId: "u", workspaceId: "w", permission: "p" }),
      );
      expect(err.status).toBe(200);
      expect(err.code).toBe("UNKNOWN_ERROR");
    });

    it("accepts the canonical shape", async () => {
      mock2xx({ allowed: true }, 200);
      const client = makeClient();
      await expect(
        client.can({ userId: "u", workspaceId: "w", permission: "p" }),
      ).resolves.toBe(true);
    });
  });

  describe("getUserPermissions()", () => {
    it("throws UNKNOWN_ERROR when 2xx body has no `permissions` array", async () => {
      mock2xx({ result: ["x.y.z"] }, 200);
      const client = makeClient();
      const err = await captureError(
        client.getUserPermissions({ userId: "u", workspaceId: "w" }),
      );
      expect(err.status).toBe(200);
      expect(err.code).toBe("UNKNOWN_ERROR");
    });

    it("throws when `permissions` array contains non-strings", async () => {
      mock2xx({ permissions: ["x.y.z", 42] }, 200);
      const client = makeClient();
      const err = await captureError(
        client.getUserPermissions({ userId: "u", workspaceId: "w" }),
      );
      expect(err.code).toBe("UNKNOWN_ERROR");
    });

    it("accepts an empty `permissions` array", async () => {
      mock2xx({ permissions: [] }, 200);
      const client = makeClient();
      await expect(
        client.getUserPermissions({ userId: "u", workspaceId: "w" }),
      ).resolves.toEqual([]);
    });
  });

  describe("getUserMemberships()", () => {
    it("throws UNKNOWN_ERROR when 2xx body is missing `items`", async () => {
      mock2xx({ total: 0, page: 1, page_size: 20 }, 200);
      const client = makeClient();
      const err = await captureError(client.getUserMemberships({ userId: "u" }));
      expect(err.status).toBe(200);
      expect(err.code).toBe("UNKNOWN_ERROR");
    });

    it("throws UNKNOWN_ERROR when `items` is not an array", async () => {
      mock2xx({ items: null, total: 0, page: 1, page_size: 20 }, 200);
      const client = makeClient();
      const err = await captureError(client.getUserMemberships({ userId: "u" }));
      expect(err.code).toBe("UNKNOWN_ERROR");
    });

    it("throws UNKNOWN_ERROR on the audit-log key `per_page` instead of `page_size`", async () => {
      mock2xx({ items: [], total: 0, page: 1, per_page: 20 }, 200);
      const client = makeClient();
      const err = await captureError(client.getUserMemberships({ userId: "u" }));
      expect(err.code).toBe("UNKNOWN_ERROR");
    });

    it("maps the wire `page_size` to `per_page`", async () => {
      mock2xx({ items: [], total: 0, page: 1, page_size: 20 }, 200);
      const client = makeClient();
      const result = await client.getUserMemberships({ userId: "u" });
      expect(result.per_page).toBe(20);
    });

    it("throws when pagination keys are missing", async () => {
      mock2xx({ items: [] }, 200);
      const client = makeClient();
      const err = await captureError(client.getUserMemberships({ userId: "u" }));
      expect(err.code).toBe("UNKNOWN_ERROR");
    });
  });

  describe("getAuditLogs()", () => {
    it("throws UNKNOWN_ERROR when 2xx body is missing `items`", async () => {
      mock2xx({ total: 0, page: 1, per_page: 20 }, 200);
      const client = makeClient();
      const err = await captureError(client.getAuditLogs());
      expect(err.status).toBe(200);
      expect(err.code).toBe("UNKNOWN_ERROR");
    });

    it("throws UNKNOWN_ERROR when `items` is a string", async () => {
      mock2xx({ items: "oops", total: 0, page: 1, per_page: 20 }, 200);
      const client = makeClient();
      const err = await captureError(client.getAuditLogs());
      expect(err.code).toBe("UNKNOWN_ERROR");
    });

    it("accepts the canonical envelope", async () => {
      mock2xx({ items: [], total: 0, page: 1, per_page: 20 }, 200);
      const client = makeClient();
      const result = await client.getAuditLogs();
      expect(result.data).toEqual([]);
      expect(result.per_page).toBe(20);
    });
  });

  describe("non-list responses are NOT shape-guarded by the list envelope", () => {
    it("getUser returns the body verbatim — no field-level validation (per Assumption #11 / contract)", async () => {
      // Even a body the platform would never legitimately return passes through —
      // the SDK intentionally does NOT validate per-field shapes (the guard covers the top level only).
      mock2xx({ id: "u-1" }, 200);
      const client = makeClient();
      const result = await client.getUser("u-1");
      expect((result as unknown as { id: string }).id).toBe("u-1");
    });
  });
});
