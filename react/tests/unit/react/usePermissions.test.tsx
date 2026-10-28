/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import * as React from "react";
import { UserboxProvider } from "../../../src/react/UserboxProvider";
import { usePermission } from "../../../src/react/usePermission";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

function Gate({ workspaceId, perm, label }: { workspaceId: string; perm: string; label: string }): React.ReactElement {
  const { allowed, isLoaded } = usePermission(workspaceId, perm);
  return (
    <span data-testid={label}>
      {label}:{isLoaded ? (allowed ? "yes" : "no") : "loading"}
    </span>
  );
}

describe("usePermissions cache", () => {
  it("10 gates in the same workspace produce exactly 1 outbound permissions fetch", async () => {
    let permFetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v1/auth/refresh")) {
        return new Response(
          JSON.stringify({
            access_token: makeJwt({ sub: "u1", tid: "t1", exp: 9999 }),
            refresh_token: "rt",
            expires_in: 900,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/access/permissions")) {
        permFetchCount += 1;
        return new Response(JSON.stringify({ permissions: ["users.read", "users.write"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/v1/users/me")) {
        return new Response(JSON.stringify({ email: null, full_name: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });

    const gates = Array.from({ length: 10 }, (_, i) => (
      <Gate key={i} workspaceId="ws-1" perm="users.read" label={`g${i}`} />
    ));

    render(
      <UserboxProvider
        tenantSlug="acme"
        baseUrl="https://api.example.test"
        tokenStorage="cookie"
        refreshUrl="https://api.example.test/v1/auth/refresh"
      >
        {gates}
      </UserboxProvider>,
    );

    await waitFor(() => {
      expect(permFetchCount).toBe(1);
    });
    // Give react any pending effects time to settle then assert single fetch.
    await new Promise((r) => setTimeout(r, 50));
    expect(permFetchCount).toBe(1);
  });

  it("returns allowed=false strictly when not yet loaded (fail-closed)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/v1/auth/refresh")) {
        return new Response(
          JSON.stringify({
            access_token: makeJwt({ sub: "u1", tid: "t1", exp: 9999 }),
            refresh_token: "rt",
            expires_in: 900,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Promise(() => { /* never resolve permissions call */ });
    });

    function Inspector(): React.ReactElement {
      const r = usePermission("ws-1", "any");
      return (
        <span>
          loaded={String(r.isLoaded)} allowed={typeof r.allowed}/{String(r.allowed)}
        </span>
      );
    }

    const { container } = render(
      <UserboxProvider
        tenantSlug="acme"
        baseUrl="https://api.example.test"
        tokenStorage="cookie"
        refreshUrl="https://api.example.test/v1/auth/refresh"
      >
        <Inspector />
      </UserboxProvider>,
    );
    await waitFor(() => {
      expect(container.textContent).toContain("allowed=boolean/false");
    });
  });
});
