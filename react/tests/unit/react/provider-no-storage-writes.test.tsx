/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import * as React from "react";
import { UserboxProvider } from "../../../src/react/UserboxProvider";
import { useSession } from "../../../src/react/useSession";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

function Probe(): React.ReactElement {
  const r = useSession();
  return <span>{r.isLoaded ? (r.isSignedIn ? "in" : "out") : "loading"}</span>;
}

describe("provider does not write credentials to browser storage", () => {
  it("setItem is never called on localStorage or sessionStorage during a full bootstrap", async () => {
    const localSet = vi.spyOn(window.localStorage.__proto__ as Storage, "setItem");
    const sessionSet = vi.spyOn(window.sessionStorage.__proto__ as Storage, "setItem");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          access_token: makeJwt({ sub: "u1", tid: "t1", exp: 9999 }),
          refresh_token: "rt-2",
          expires_in: 900,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { unmount } = render(
      <UserboxProvider tenantSlug="acme" baseUrl="https://api.example.test" tokenStorage="cookie">
        <Probe />
      </UserboxProvider>,
    );

    await waitFor(() => {
      expect(localSet).not.toHaveBeenCalled();
      // Any sessionStorage write must only be ub.auth.state (state-nonce only).
      for (const call of sessionSet.mock.calls) {
        expect(call[0]).toBe("ub.auth.state");
      }
    });
    unmount();
  });
});
