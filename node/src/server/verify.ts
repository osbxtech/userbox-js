import type { webcrypto } from "node:crypto";
import { UserboxError } from "../errors";
import { normaliseBaseUrl } from "../http";
import { ENV, requireSetting } from "./env";
import { isFrameworkControlFlow, report, type ErrorReporter } from "./report";

type CryptoKey = webcrypto.CryptoKey;
type SubtleCrypto = webcrypto.SubtleCrypto;

/**
 * Access-token verification, RS256 only, against the tenant API's JWKS.
 *
 * Zero runtime dependencies: the signature is checked with the platform's
 * Web Crypto API (`globalThis.crypto.subtle`). The algorithm is fixed in code:
 * a token whose header says anything other than `RS256` is rejected before any
 * key is touched, and keys are imported only as RSASSA-PKCS1-v1_5 / SHA-256,
 * so no algorithm can be negotiated from the token.
 */

export interface VerifiedUser {
  /** The user id (`sub`). */
  userId: string;
  /** The tenant UUID (`tid`); always equal to the configured tenant. */
  tenantId: string;
  /** Token expiry, milliseconds since the epoch (`exp * 1000`). */
  expiresAt: number;
}

export interface VerifyOptions {
  /** Tenant API base URL. Default: `USERBOX_API_URL`, then `NEXT_PUBLIC_USERBOX_API_URL`. */
  apiUrl?: string;
  /** Tenant UUID the token must belong to (`tid`). Default: `USERBOX_TENANT_ID`. */
  tenantId?: string;
  /** Allowed clock skew for `exp` / `nbf`, in seconds. Default 5, max 60. */
  clockToleranceSec?: number;
  /**
   * Called with the reason a present token was rejected (`TOKEN_EXPIRED`,
   * `INVALID_SIGNATURE`, `TENANT_MISMATCH`, …). The default prints only
   * `CONFIG_ERROR` and `JWKS_UNAVAILABLE`, which mean the app or the network
   * is misconfigured, not that the caller is unauthenticated.
   */
  onError?: ErrorReporter;
}

/** Anything with a `headers.get()` (Request, NextRequest) or a Headers-like object itself. */
export type RequestLike =
  | { headers: { get(name: string): string | null } }
  | { get(name: string): string | null };

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const JWKS_MAX_AGE_MS = 10 * 60 * 1000;
const JWKS_COOLDOWN_MS = 30 * 1000;
const JWKS_TIMEOUT_MS = 5 * 1000;
const MAX_TOKEN_LENGTH = 16 * 1024;
const DEFAULT_TOLERANCE_SEC = 5;
const QUIET_BY_DEFAULT: ReadonlySet<string> = new Set([
  "MALFORMED_TOKEN",
  "UNSUPPORTED_ALGORITHM",
  "UNKNOWN_KEY",
  "INVALID_SIGNATURE",
  "TOKEN_EXPIRED",
  "TOKEN_NOT_YET_VALID",
  "MISSING_CLAIM",
  "TENANT_MISMATCH",
]);

function reject(code: string, message: string): never {
  throw new UserboxError({ status: 401, code, message });
}

// ---------------------------------------------------------------- base64url

const B64URL = /^[A-Za-z0-9_-]*$/;

function base64UrlToBytes(segment: string): Uint8Array {
  if (!B64URL.test(segment) || segment.length % 4 === 1) reject("MALFORMED_TOKEN", "Malformed token");
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(segment)));
  } catch (err) {
    if (err instanceof UserboxError) throw err;
    reject("MALFORMED_TOKEN", "Malformed token");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    reject("MALFORMED_TOKEN", "Malformed token");
  }
  return value as Record<string, unknown>;
}

// --------------------------------------------------------------------- JWKS

interface RsaJwk {
  kty: "RSA";
  n: string;
  e: string;
  kid?: string;
  alg?: string;
  use?: string;
}

interface JwksEntry {
  keys: RsaJwk[];
  fetchedAt: number;
  inflight: Promise<RsaJwk[]> | null;
  cryptoKeys: Map<string, Promise<CryptoKey>>;
}

const jwksCache = new Map<string, JwksEntry>();

