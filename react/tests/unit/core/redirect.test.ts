import { describe, expect, it, beforeEach } from "vitest";
import {
  assertValidReturnTo,
  assertValidSlug,
  buildAuthSurfaceUrl,
  isValidSlug,
} from "../../../src/core/redirect";
import { isUserboxError } from "../../../src/core/errors";

describe("isValidSlug", () => {
  it("accepts ASCII lowercase alnum + hyphens", () => {
    expect(isValidSlug("acme")).toBe(true);
    expect(isValidSlug("a-b-c-2025")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
  });
  it("rejects empty / uppercase / leading hyphen / trailing hyphen / underscore", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("Acme")).toBe(false);
    expect(isValidSlug("-acme")).toBe(false);
    expect(isValidSlug("acme-")).toBe(false);
    expect(isValidSlug("foo_bar")).toBe(false);
  });
});

describe("assertValidSlug", () => {
  it("throws misconfigured(tenantSlug) on empty slug", () => {
    try {
      assertValidSlug("");
      throw new Error("expected throw");
    } catch (err) {
      expect(isUserboxError(err)).toBe(true);
      if (isUserboxError(err) && err.kind === "misconfigured") {
        expect(err.field).toBe("tenantSlug");
      }
    }
  });
});

describe("buildAuthSurfaceUrl", () => {
  it("derives the auth-surface origin from baseUrl with the .auth. infix", () => {
    const url = buildAuthSurfaceUrl({
      tenantSlug: "acme",
      baseUrl: "https://api.userbox.app",
      path: "/login",
      returnTo: "https://acme.example.test/dashboard",
      state: "nonce-xyz",
      flowId: "flow-1",
    });
    const u = new URL(url);
    expect(u.origin).toBe("https://acme.auth.userbox.app");
    expect(u.pathname).toBe("/login");
    expect(u.searchParams.get("return_to")).toBe("https://acme.example.test/dashboard");
    expect(u.searchParams.get("state")).toBe("nonce-xyz");
    expect(u.searchParams.get("flow_id")).toBe("flow-1");
  });

  it("derives the auth-surface origin for local-dev http hosts", () => {
    const url = buildAuthSurfaceUrl({
      tenantSlug: "acme",
      baseUrl: "http://api.userbox.localhost",
      path: "/login",
      returnTo: "http://app.acme.localhost/callback",
      state: "n",
      flowId: "f",
    });
    expect(new URL(url).origin).toBe("http://acme.auth.userbox.localhost");
  });

  it("preserves the port when deriving the auth-surface origin", () => {
    const url = buildAuthSurfaceUrl({
      tenantSlug: "acme",
      baseUrl: "https://api.userbox.app:8443",
      path: "/login",
      returnTo: "https://app.userbox.app/cb",
      state: "n",
      flowId: "f",
    });
    expect(new URL(url).origin).toBe("https://acme.auth.userbox.app:8443");
  });

  it("honours baseAuthUrl override (self-hosted escape hatch)", () => {
    const url = buildAuthSurfaceUrl({
      tenantSlug: "acme",
      baseUrl: "https://api.userbox.app", // would normally derive
      baseAuthUrl: "http://acme.userbox.localhost:3000", // override wins
      path: "/signup",
      returnTo: "http://app.userbox.localhost:3001/cb",
      state: "n",
      flowId: "f",
    });
    expect(new URL(url).origin).toBe("http://acme.userbox.localhost:3000");
  });
});

describe("assertValidReturnTo", () => {
  beforeEach(() => {
    // In a node-env test window is undefined; the function is then origin-agnostic.
  });

  it("rejects cross-origin URLs when an origin is provided", () => {
    try {
      assertValidReturnTo("https://attacker.example/exfil", "https://app.example.test");
      throw new Error("expected throw");
    } catch (err) {
      expect(isUserboxError(err)).toBe(true);
    }
  });
  it("rejects long URLs", () => {
    const long = "https://app.example.test/" + "a".repeat(3000);
    try {
      assertValidReturnTo(long);
      throw new Error("expected throw");
    } catch (err) {
      expect(isUserboxError(err)).toBe(true);
    }
  });
});
