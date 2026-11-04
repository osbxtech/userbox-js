import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { verifyAccessToken, verifyRequest } from "../../src/index";
import { _resetJwksCache } from "../../src/server/verify";
import type { UserboxError } from "../../src/errors";

const API = "https://api.example.test";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let keyA: KeyPair;
let keyB: KeyPair;
let jwkA: JWK;
let jwkB: JWK;

beforeEach(async () => {
  if (!keyA) {
    keyA = await generateKeyPair("RS256", { extractable: true });
    keyB = await generateKeyPair("RS256", { extractable: true });
    jwkA = { ...(await exportJWK(keyA.publicKey)), kid: "key-a", alg: "RS256", use: "sig" };
    jwkB = { ...(await exportJWK(keyB.publicKey)), kid: "key-b", alg: "RS256", use: "sig" };
  }
  _resetJwksCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function serveJwks(...sets: JWK[][]) {
  let call = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    expect(String(input)).toBe(`${API}/.well-known/jwks.json`);
    const keys = sets[Math.min(call++, sets.length - 1)];
    return new Response(JSON.stringify({ keys }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

async function sign(
  claims: Record<string, unknown> = {},
  opts: { key?: KeyPair; kid?: string | null; expiresIn?: string | number } = {},
): Promise<string> {
  const jwt = new SignJWT({ tid: TENANT, ...claims })
    .setProtectedHeader(opts.kid === null ? { alg: "RS256" } : { alg: "RS256", kid: opts.kid ?? "key-a" })
    .setSubject((claims.sub as string | undefined) ?? "user-1")
    .setIssuedAt();
  if (!("exp" in claims)) jwt.setExpirationTime(opts.expiresIn ?? "15m");
  return jwt.sign((opts.key ?? keyA).privateKey);
}

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function collect() {
  const codes: string[] = [];
  return { codes, onError: (e: UserboxError) => codes.push(e.code) };
}

const opts = { apiUrl: API, tenantId: TENANT };

describe("verifyAccessToken: valid tokens", () => {
  it("returns the user for a token signed by a JWKS key, with the right tenant", async () => {
    serveJwks([jwkA]);
    const token = await sign();
    const user = await verifyAccessToken(token, opts);
    expect(user).toMatchObject({ userId: "user-1", tenantId: TENANT });
    expect(user!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("accepts a token without kid when a JWKS key verifies it", async () => {
    serveJwks([jwkB, jwkA]);
    expect(await verifyAccessToken(await sign({}, { kid: null }), opts)).not.toBeNull();
  });

  it("reads the API URL and tenant id from the environment", async () => {
    vi.stubEnv("NEXT_PUBLIC_USERBOX_API_URL", `${API}/`);
    vi.stubEnv("USERBOX_TENANT_ID", TENANT);
    serveJwks([jwkA]);
    expect(await verifyAccessToken(await sign())).not.toBeNull();
  });

  it("prefers USERBOX_API_URL over NEXT_PUBLIC_USERBOX_API_URL", async () => {
    vi.stubEnv("USERBOX_API_URL", API);
    vi.stubEnv("NEXT_PUBLIC_USERBOX_API_URL", "https://wrong.example.test");
    vi.stubEnv("USERBOX_TENANT_ID", TENANT);
    serveJwks([jwkA]);
    expect(await verifyAccessToken(await sign())).not.toBeNull();
  });
});

describe("verifyAccessToken: security cases", () => {
  it("rejects a token for another tenant (wrong tid)", async () => {
    serveJwks([jwkA]);
    const { codes, onError } = collect();
    expect(await verifyAccessToken(await sign({ tid: OTHER_TENANT }), { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["TENANT_MISMATCH"]);
  });

  it("rejects a token signed by another key under a known kid (bad signature)", async () => {
    serveJwks([jwkA]);
    const { codes, onError } = collect();
    const forged = await sign({}, { key: keyB, kid: "key-a" });
    expect(await verifyAccessToken(forged, { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["INVALID_SIGNATURE"]);
  });

  it("rejects a token whose payload was changed after signing", async () => {
    serveJwks([jwkA]);
    const [h, , s] = (await sign()).split(".");
    const tampered = `${h}.${b64({ sub: "admin", tid: TENANT, exp: Math.floor(Date.now() / 1000) + 600 })}.${s}`;
    const { codes, onError } = collect();
    expect(await verifyAccessToken(tampered, { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["INVALID_SIGNATURE"]);
  });

  it.each([
    ["none", { alg: "none" }],
    ["HS256", { alg: "HS256", kid: "key-a" }],
    ["PS256", { alg: "PS256", kid: "key-a" }],
    ["missing alg", { kid: "key-a" }],
  ])("rejects alg %s before fetching keys", async (_name, header) => {
    const fetchMock = serveJwks([jwkA]);
    const [, p, s] = (await sign()).split(".");
    const { codes, onError } = collect();
    expect(await verifyAccessToken(`${b64(header)}.${p}.${s}`, { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["UNSUPPORTED_ALGORITHM"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    serveJwks([jwkA]);
    const { codes, onError } = collect();
    const token = await sign({ exp: Math.floor(Date.now() / 1000) - 60 });
    expect(await verifyAccessToken(token, { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["TOKEN_EXPIRED"]);
  });

  it("accepts a token that expired within the clock tolerance", async () => {
    serveJwks([jwkA]);
    const token = await sign({ exp: Math.floor(Date.now() / 1000) - 2 });
    expect(await verifyAccessToken(token, opts)).not.toBeNull();
  });

  it("rejects a token that is not valid yet (nbf)", async () => {
    serveJwks([jwkA]);
    const { codes, onError } = collect();
    const token = await sign({ nbf: Math.floor(Date.now() / 1000) + 600 });
    expect(await verifyAccessToken(token, { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["TOKEN_NOT_YET_VALID"]);
  });

  it.each([
    ["sub", { sub: "" }],
    ["tid", { tid: undefined }],
    ["exp", { exp: undefined }],
  ])("rejects a token without %s", async (_claim, claims) => {
    serveJwks([jwkA]);
    const { codes, onError } = collect();
    const token = await sign(claims);
    expect(await verifyAccessToken(token, { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["MISSING_CLAIM"]);
  });

  it.each(["", "a.b", "a.b.c.d", "!!!.e30.sig", `${b64({ alg: "RS256" })}.not-json.sig`, "x".repeat(20000)])(
    "returns null for malformed token %#",
    async (token) => {
      serveJwks([jwkA]);
      expect(await verifyAccessToken(token, opts)).toBeNull();
    },
  );

  it("rejects a kid that is not in the JWKS after one refetch", async () => {
    const fetchMock = serveJwks([jwkA]);
    const { codes, onError } = collect();
    const token = await sign({}, { key: keyB, kid: "key-b" });
    expect(await verifyAccessToken(token, { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["UNKNOWN_KEY"]);
    // First fetch fills the cache; an unknown kid right after is inside the cooldown.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws, and reports CONFIG_ERROR by default, when the tenant id is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = serveJwks([jwkA]);
    const token = await sign();
    expect(await verifyAccessToken(token, { apiUrl: API })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("CONFIG_ERROR");
    expect(String(warn.mock.calls[0]![0])).not.toContain(token);
  });

  it("does not log an ordinary invalid token by default", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    serveJwks([jwkA]);
    expect(await verifyAccessToken(await sign({ tid: OTHER_TENANT }), opts)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("denies and reports JWKS_UNAVAILABLE when the key set cannot be fetched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(await verifyAccessToken(await sign(), opts)).toBeNull();
    expect(String(warn.mock.calls[0]![0])).toContain("JWKS_UNAVAILABLE");
  });

  it("denies when the JWKS endpoint returns an error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));
    const { codes, onError } = collect();
    expect(await verifyAccessToken(await sign(), { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["JWKS_UNAVAILABLE"]);
  });

  it("ignores JWKS keys that are not RS256 signing keys", async () => {
    serveJwks([{ ...jwkA, alg: "RS512" }, { ...jwkA, kid: "key-a2", use: "enc" }]);
    const { codes, onError } = collect();
    expect(await verifyAccessToken(await sign({}, { kid: null }), { ...opts, onError })).toBeNull();
    expect(codes).toEqual(["UNKNOWN_KEY"]);
  });
});

describe("verifyAccessToken: JWKS cache", () => {
  it("fetches the key set once for many verifications, including concurrent ones", async () => {
    const fetchMock = serveJwks([jwkA]);
    const token = await sign();
    const results = await Promise.all([1, 2, 3].map(() => verifyAccessToken(token, opts)));
    expect(results.every((r) => r !== null)).toBe(true);
    expect(await verifyAccessToken(token, opts)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("picks up a rotated key: an unknown kid refetches once the cooldown has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = serveJwks([jwkA], [jwkA, jwkB]);
    expect(await verifyAccessToken(await sign(), opts)).not.toBeNull();
    vi.setSystemTime(Date.now() + 31_000);
    const rotated = await sign({}, { key: keyB, kid: "key-b" });
    expect(await verifyAccessToken(rotated, opts)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches after the 10-minute max age", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fetchMock = serveJwks([jwkA]);
    expect(await verifyAccessToken(await sign(), opts)).not.toBeNull();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await verifyAccessToken(await sign(), opts)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("verifyRequest", () => {
  it("verifies the Bearer token of a Request", async () => {
    serveJwks([jwkA]);
    const req = new Request("http://localhost/api/x", { headers: { authorization: `Bearer ${await sign()}` } });
    expect(await verifyRequest(req, opts)).toMatchObject({ userId: "user-1" });
  });

  it("accepts a Headers object (Server Components: await headers())", async () => {
    serveJwks([jwkA]);
    const headers = new Headers({ Authorization: `bearer ${await sign()}` });
    expect(await verifyRequest(headers, opts)).toMatchObject({ userId: "user-1" });
  });

  it.each([undefined, "", "Basic abc", "Bearer", "Bearer a b", "Token abc"])(
    "returns null without fetching for authorization header %j",
    async (value) => {
      const fetchMock = serveJwks([jwkA]);
      const headers: Record<string, string> = value === undefined ? {} : { authorization: value };
      expect(await verifyRequest(new Request("http://localhost/", { headers }), opts)).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a cross-tenant token presented as a Bearer header", async () => {
    serveJwks([jwkA]);
    const req = new Request("http://localhost/", {
      headers: { authorization: `Bearer ${await sign({ tid: OTHER_TENANT })}` },
    });
    expect(await verifyRequest(req, opts)).toBeNull();
  });
});

describe("framework control flow", () => {
  it("lets a Next.js dynamic-usage error from reading headers propagate", async () => {
    const signal = Object.assign(new Error("Dynamic server usage: headers"), { digest: "DYNAMIC_SERVER_USAGE" });
    const req = { headers: { get: () => { throw signal; } } };
    await expect(verifyRequest(req, opts)).rejects.toBe(signal);
  });

  it("lets a prerender interruption thrown by fetch propagate", async () => {
    const signal = Object.assign(new Error("prerender"), { digest: "NEXT_PRERENDER_INTERRUPTED" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(signal);
    // fetchJwks wraps network errors; a control-flow signal must not be wrapped.
    await expect(verifyAccessToken(await sign(), opts)).rejects.toBe(signal);
  });
});
