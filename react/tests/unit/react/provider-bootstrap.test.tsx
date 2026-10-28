/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { UserboxProvider } from "../../../src/react/UserboxProvider";
import { useSession } from "../../../src/react/useSession";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function makeRefreshOk(): Response {
  return new Response(
    JSON.stringify({
      access_token: makeJwt({ sub: "u1", tid: "t1", exp: Math.floor(Date.now() / 1000) + 900 }),
      refresh_token: "rt-rotated",
      expires_in: 900,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function SignedInProbe(): React.ReactElement {
  const r = useSession();
  if (!r.isLoaded) return <p>loading</p>;
  if (!r.isSignedIn) return <p>signed-out</p>;
  return <p>signed-in:{r.user.id}</p>;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UserboxProvider bootstrap", () => {
  it("cookie mode bootstraps via /v1/auth/refresh and resolves to signed-in", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v1/auth/refresh")) return makeRefreshOk();
      if (url.endsWith("/v1/users/me")) {
        return new Response(JSON.stringify({ id: "u1", email: "u@example.test", full_name: "User One" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });

    render(
      <UserboxProvider
        tenantSlug="acme"
        baseUrl="https://api.example.test"
        tokenStorage="cookie"
        refreshUrl="https://api.example.test/v1/auth/refresh"
      >
        <SignedInProbe />
      </UserboxProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/^signed-in:/)).toBeDefined();
    });
    expect(screen.getByText("signed-in:u1")).toBeDefined();
  });

  it("memory mode with no refresh credential resolves to signed-out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v1/auth/refresh")) {
        return new Response(JSON.stringify({ code: "INVALID_REFRESH_TOKEN", error: "missing" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });

    render(
      <UserboxProvider
        tenantSlug="acme"
        baseUrl="https://api.example.test"
        tokenStorage="memory"
      >
        <SignedInProbe />
      </UserboxProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("signed-out")).toBeDefined();
    });
  });
});
