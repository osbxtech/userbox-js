import { afterEach, describe, expect, it, vi } from "vitest";

import { logIn } from "../src/commands/login.js";
import { CliError, printError } from "../src/output.js";
import { deriveSignupUrl, resolveSignupUrl } from "../src/signup.js";

const API = "https://api.test.example.dev";
const creds = { email: "founder@example.dev", password: "not-a-real-password", tenantSlug: "acme" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch stub: /v1/auth/login answers `login`, /v1/founder-signup/status answers `status`. */
function stubFetch(login: Response, status: Response | Error) {
  const calls: { url: string; body?: string }[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/v1/auth/login")) return login.clone();
    if (url.endsWith("/v1/founder-signup/status")) {
      if (status instanceof Error) throw status;
      return status.clone();
    }
    throw new Error(`unexpected call ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const invalid = json(401, { code: "INVALID_CREDENTIALS", error: "Invalid email or password" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deriveSignupUrl", () => {
  it("maps api.<base> to auth.<base>/create-account", () => {
    expect(deriveSignupUrl("https://api.test.userbox.app")).toBe("https://auth.test.userbox.app/create-account");
  });

  it("keeps the scheme and port of a local API", () => {
    expect(deriveSignupUrl("http://api.localhost:8000/")).toBe("http://auth.localhost:8000/create-account");
  });
});

describe("resolveSignupUrl", () => {
  it("uses the signup_url from /v1/founder-signup/status", async () => {
    const f = vi.fn(async () => json(200, { open: true, signup_url: "https://auth.example.dev/create-account" }));
    await expect(resolveSignupUrl(API, f as unknown as typeof fetch)).resolves.toBe(
      "https://auth.example.dev/create-account",
    );
  });

  it("falls back to the derived URL when the status call fails", async () => {
    const f = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(resolveSignupUrl(API, f as unknown as typeof fetch)).resolves.toBe(
      "https://auth.test.example.dev/create-account",
    );
  });

  it("ignores a signup_url that is not http(s)", async () => {
    const f = vi.fn(async () => json(200, { signup_url: "javascript:alert(1)" }));
    await expect(resolveSignupUrl(API, f as unknown as typeof fetch)).resolves.toBe(
      "https://auth.test.example.dev/create-account",
    );
  });
});

describe("logIn", () => {
  it("turns a 401 into INVALID_CREDENTIALS with the sign-up URL", async () => {
    stubFetch(invalid, json(200, { signup_url: "https://auth.example.dev/create-account" }));
    const err = await logIn(API, creds).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err).toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "login failed: invalid email, password or tenant slug",
      hint: "No account yet? Create one at https://auth.example.dev/create-account",
      data: { signup_url: "https://auth.example.dev/create-account" },
    });
  });

  it("gives the same error for an unknown email and a wrong password", async () => {
    stubFetch(json(401, { code: "INVALID_CREDENTIALS", error: "Invalid email or password" }), new Error("offline"));
    const unknown = await logIn(API, { ...creds, email: "nobody@example.dev" }).catch((e: unknown) => e);
    stubFetch(json(401, { code: "INVALID_CREDENTIALS", error: "Invalid email or password" }), new Error("offline"));
    const wrong = await logIn(API, { ...creds, password: "another-fake-password" }).catch((e: unknown) => e);
    expect(unknown).toEqual(wrong);
    expect((unknown as CliError).data).toEqual({ signup_url: "https://auth.test.example.dev/create-account" });
  });

  it("never sends the password to the sign-up flow", async () => {
    const calls = stubFetch(invalid, json(200, { signup_url: "https://auth.example.dev/create-account" }));
    await logIn(API, creds).catch(() => undefined);
    const status = calls.filter((c) => c.url.includes("/founder-signup/"));
    expect(status).toHaveLength(1);
    expect(status[0]?.body).toBeUndefined();
  });

  it("leaves other errors alone (no sign-up hint on a rate limit)", async () => {
    stubFetch(json(429, { code: "RATE_LIMITED", error: "Too many login attempts" }), new Error("unused"));
    const err = await logIn(API, creds).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "RATE_LIMITED" });
    expect((err as CliError).data).toBeUndefined();
  });
});

describe("printError --json", () => {
  it("puts signup_url at the top level of the error document", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      printError(
        new CliError("INVALID_CREDENTIALS", "login failed", "No account yet?", { signup_url: "https://auth.x.dev/create-account" }),
        true,
      );
      const doc = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
      expect(doc).toMatchObject({
        ok: false,
        signup_url: "https://auth.x.dev/create-account",
        error: { code: "INVALID_CREDENTIALS" },
      });
    } finally {
      write.mockRestore();
    }
  });
});
