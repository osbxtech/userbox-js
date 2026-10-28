import { afterEach, describe, expect, it, vi } from "vitest";
import { UserboxClient } from "../src/client";
import { UserboxError } from "../src/errors";

function makeClient() {
  return new UserboxClient({ apiKey: "fake_api_key_for_test_key", tenantId: "tenant-abc" });
}

function mockFetch(body: unknown, status: number, statusText = "OK") {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      statusText,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("UserboxClient.can()", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("request shape", () => {
    it("sends POST to /v1/access/check with snake_case body and correct headers", async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
      const client = makeClient();
      await client.can({ userId: "user-1", workspaceId: "ws-1", permission: "documents:read" });

      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toContain("/v1/access/check");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer fake_api_key_for_test_key");
      expect(headers["X-Tenant-ID"]).toBe("tenant-abc");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(init?.body as string)).toEqual({
        user_id: "user-1",
        workspace_id: "ws-1",
        permission_key: "documents:read",
      });
    });
  });

  describe("happy path", () => {
    it("resolves to true when allowed is true", async () => {
      mockFetch({ allowed: true }, 200);
      const client = makeClient();
      await expect(client.can({ userId: "u", workspaceId: "w", permission: "x" })).resolves.toBe(true);
    });

    it("resolves to false when allowed is false", async () => {
      mockFetch({ allowed: false }, 200);
      const client = makeClient();
      await expect(client.can({ userId: "u", workspaceId: "w", permission: "x" })).resolves.toBe(false);
    });
  });

  describe("error paths", () => {
    const errorCases: Array<[number, string, string, string]> = [
      [401, "UNAUTHORIZED", "Missing credentials", "Unauthorized"],
      [403, "INSUFFICIENT_SCOPE", "API key lacks access:check", "Forbidden"],
      [404, "NOT_FOUND", "Resource not found", "Not Found"],
      [422, "VALIDATION_ERROR", "Invalid permission key", "Unprocessable Entity"],
      [500, "INTERNAL_ERROR", "Unexpected server error", "Internal Server Error"],
    ];

    for (const [status, code, message, statusText] of errorCases) {
      it(`throws UserboxError on ${status} with status=${status}, code="${code}"`, async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response(JSON.stringify({ code, error: message }), {
            status,
            statusText,
            headers: { "content-type": "application/json" },
          }),
        );
        const client = makeClient();
        const err = await client
          .can({ userId: "u", workspaceId: "w", permission: "x" })
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(UserboxError);
        expect((err as UserboxError).status).toBe(status);
        expect((err as UserboxError).code).toBe(code);
        expect((err as UserboxError).message).toBe(message);
      });
    }
  });
});
