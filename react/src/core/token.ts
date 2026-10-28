import { authFailed, type UserboxError } from "./errors";

export type JwtClaims = {
  sub: string;
  tid: string;
  exp: number;
  jti?: string;
};

function base64UrlDecode(input: string): string {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  if (typeof atob === "function") return atob(s);
  return Buffer.from(s, "base64").toString("binary");
}

/**
 * Decode JWT claims without signature verification. The server is the only
 * authority on token validity; the SDK uses
 * `exp` only to drive its proactive-refresh timer.
 */
export function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw asAuthFailed("Malformed JWT");
  }
  const payload = parts[1];
  if (!payload) throw asAuthFailed("Malformed JWT payload");

  let json: string;
  try {
    json = base64UrlDecode(payload);
  } catch {
    throw asAuthFailed("Malformed JWT payload");
  }

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw asAuthFailed("Malformed JWT payload");
  }

  if (typeof obj !== "object" || obj === null) {
    throw asAuthFailed("Malformed JWT payload");
  }
  const claims = obj as Record<string, unknown>;
  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const tid = typeof claims.tid === "string" ? claims.tid : null;
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  const jti = typeof claims.jti === "string" ? claims.jti : undefined;
  if (!sub || !tid || exp === null) {
    throw asAuthFailed("JWT missing required claims (sub/tid/exp)");
  }
  return jti ? { sub, tid, exp, jti } : { sub, tid, exp };
}

function asAuthFailed(message: string): UserboxError {
  return authFailed(message, 401, "MALFORMED_JWT");
}
