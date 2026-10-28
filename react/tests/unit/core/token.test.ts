import { describe, expect, it } from "vitest";
import { decodeJwtClaims } from "../../../src/core/token";
import { isUserboxError } from "../../../src/core/errors";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = Buffer.from("not-verified").toString("base64url");
  return `${header}.${body}.${sig}`;
}

describe("decodeJwtClaims", () => {
  it("decodes sub/tid/exp/jti from a well-formed JWT", () => {
    const token = makeJwt({
      sub: "u_123",
      tid: "t_456",
      exp: 1_700_000_000,
      jti: "j_789",
    });
    const claims = decodeJwtClaims(token);
    expect(claims).toEqual({
      sub: "u_123",
      tid: "t_456",
      exp: 1_700_000_000,
      jti: "j_789",
    });
  });

  it("decodes expired tokens too — caller decides what to do with exp", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = makeJwt({ sub: "u", tid: "t", exp: past });
    expect(() => decodeJwtClaims(token)).not.toThrow();
    expect(decodeJwtClaims(token).exp).toBe(past);
  });

  it("throws UserboxError on malformed JWT", () => {
    try {
      decodeJwtClaims("not-a-jwt");
      throw new Error("expected throw");
    } catch (err) {
      expect(isUserboxError(err)).toBe(true);
      if (isUserboxError(err) && err.kind === "auth_failed") {
        expect(err.code).toBe("MALFORMED_JWT");
      } else {
        throw new Error("expected auth_failed");
      }
    }
  });

  it("throws on JWT missing required claims", () => {
    const token = makeJwt({ sub: "u" });
    expect(() => decodeJwtClaims(token)).toThrow();
  });
});