/** Test hook: forget every cached key set. */
export function _resetJwksCache(): void {
  jwksCache.clear();
}

function isUsableRsaJwk(value: unknown): value is RsaJwk {
  if (typeof value !== "object" || value === null) return false;
  const k = value as Record<string, unknown>;
  return (
    k.kty === "RSA" &&
    typeof k.n === "string" &&
    typeof k.e === "string" &&
    (k.kid === undefined || typeof k.kid === "string") &&
    (k.alg === undefined || k.alg === "RS256") &&
    (k.use === undefined || k.use === "sig")
  );
}

async function fetchJwks(url: string): Promise<RsaJwk[]> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
    });
  } catch (err) {
    if (isFrameworkControlFlow(err)) throw err;
    throw new UserboxError({
      status: 0,
      code: "JWKS_UNAVAILABLE",
      message: `JWKS fetch failed: ${err instanceof Error ? err.name : "network error"}`,
    });
  }
  if (!res.ok) {
    throw new UserboxError({ status: res.status, code: "JWKS_UNAVAILABLE", message: `JWKS fetch failed: HTTP ${res.status}` });
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) {
    throw new UserboxError({ status: res.status, code: "JWKS_UNAVAILABLE", message: "JWKS response has no keys" });
  }
  return keys.filter(isUsableRsaJwk);
}

/**
 * Returns the cached key set, fetching it when absent or older than 10 minutes.
 * `forceRefresh` (an unknown `kid`) refetches at most once per 30 seconds.
 * Concurrent fetches for the same URL share one request.
 */
async function getKeys(url: string, forceRefresh: boolean): Promise<RsaJwk[]> {
  let entry = jwksCache.get(url);
  if (!entry) {
    entry = { keys: [], fetchedAt: 0, inflight: null, cryptoKeys: new Map() };
    jwksCache.set(url, entry);
  }
  const age = Date.now() - entry.fetchedAt;
  const stale = entry.fetchedAt === 0 || age > JWKS_MAX_AGE_MS;
  const mayRefresh = forceRefresh && age > JWKS_COOLDOWN_MS;
  if (!stale && !mayRefresh) return entry.keys;
  if (!entry.inflight) {
    const current = entry;
    current.inflight = fetchJwks(url)
      .then((keys) => {
        current.keys = keys;
        current.fetchedAt = Date.now();
        current.cryptoKeys.clear();
        return keys;
      })
      .finally(() => {
        current.inflight = null;
      });
  }
  return entry.inflight as Promise<RsaJwk[]>;
}

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!s) {
    throw new UserboxError({
      status: 0,
      code: "CONFIG_ERROR",
      message: "Web Crypto (globalThis.crypto.subtle) is unavailable: use Node 20 or newer",
    });
  }
  return s;
}

function importKey(entry: JwksEntry | undefined, jwk: RsaJwk): Promise<CryptoKey> {
  const cacheKey = `${jwk.kid ?? ""}.${jwk.n}`;
  const cached = entry?.cryptoKeys.get(cacheKey);
  if (cached) return cached;
  const promise = subtle().importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, ext: true }, RS256, false, ["verify"]);
  entry?.cryptoKeys.set(cacheKey, promise);
  promise.catch(() => entry?.cryptoKeys.delete(cacheKey));
  return promise;
}

function candidates(keys: RsaJwk[], kid: string | undefined): RsaJwk[] {
  return kid === undefined ? keys : keys.filter((k) => k.kid === kid);
}

// ------------------------------------------------------------------- verify

