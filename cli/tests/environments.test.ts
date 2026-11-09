import { describe, expect, it } from "vitest";

import { goLiveChecks, isLocalRedirectDomain } from "../src/commands/doctor.js";
import { CliError } from "../src/output.js";
import { type Environment, type Workspace, pickEnvironment } from "../src/userbox.js";

const prod: Environment = { id: "env-prod", name: "Production", slug: "production", type: "production", isDefault: true };
const dev: Environment = { id: "env-dev", name: "Local dev", slug: "local-dev", type: "development", isDefault: false };
const envs = [prod, dev];

describe("pickEnvironment", () => {
  it("returns the default environment without --env", () => {
    expect(pickEnvironment(envs)).toBe(prod);
  });

  it("matches the slug, the name and the type, ignoring case", () => {
    expect(pickEnvironment(envs, "local-dev")).toBe(dev);
    expect(pickEnvironment(envs, "Local Dev")).toBe(dev);
    expect(pickEnvironment(envs, "DEVELOPMENT")).toBe(dev);
    expect(pickEnvironment(envs, "production")).toBe(prod);
  });

  it("prefers a slug over another environment's type", () => {
    const odd: Environment = { id: "env-x", name: "x", slug: "development", type: "staging", isDefault: false };
    expect(pickEnvironment([dev, odd], "development")).toBe(odd);
  });

  it("fails with UNKNOWN_ENVIRONMENT listing the available ones", () => {
    const err = (() => {
      try {
        pickEnvironment(envs, "staging");
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(CliError);
    expect(err).toMatchObject({
      code: "UNKNOWN_ENVIRONMENT",
      message: 'no environment "staging" in this tenant',
      hint: expect.stringContaining("production (production, default), local-dev (development)"),
      data: {
        environments: [
          { id: "env-prod", slug: "production", type: "production", isDefault: true },
          { id: "env-dev", slug: "local-dev", type: "development", isDefault: false },
        ],
      },
    });
  });

  it("fails with NO_DEFAULT_ENVIRONMENT when nothing is default", () => {
    expect(() => pickEnvironment([dev])).toThrow(expect.objectContaining({ code: "NO_DEFAULT_ENVIRONMENT" }));
  });
});

describe("isLocalRedirectDomain", () => {
  it.each(["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "0.0.0.0", "localhost:3000", "http://localhost:3000/cb"])(
    "flags %s",
    (d) => expect(isLocalRedirectDomain(d)).toBe(true),
  );

  it.each(["app.example.dev", "localhost.example.dev", "my-localhost.dev", "10.0.0.1"])("leaves %s alone", (d) =>
    expect(isLocalRedirectDomain(d)).toBe(false),
  );
});

describe("goLiveChecks", () => {
  const ws = (slug: string): Workspace => ({ id: `ws-${slug}`, name: slug, slug, status: "active" });

  it("passes a clean production environment", () => {
    const checks = goLiveChecks(prod, ["app.example.dev"], [ws("acme")]);
    expect(checks.map((c) => c.status)).toEqual(["pass", "pass"]);
  });

  it("warns (never fails) about localhost redirects and the dev workspace", () => {
    const checks = goLiveChecks(prod, ["app.example.dev", "localhost", "127.0.0.1"], [ws("acme"), ws("dev")]);
    expect(checks).toEqual([
      expect.objectContaining({
        name: "go-live: redirect domains",
        status: "warn",
        message: "Production allows redirects to localhost, 127.0.0.1",
      }),
      expect.objectContaining({ name: "go-live: dev workspace", status: "warn", message: expect.stringContaining("ws-dev") }),
    ]);
  });

  it("tells a project on another environment that its local sign-in is not affected", () => {
    const dev = { id: "env-dev", name: "Development", slug: "development", type: "development", isDefault: false } as const;
    const [redirects] = goLiveChecks(prod, ["localhost"], [], dev);
    expect(redirects?.hint).toContain("signs in through Development, so its local sign-in is not affected");
    expect(redirects?.hint).not.toContain("stops signing in");
  });

  it("points a project without an environment to init --env", () => {
    const [redirects] = goLiveChecks(prod, ["localhost"], []);
    expect(redirects?.hint).toContain("stops signing in");
    expect(redirects?.hint).toContain("userbox init --env development");
    expect(redirects?.hint).not.toContain("for now");
  });
});
