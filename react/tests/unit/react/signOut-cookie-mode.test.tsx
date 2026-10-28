/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import * as React from "react";
import { UserboxProvider } from "../../../src/react/UserboxProvider";
import { useSession } from "../../../src/react/useSession";
import { useSignOut } from "../../../src/react/useSignOut";

// Regression: in cookie mode the SDK used to POST `{}` to the
// platform's /v1/auth/logout (which requires `refresh_token`) and got 422.
// The refresh token lives in the tenant backend's httpOnly cookie, so the
// backend must revoke; the SDK hands it the access token for that.

const REFRESH_URL = "https://app.example.test/api/auth/refresh";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

const ACCESS = makeJwt({ sub: "u1", tid: "t1", exp: Math.floor(Date.now() / 1000) + 900 });

function Probe(): React.ReactElement {
  const r = useSession();
  const { signOut } = useSignOut();
  if (!r.isLoaded) return <p>loading</p>;
  if (!r.isSignedIn) return <p>signed-out</p>;
  return (
    <button type="button" onClick={() => void signOut({ redirectUri: "https://app.example.test/" })}>
      sign-out
    </button>
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signOut in cookie mode", () => {
  it("skips platform logout and sends the access token with the backend logout action", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (url === REFRESH_URL) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.action === "logout") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ access_token: ACCESS, expires_in: 900 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/v1/users/me")) {
        return new Response(JSON.stringify({ id: "u1", email: "u@example.test", full_name: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    const onError = vi.fn();

    render(
      <UserboxProvider
        tenantSlug="acme"
        baseUrl="https://api.example.test"
        tokenStorage="cookie"
        refreshUrl={REFRESH_URL}
        onError={onError}
      >
        <Probe />
      </UserboxProvider>,
    );

    const button = await screen.findByText("sign-out");
    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(screen.getByText("signed-out")).toBeDefined());

    expect(calls.some((c) => c.url.endsWith("/v1/auth/logout"))).toBe(false);
    const logout = calls.find(
      (c) => c.url === REFRESH_URL && JSON.parse(String(c.init?.body ?? "{}")).action === "logout",
    );
    expect(logout).toBeDefined();
    const headers = new Headers(logout!.init?.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${ACCESS}`);
    expect(onError).not.toHaveBeenCalled();
  });
});
