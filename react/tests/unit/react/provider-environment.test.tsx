/**
 * @vitest-environment jsdom
 *
 * The optional `environment` provider prop goes on the hosted sign-in and
 * sign-up URLs (Userbox feature 060).
 */
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as React from "react";
import { UserboxProvider } from "../../../src/react/UserboxProvider";
import { useSignIn } from "../../../src/react/useSignIn";
import { useSignUp } from "../../../src/react/useSignUp";

function Buttons(): React.ReactElement {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  return (
    <>
      <button onClick={() => signIn({ returnTo: "http://localhost:3000/auth/callback" })}>in</button>
      <button onClick={() => signUp({ returnTo: "http://localhost:3000/auth/callback" })}>up</button>
    </>
  );
}

let assigned: string[] = [];

beforeEach(() => {
  assigned = [];
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
  // Record navigations instead of performing them.
  const location = { origin: "http://localhost:3000" };
  Object.defineProperty(location, "href", {
    configurable: true,
    get: () => "http://localhost:3000/",
    set: (v: string) => {
      assigned.push(v);
    },
  });
  Object.defineProperty(window, "location", { configurable: true, value: location });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderWith(environment?: string): void {
  render(
    <UserboxProvider
      tenantSlug="acme"
      baseUrl="https://api.example.test"
      tokenStorage="memory"
      environment={environment}
    >
      <Buttons />
    </UserboxProvider>,
  );
}

describe("UserboxProvider environment", () => {
  it("names the environment on sign-in and sign-up", () => {
    renderWith("development");
    fireEvent.click(screen.getByText("in"));
    fireEvent.click(screen.getByText("up"));
    expect(assigned).toHaveLength(2);
    const [login, signup] = assigned.map((u) => new URL(u));
    expect(login!.pathname).toBe("/login");
    expect(login!.searchParams.get("environment")).toBe("development");
    expect(signup!.pathname).toBe("/signup");
    expect(signup!.searchParams.get("environment")).toBe("development");
  });

  it("omits it when the prop is absent or empty", () => {
    for (const env of [undefined, ""]) {
      assigned = [];
      const { unmount } = render(
        <UserboxProvider
          tenantSlug="acme"
          baseUrl="https://api.example.test"
          tokenStorage="memory"
          environment={env}
        >
          <Buttons />
        </UserboxProvider>,
      );
      fireEvent.click(screen.getByText("in"));
      expect(new URL(assigned[0]!).searchParams.has("environment")).toBe(false);
      unmount();
    }
  });

  it("throws misconfigured(environment) for an invalid slug", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderWith("Not Valid")).toThrow(/environment must be/);
  });
});