async function verifyOrThrow(token: string, options: VerifyOptions): Promise<VerifiedUser> {
  const apiUrl = normaliseBaseUrl(requireSetting(options.apiUrl, ENV.apiUrl, "Userbox API URL"));
  const tenantId = requireSetting(options.tenantId, ENV.tenantId, "Userbox tenant id");
  const tolerance = Math.min(Math.max(options.clockToleranceSec ?? DEFAULT_TOLERANCE_SEC, 0), 60);

  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) reject("MALFORMED_TOKEN", "Malformed token");
  const parts = token.split(".");
  if (parts.length !== 3) reject("MALFORMED_TOKEN", "Malformed token");
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = decodeJsonSegment(headerB64);
  // Algorithm lock: RS256 only, never negotiated from the token.
  if (header.alg !== "RS256") reject("UNSUPPORTED_ALGORITHM", "Unsupported token algorithm");
  if (header.crit !== undefined) reject("MALFORMED_TOKEN", "Unsupported critical header");
  if (header.kid !== undefined && typeof header.kid !== "string") reject("MALFORMED_TOKEN", "Malformed token");
  const kid = header.kid as string | undefined;

  const payload = decodeJsonSegment(payloadB64);
  const signature = base64UrlToBytes(signatureB64);
  const signedBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

  const jwksUrl = `${apiUrl}/.well-known/jwks.json`;
  let keys = candidates(await getKeys(jwksUrl, false), kid);
  if (keys.length === 0) keys = candidates(await getKeys(jwksUrl, true), kid);
  if (keys.length === 0) reject("UNKNOWN_KEY", "Token signed by an unknown key");

  const entry = jwksCache.get(jwksUrl);
  let valid = false;
  for (const jwk of keys.slice(0, 5)) {
    const key = await importKey(entry, jwk);
    if (await subtle().verify(RS256, key, signature, signedBytes)) {
      valid = true;
      break;
    }
  }
  if (!valid) reject("INVALID_SIGNATURE", "Invalid token signature");

  const now = Math.floor(Date.now() / 1000);
  const { exp, nbf, sub, tid } = payload;
  if (typeof exp !== "number" || !Number.isFinite(exp)) reject("MISSING_CLAIM", "Token has no exp claim");
  if (typeof sub !== "string" || sub === "") reject("MISSING_CLAIM", "Token has no sub claim");
  if (typeof tid !== "string" || tid === "") reject("MISSING_CLAIM", "Token has no tid claim");
  if (exp <= now - tolerance) reject("TOKEN_EXPIRED", "Token expired");
  if (nbf !== undefined && (typeof nbf !== "number" || nbf > now + tolerance)) {
    reject("TOKEN_NOT_YET_VALID", "Token not yet valid");
  }
  // Tokens carry no iss/aud: `tid` is the tenant binding.
  if (tid !== tenantId) reject("TENANT_MISMATCH", "Token belongs to another tenant");

  return { userId: sub, tenantId: tid, expiresAt: exp * 1000 };
}

function deny(err: unknown, options: VerifyOptions): null {
  if (isFrameworkControlFlow(err)) throw err;
  const code = err instanceof UserboxError ? err.code : "UNKNOWN_ERROR";
  if (options.onError || !QUIET_BY_DEFAULT.has(code)) report("verifyRequest()", err, options.onError);
  return null;
}

/**
 * Verifies a Userbox access token: RS256 signature against
 * `{apiUrl}/.well-known/jwks.json`, `exp` / `nbf`, required `sub` and `tid`,
 * and `tid` equal to the configured tenant. Returns `null` on any failure; it
 * never throws.
 */
export async function verifyAccessToken(
  token: string | null | undefined,
  options: VerifyOptions = {},
): Promise<VerifiedUser | null> {
  if (typeof token !== "string" || token === "") return null;
  try {
    return await verifyOrThrow(token, options);
  } catch (err) {
    return deny(err, options);
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * Reads `Authorization: Bearer <token>` from a request (or a `Headers` object,
 * e.g. `await headers()` in a Server Component) and verifies it with
 * {@link verifyAccessToken}. Returns the verified user, or `null` when the
 * header is absent or the token is invalid, expired, or for another tenant.
 * Never throws: treat `null` as unauthenticated (401).
 */
export async function verifyRequest(
  req: RequestLike,
  options: VerifyOptions = {},
): Promise<VerifiedUser | null> {
  // Not wrapped in try/catch: during `next build`, reading headers throws a
  // dynamic-usage signal that must reach Next.js (see isFrameworkControlFlow).
  const authorization = "headers" in req ? req.headers.get("authorization") : req.get("authorization");
  const match = BEARER.exec(authorization ?? "");
  if (!match) return null;
  return verifyAccessToken(match[1], options);
}
