/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { UserboxProvider } from "../../../src/react/UserboxProvider";
import { UserboxCallback } from "../../../src/react/UserboxCallback";
import { useSession } from "../../../src/react/useSession";
import { issueNonce, _clearAllNonces } from "../../../src/core/state-nonce";

// Regression (1.0.0-alpha.3): with tokenStorage="cookie", the hosted sign-in
// callback adopted a session while the provider's mount-time refresh was
// either already in flight or about to leave. That refresh went out before the
// tenant backend had set the refresh cookie (the `init` request), came back
// 401, and the provider cleared the adopted session: the app stayed signed out
// until a manual reload.

const REFRESH_URL = "https://app.example.test/api/auth/refresh";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

const ACCESS = makeJwt({ sub: "u1", tid: "t1", exp: Math.floor(Date.now() / 1000) + 900 });

function unauthorized(): Response {
  return new Response(JSON.stringify({ code: "INVALID_REFRESH_TOKEN", error: "no cookie" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function Probe(): React.ReactElement {
  const r = useSession();
  if (!r.isLoaded) return <p>loading</p>;
  if (!r.isSignedIn) return <p>signed-out</p>;
  return <p>signed-in:{r.user.id}</p>;
}

function setCallbackHash(): void {
  const { flowId, nonce } = issueNonce();
  const fragment = new URLSearchParams({
    access_token: ACCESS,
    refresh_token: "rt-from-callback",
    expires_in: "900",
    state: nonce,
    flow_id: flowId,
  }).toString();
  window.history.replaceState(null, "", `/auth/callback#${fragment}`);
}

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function bodyOf(init?: RequestInit): Record<string, unknown> {
  return init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  _clearAllNonces();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hosted sign-in callback vs. the provider's mount refresh (cookie mode)", () => {
  it("keeps a session adopted while the mount refresh is in flight and later resolves 401", async () => {
    const mountRefresh = deferred<Response>();
    let refreshCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === REFRESH_URL) {
        if (bodyOf(init).action === "init") return new Response(null, { status: 204 });
        refreshCalls += 1;
        return mountRefresh.promise;
      }
      return new Response(null, { status: 404 });
    });
    const onSessionExpired = vi.fn();

    function App({ showCallback }: { showCallback: boolean }): React.ReactElement {
      return (
        <UserboxProvider
          tenantSlug="acme"
          baseUrl="https://api.example.test"
          tokenStorage="cookie"
          refreshUrl={REFRESH_URL}
          onSessionExpired={onSessionExpired}
        >
          {showCallback ? <UserboxCallback /> : null}
          <Probe />
        </UserboxProvider>
      );
    }

    const view = render(<App showCallback={false} />);
    // The mount refresh has left and is waiting on the network.
    await waitFor(() => expect(refreshCalls).toBe(1));

    setCallbackHash();
    view.rerender(<App showCallback />);
    await waitFor(() => expect(screen.getByText("signed-in:u1")).toBeDefined());

    // The stale refresh now comes back 401.
    await act(async () => {
      mountRefresh.resolve(unauthorized());
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByText("signed-in:u1")).toBeDefined();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("keeps the session when the callback page mounts with the provider and the refresh 401s", async () => {
    setCallbackHash();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === REFRESH_URL) {
        if (bodyOf(init).action === "init") return new Response(null, { status: 204 });
        return unauthorized();
      }
      return new Response(null, { status: 404 });
    });
    const onSessionExpired = vi.fn();
    const onSuccess = vi.fn();

    render(
      <UserboxProvider
        tenantSlug="acme"
        baseUrl="https://api.example.test"
        tokenStorage="cookie"
        refreshUrl={REFRESH_URL}
        onSessionExpired={onSessionExpired}
      >
        <UserboxCallback onSuccess={onSuccess} />
        <Probe />
      </UserboxProvider>,
    );

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    // Past the provider's cross-tab claim window, so any mount refresh has settled.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(screen.getByText("signed-in:u1")).toBeDefined();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("calls onSuccess only after the cookie init request has completed", async () => {
    setCallbackHash();
    const init = deferred<Response>();
    let initSent = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, reqInit?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === REFRESH_URL) {
        if (bodyOf(reqInit).action === "init") {
          initSent = true;
          return init.promise;
        }
        return unauthorized();
      }
      return new Response(null, { status: 404 });
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    render(
      <UserboxProvider
        tenantSlug="acme"
        baseUrl="https://api.example.test"
        tokenStorage="cookie"
        refreshUrl={REFRESH_URL}
      >
        <UserboxCallback onSuccess={onSuccess} onError={onError} />
        <Probe />
      </UserboxProvider>,
    );

    await waitFor(() => expect(initSent).toBe(true));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      init.resolve(new Response(null, { status: 204 }));
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess.mock.calls[0]![0]).toEqual({ user: expect.objectContaining({ id: "u1" }) });
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError and not onSuccess when the cookie init request fails", async () => {
    setCallbackHash();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === REFRESH_URL) {
        if (bodyOf(init).action === "init") {
          return new Response(JSON.stringify({ code: "INIT_FAILED", error: "boom" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        return unauthorized();
      }
      return new Response(null, { status: 404 });
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    render(
      <UserboxProvider
        tenantSlug="acme"
        baseUrl="https://api.example.test"
        tokenStorage="cookie"
        refreshUrl={REFRESH_URL}
      >
        <UserboxCallback onSuccess={onSuccess} onError={onError} />
        <Probe />
      </UserboxProvider>,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
