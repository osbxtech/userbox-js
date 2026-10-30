import { afterEach, describe, expect, it, vi } from "vitest";
import { UserboxClient } from "../src/client";
import { UserboxError } from "../src/errors";

function makeClient() {
  return new UserboxClient({ apiKey: "fake_api_key_for_test_key", tenantId: "tenant-abc" });
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

describe("UserboxClient.getUser()", () => {
  afterEach(() => vi.restoreAllMocks());

  it("issues GET /v1/users/{id} with auth + tenant headers", async () => {
    const fetchMock = mockJson({
      id: "user-1",
      email: "u@example.com",
      email_verified_at: null,
      full_name: "U",
      avatar_url: null,
      status: "active",
      last_login_at: null,
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-01T00:00:00Z",
      deleted_at: null,
    });
    const client = makeClient();
    const result = await client.getUser("user-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/users/user-1");
    expect(init?.method).toBe("GET");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer fake_api_key_for_test_key");
    expect(headers["X-Tenant-ID"]).toBe("tenant-abc");
    expect(init?.body).toBeUndefined();
    expect(result.id).toBe("user-1");
    expect(result.email).toBe("u@example.com");
  });

  it("throws UserboxError on 404", async () => {
    mockJson({ code: "NOT_FOUND", error: "User missing" }, 404, "Not Found");
    const client = makeClient();
    const err = await client.getUser("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxError);
    expect((err as UserboxError).status).toBe(404);
    expect((err as UserboxError).code).toBe("NOT_FOUND");
  });

  it("URL-encodes the userId path segment", async () => {
    const fetchMock = mockJson({
      id: "weird/id",
      email: "u@example.com",
      email_verified_at: null,
      full_name: null,
      avatar_url: null,
      status: "active",
      last_login_at: null,
      created_at: "x",
      updated_at: "x",
      deleted_at: null,
    });
    const client = makeClient();
    await client.getUser("weird/id");
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/users/weird%2Fid");
  });
});

describe("UserboxClient.getWorkspace()", () => {
  afterEach(() => vi.restoreAllMocks());

  it("issues GET /v1/workspaces/{id}", async () => {
    const fetchMock = mockJson({
      id: "ws-1",
      tenant_id: "t-1",
      name: "Eng",
      slug: "eng",
      external_id: null,
      status: "active",
      created_at: "x",
      updated_at: "x",
    });
    const client = makeClient();
    const result = await client.getWorkspace("ws-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/workspaces/ws-1");
    expect(init?.method).toBe("GET");
    expect(result.id).toBe("ws-1");
  });

  it("cross-tenant 404 surfaces as UserboxError { status: 404 }", async () => {
    mockJson({ code: "WS_NOT_FOUND", error: "Workspace not found" }, 404, "Not Found");
    const client = makeClient();
    const err = await client.getWorkspace("ws-other").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxError);
    expect((err as UserboxError).status).toBe(404);
    expect((err as UserboxError).code).toBe("WS_NOT_FOUND");
  });
});

describe("UserboxClient.getUserMemberships()", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends user_id, page, per_page query and translates items→data", async () => {
    const fetchMock = mockJson({
      items: [
        {
          id: "m-1",
          user_id: "u-1",
          workspace_id: "ws-1",
          external_id: null,
          public_metadata: null,
          status: "active",
          created_at: "x",
          updated_at: "x",
        },
      ],
      total: 1,
      page: 1,
      page_size: 20,
    });
    const client = makeClient();
    const result = await client.getUserMemberships({ userId: "u-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/v1/memberships");
    expect(parsed.searchParams.get("user_id")).toBe("u-1");
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(parsed.searchParams.get("per_page")).toBe("20");
    expect(init?.method).toBe("GET");
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.id).toBe("m-1");
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(20);
  });

  it("uses caller-supplied page and perPage", async () => {
    const fetchMock = mockJson({ items: [], total: 0, page: 3, page_size: 50 });
    const client = makeClient();
    await client.getUserMemberships({ userId: "u-1", page: 3, perPage: 50 });
    const parsed = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("per_page")).toBe("50");
  });

  it("forwards platform errors as UserboxError", async () => {
    mockJson({ code: "INSUFFICIENT_SCOPE", error: "No memberships:read" }, 403, "Forbidden");
    const client = makeClient();
    const err = await client.getUserMemberships({ userId: "u" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxError);
    expect((err as UserboxError).status).toBe(403);
    expect((err as UserboxError).code).toBe("INSUFFICIENT_SCOPE");
  });
});

describe("UserboxClient.getUserPermissions()", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends user_id + workspace_id and unwraps {permissions: [...]}", async () => {
    const fetchMock = mockJson({ permissions: ["docs.read", "docs.write"] });
    const client = makeClient();
    const result = await client.getUserPermissions({ userId: "u-1", workspaceId: "ws-1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/v1/access/permissions");
    expect(parsed.searchParams.get("user_id")).toBe("u-1");
    expect(parsed.searchParams.get("workspace_id")).toBe("ws-1");
    expect(init?.method).toBe("GET");
    expect(result).toEqual(["docs.read", "docs.write"]);
  });

  it("returns an empty array when platform returns empty", async () => {
    mockJson({ permissions: [] });
    const client = makeClient();
    const result = await client.getUserPermissions({ userId: "u-1", workspaceId: "ws-1" });
    expect(result).toEqual([]);
  });

  it("surfaces platform 403 as UserboxError", async () => {
    mockJson(
      { code: "INSUFFICIENT_SCOPE", error: "access:check missing" },
      403,
      "Forbidden",
    );
    const client = makeClient();
    const err = await client
      .getUserPermissions({ userId: "u", workspaceId: "w" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxError);
    expect((err as UserboxError).status).toBe(403);
    expect((err as UserboxError).code).toBe("INSUFFICIENT_SCOPE");
  });
});
