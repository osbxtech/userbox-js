import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserboxClient } from "../src/client";
import { UserboxError } from "../src/errors";

const SENTINEL_API_KEY = "ub_live_FORBIDDEN_TOKEN_DO_NOT_LEAK";
const SENTINEL_TENANT_ID = "TENANT_SENTINEL_DO_NOT_LEAK";

interface RawClient {
  _request: <T>(args: { method: string; path: string; body?: unknown }) => Promise<T>;
}

function makeClient(): RawClient {
  return new UserboxClient({
    apiKey: SENTINEL_API_KEY,
    tenantId: SENTINEL_TENANT_ID,
  }) as unknown as RawClient;
}

function assertNoSentinel(value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  expect(text).not.toContain(SENTINEL_API_KEY);
  expect(text).not.toContain(SENTINEL_TENANT_ID);
}

describe("credentials never appear in thrown UserboxError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("4xx with platform body — credentials absent from message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INSUFFICIENT_SCOPE", error: "scope missing" }), { status: 403 }),
    );
    const client = makeClient();
    const err = (await client._request({ method: "GET", path: "/v1/x" }).catch((e: unknown) => e)) as UserboxError;
    expect(err).toBeInstanceOf(UserboxError);
    assertNoSentinel(err.message);
    assertNoSentinel(err.code);
  });

  it("HTML error body — credentials absent from UNKNOWN_ERROR message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>error</html>", { status: 502, statusText: "Bad Gateway" }),
    );
    const client = makeClient();
    const err = (await client._request({ method: "GET", path: "/v1/x" }).catch((e: unknown) => e)) as UserboxError;
    expect(err).toBeInstanceOf(UserboxError);
    assertNoSentinel(err.message);
  });

  it("network failure — credentials absent from NETWORK_ERROR message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const client = makeClient();
    const err = (await client._request({ method: "GET", path: "/v1/x" }).catch((e: unknown) => e)) as UserboxError;
    expect(err).toBeInstanceOf(UserboxError);
    assertNoSentinel(err.message);
  });

  it("the request is sent with the correct headers (positive control)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ allowed: true }), { status: 200 }));
    const client = makeClient();
    await client._request({ method: "GET", path: "/v1/x" });
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    const init = call?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe(`Bearer ${SENTINEL_API_KEY}`);
    expect(headers?.["X-Tenant-ID"]).toBe(SENTINEL_TENANT_ID);
  });

  it("the apiKey/tenantId are NOT serialised into the request URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = makeClient();
    await client._request({ method: "GET", path: "/v1/x" });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    assertNoSentinel(url);
  });
});

describe("credentials never appear in errors — env-specific key prefixes", () => {
  // The SDK accepts API keys with env-specific prefixes:
  // `ub_prod_`, `ub_stg_`, `ub_dev_`. The credential-not-logged invariant
  // (SDK author contract) must hold for every prefix — a regression
  // that prints the key would be just as damaging on a staging key as on a
  // production one.
  const ENV_PREFIXES = ["ub_prod_", "ub_stg_", "ub_dev_"] as const;

  afterEach(() => vi.restoreAllMocks());

  for (const prefix of ENV_PREFIXES) {
    const sentinel = `${prefix}FORBIDDEN_TOKEN_DO_NOT_LEAK`;

    it(`prefix=${prefix} — 4xx error message omits the key`, async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ code: "INSUFFICIENT_SCOPE", error: "scope missing" }),
          { status: 403 },
        ),
      );
      const client = new UserboxClient({
        apiKey: sentinel,
        tenantId: SENTINEL_TENANT_ID,
      }) as unknown as RawClient;
      const err = (await client
        ._request({ method: "GET", path: "/v1/x" })
        .catch((e: unknown) => e)) as UserboxError;
      expect(err).toBeInstanceOf(UserboxError);
      expect(err.message).not.toContain(sentinel);
    });

    it(`prefix=${prefix} — request URL omits the key`, async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      const client = new UserboxClient({
        apiKey: sentinel,
        tenantId: SENTINEL_TENANT_ID,
      }) as unknown as RawClient;
      await client._request({ method: "GET", path: "/v1/x" });
      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).not.toContain(sentinel);
    });
  }
});

describe("source build is free of console.*", () => {
  // 009 / SEC-004: enumerate SDK source files dynamically so the scan extends
  // automatically as files are added. readdirSync is NOT recursive — keep
  // src/types/ flat; nested subdirs would be missed. (Today there are none.)
  function listScannedFiles(sourceDir: string): string[] {
    const root = readdirSync(sourceDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => e.name);
    const types = readdirSync(resolve(sourceDir, "types"), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => `types/${e.name}`);
    return [...root, ...types];
  }

  it("no console call appears in any src/*.ts file", () => {
    const sourceDir = resolve(__dirname, "..", "src");
    const files = listScannedFiles(sourceDir);
    // Loud failure when the scan returns zero files. Prevents a vacuous
    // pass after a future restructure empties the directory.
    expect(files.length, "credentials-not-logged scan must cover at least one source file").toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(resolve(sourceDir, file), "utf8");
      const stripped = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(stripped, `no console.* in ${file}`).not.toMatch(/\bconsole\.(log|error|warn|info|debug|trace)\b/);
    }
  });
});
