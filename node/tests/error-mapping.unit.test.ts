import { afterEach, describe, expect, it, vi } from "vitest";
import { UserboxClient } from "../src/client";
import { UserboxError } from "../src/errors";

interface RawClient {
  _request: <T>(args: { method: string; path: string; body?: unknown }) => Promise<T>;
}

function makeClient(): RawClient {
  return new UserboxClient({
    apiKey: "fake_api_key_for_xx",
    tenantId: "tenant-1",
  }) as unknown as RawClient;
}

describe("request — happy path", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the parsed 2xx JSON body verbatim", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ allowed: true, extra: "x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = makeClient();
    const body = await client._request<{ allowed: boolean; extra: string }>({ method: "GET", path: "/v1/x" });
    expect(body).toEqual({ allowed: true, extra: "x" });
  });

  it("resolves to undefined on 204 No Content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const client = makeClient();
    const body = await client._request({ method: "DELETE", path: "/v1/x" });
    expect(body).toBeUndefined();
  });
});

describe("request — error mapping", () => {
  afterEach(() => vi.restoreAllMocks());

  it("forwards platform {code, error} body verbatim on 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INSUFFICIENT_SCOPE", error: "API key lacks workspaces:read" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = makeClient();
    await expect(client._request({ method: "GET", path: "/v1/workspaces/x" })).rejects.toMatchObject({
      name: "UserboxError",
      status: 403,
      code: "INSUFFICIENT_SCOPE",
      message: "API key lacks workspaces:read",
    });
  });

  it("supports the alternate {code, message} body shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_ERROR", message: "bad input" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = makeClient();
    await expect(client._request({ method: "GET", path: "/v1/x" })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      message: "bad input",
    });
  });

  it("uses UNKNOWN_ERROR for an HTML error page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/html" },
      }),
    );
    const client = makeClient();
    await expect(client._request({ method: "GET", path: "/v1/x" })).rejects.toMatchObject({
      status: 502,
      code: "UNKNOWN_ERROR",
      message: "HTTP 502 Bad Gateway",
    });
  });

  it("uses UNKNOWN_ERROR for an empty body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 500, statusText: "Internal Server Error" }),
    );
    const client = makeClient();
    await expect(client._request({ method: "GET", path: "/v1/x" })).rejects.toMatchObject({
      status: 500,
      code: "UNKNOWN_ERROR",
    });
  });

  it("uses UNKNOWN_ERROR when JSON parses but lacks code/error fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "missing" }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
      }),
    );
    const client = makeClient();
    const err = await client._request({ method: "GET", path: "/v1/x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxError);
    expect((err as UserboxError).status).toBe(400);
    expect((err as UserboxError).code).toBe("UNKNOWN_ERROR");
  });

  it("uses NETWORK_ERROR with status 0 when fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:443"));
    const client = makeClient();
    await expect(client._request({ method: "GET", path: "/v1/x" })).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      message: "ECONNREFUSED 127.0.0.1:443",
    });
  });

  it("uses NETWORK_ERROR when fetch rejects with a non-Error value", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("connection reset");
    const client = makeClient();
    const err = await client._request({ method: "GET", path: "/v1/x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxError);
    expect((err as UserboxError).status).toBe(0);
    expect((err as UserboxError).code).toBe("NETWORK_ERROR");
  });

  it("returns UNKNOWN_ERROR if 2xx body fails to parse as JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<not json>", {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/html" },
      }),
    );
    const client = makeClient();
    await expect(client._request({ method: "GET", path: "/v1/x" })).rejects.toMatchObject({
      status: 200,
      code: "UNKNOWN_ERROR",
    });
  });

  it("thrown errors are instances of UserboxError (not plain Error)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", error: "missing" }), { status: 404 }),
    );
    const client = makeClient();
    const err = await client._request({ method: "GET", path: "/v1/x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("UserboxError");
  });
});
