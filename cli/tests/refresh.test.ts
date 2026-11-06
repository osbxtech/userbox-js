import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Session } from "../src/api.js";
import { saveCredentials } from "../src/credentials.js";
import { CliError } from "../src/output.js";

const API = "https://api.test.example.dev";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "userbox-refresh-"));
  vi.stubEnv("XDG_CONFIG_HOME", join(dir, "config"));
  saveCredentials({
    apiUrl: API,
    tenantSlug: "acme",
    tenantId: "tenant-1",
    email: "founder@example.dev",
    accessToken: "not.a-real.token",
    refreshToken: "not-a-real-refresh-token",
    // Expired access token: the next request refreshes first.
    accessExpiresAt: Date.now() - 1000,
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function requestWithRefreshAnswer(res: Response): Promise<CliError> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/v1/auth/refresh")) return res;
      throw new Error("the request should not be sent after a failed refresh");
    }),
  );
  try {
    await Session.load().request("/v1/environments");
  } catch (err) {
    return err as CliError;
  }
  throw new Error("expected the request to fail");
}

describe("refresh errors", () => {
  it("maps a rejected refresh token (401 INVALID_REFRESH_TOKEN) to SESSION_EXPIRED", async () => {
    const err = await requestWithRefreshAnswer(
      json(401, { code: "INVALID_REFRESH_TOKEN", error: "Refresh token is invalid or expired" }),
    );
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe("SESSION_EXPIRED");
  });

  it("keeps the API's code and message for any other 4xx", async () => {
    const err = await requestWithRefreshAnswer(json(429, { code: "RATE_LIMITED", error: "Too many requests" }));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toContain("Too many requests");
    expect(err.message).toContain("HTTP 429");
    expect(err.hint).toContain("not an expired login");
  });

  it("names the status when the 4xx body has no code", async () => {
    const err = await requestWithRefreshAnswer(new Response("bad", { status: 400, statusText: "Bad Request" }));
    expect(err.code).toBe("HTTP_400");
  });

  it("passes a 5xx through unchanged", async () => {
    const err = await requestWithRefreshAnswer(json(503, { code: "UNAVAILABLE", error: "down" }));
    expect(err.code).toBe("UNAVAILABLE");
    expect(err.message).not.toContain("refreshing");
  });
});
