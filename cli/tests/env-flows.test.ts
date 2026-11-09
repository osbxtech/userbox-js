import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Flags } from "../src/bin.js";
import { doctor } from "../src/commands/doctor.js";
import { init } from "../src/commands/init.js";
import { saveCredentials } from "../src/credentials.js";
import type { Output } from "../src/output.js";

const API = "https://api.test.example.dev";
const flags: Flags = { json: true, yes: false, force: false, skipInstall: false, invite: [], goLive: true, workspacesWrite: false };

const environments = [
  { id: "env-prod", name: "Production", slug: "production", type: "production", isDefault: true },
  { id: "env-dev", name: "Development", slug: "development", type: "development", isDefault: false },
];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function capture(): { out: Output; result: () => Record<string, unknown> } {
  let doc: Record<string, unknown> = {};
  return {
    out: { json: true, step() {}, warn() {}, done: (r) => (doc = r) },
    result: () => doc,
  };
}

let dir: string;
let cwd: string;
let calls: { url: string; method: string; env: string | null; body?: unknown }[];
let prodDomains: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "userbox-doctor-"));
  cwd = process.cwd();
  process.chdir(dir);
  vi.stubEnv("XDG_CONFIG_HOME", join(dir, "config"));
  saveCredentials({
    apiUrl: API,
    tenantSlug: "acme",
    tenantId: "tenant-1",
    email: "founder@example.dev",
    accessToken: "not.a-real.token",
    refreshToken: "not-a-real-refresh-token",
    accessExpiresAt: Date.now() + 600_000,
  });
  calls = [];
  prodDomains = ["localhost", "app.example.dev"];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ url, method, env: headers["X-Environment-ID"] ?? null, body });
      if (url.endsWith("/v1/environments")) return json({ environments });
      if (method === "PATCH" && url.includes("/auth-settings")) return json({});
      if (method === "POST" && url.endsWith("/v1/api-keys")) return json({ key: "fake-test-key-not-real" });
      if (url.endsWith("/v1/environments/env-prod/auth-settings")) {
        return json({ allowed_redirect_domains: prodDomains, allow_self_signup: true });
      }
      if (url.endsWith("/v1/environments/env-dev/auth-settings")) {
        return json({ allowed_redirect_domains: ["localhost"], allow_self_signup: false });
      }
      if (url.includes("/v1/workspaces?")) {
        return json({ items: [{ id: "ws-dev", name: "Dev workspace", slug: "dev", status: "active" }] });
      }
      throw new Error(`unexpected call ${url}`);
    }),
  );
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("doctor --go-live", () => {
  it("reports the production leftovers as warnings in the --json result", async () => {
    const { out, result } = capture();
    await doctor(flags, out);
    const doc = result() as { checks: { name: string; status: string }[]; goLive: unknown };
    expect(doc.goLive).toEqual({ environment: { id: "env-prod", name: "Production" }, ready: false });
    expect(doc.checks.filter((c) => c.name.startsWith("go-live"))).toEqual([
      expect.objectContaining({ name: "go-live: redirect domains", status: "warn" }),
      expect.objectContaining({ name: "go-live: dev workspace", status: "warn" }),
    ]);
    // Sign-in reads the default environment, so doctor never looks at env-dev.
    expect(calls.some((c) => c.url.includes("env-dev"))).toBe(false);
    expect(calls.find((c) => c.url.includes("/v1/workspaces?"))?.env).toBe("env-prod");
  });

  it("checks the redirect domain in the environment the project names", async () => {
    writeFileSync(join(dir, ".env.local"), "NEXT_PUBLIC_USERBOX_ENVIRONMENT=development\nAPP_ORIGIN=http://localhost:3000\n");
    prodDomains = ["app.example.dev"];
    const { out, result } = capture();
    await doctor(flags, out);
    const doc = result() as { checks: { name: string; status: string; message: string; hint?: string }[]; goLive: unknown };
    expect(doc.checks.find((c) => c.name === "redirect domain")).toMatchObject({
      status: "pass",
      message: "localhost allowed in Development",
    });
    expect(calls.some((c) => c.url.endsWith("env-dev/auth-settings"))).toBe(true);
    // Sign-up settings still come from the default environment.
    expect(doc.checks.find((c) => c.name === "sign-up")).toMatchObject({ status: "pass" });
    // SC-005: production without localhost, project on development → no redirect warning.
    expect(doc.checks.find((c) => c.name === "go-live: redirect domains")).toMatchObject({ status: "pass" });
  });

  it("says local sign-in is unaffected when production still lists localhost", async () => {
    writeFileSync(join(dir, ".env.local"), "NEXT_PUBLIC_USERBOX_ENVIRONMENT=development\n");
    const { out, result } = capture();
    await doctor(flags, out);
    const doc = result() as { checks: { name: string; status: string; hint?: string }[] };
    const redirects = doc.checks.find((c) => c.name === "go-live: redirect domains");
    expect(redirects?.status).toBe("warn");
    expect(redirects?.hint).toContain("not affected");
  });

  it("fails when .env.local names an environment the tenant does not have", async () => {
    writeFileSync(join(dir, ".env.local"), "NEXT_PUBLIC_USERBOX_ENVIRONMENT=nope\n");
    const { out, result } = capture();
    await doctor({ ...flags, goLive: false }, out);
    const doc = result() as { checks: { name: string; status: string; message: string }[] };
    expect(doc.checks.find((c) => c.name === "environment")).toMatchObject({ status: "fail" });
    expect(doc.checks.find((c) => c.name === "redirect domain")?.message).toContain("Production");
  });

  it("warns when the Providers file does not pass the environment", async () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "providers.tsx"), "<UserboxProvider tenantSlug=\"acme\">{children}</UserboxProvider>\n");
    writeFileSync(join(dir, ".env.local"), "NEXT_PUBLIC_USERBOX_ENVIRONMENT=development\n");
    const { out, result } = capture();
    await doctor({ ...flags, goLive: false }, out);
    const doc = result() as { checks: { name: string; status: string; message: string }[] };
    expect(doc.checks.find((c) => c.name === "environment")).toMatchObject({
      status: "warn",
      message: expect.stringContaining("does not pass `environment`"),
    });
  });

  it("warns when the installed @userbox/react predates the environment option", async () => {
    mkdirSync(join(dir, "node_modules", "@userbox", "react"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "@userbox", "react", "package.json"), JSON.stringify({ version: "1.0.0-alpha.4" }));
    writeFileSync(join(dir, ".env.local"), "NEXT_PUBLIC_USERBOX_ENVIRONMENT=development\n");
    const { out, result } = capture();
    await doctor({ ...flags, goLive: false }, out);
    const doc = result() as { checks: { name: string; status: string; message: string }[] };
    expect(doc.checks).toContainEqual(
      expect.objectContaining({ name: "environment", status: "warn", message: expect.stringContaining("ignores the environment option") }),
    );
  });

  it("leaves goLive out without the flag", async () => {
    const { out, result } = capture();
    await doctor({ ...flags, goLive: false }, out);
    expect(result()).not.toHaveProperty("goLive");
    expect(calls.some((c) => c.url.includes("/v1/workspaces?"))).toBe(false);
  });
});

describe("init --env", () => {
  function nextApp(): void {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "layout.tsx"), "export default function L({ children }) { return children; }\n");
  }

  it("puts the key and the redirect domain in --env, and names it in .env.local", async () => {
    nextApp();
    const warnings: string[] = [];
    const { out, result } = capture();
    await init({ ...flags, goLive: false, skipInstall: true, env: "development", origin: "http://shop.localhost:3000" }, { ...out, warn: (m) => warnings.push(m) });

    expect(calls.find((c) => c.url.endsWith("/v1/api-keys"))?.env).toBe("env-dev");
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe(`${API}/v1/environments/env-dev/auth-settings`);
    expect(patch?.body).toEqual({ allowed_redirect_domains: ["localhost", "shop.localhost"] });
    expect(calls.some((c) => c.url.includes("env-prod/auth-settings"))).toBe(false);
    expect(warnings.join("\n")).not.toContain("default environment");
    expect(result()).toMatchObject({
      environment: { id: "env-dev" },
      redirectDomainEnvironment: { id: "env-dev" },
      namedEnvironment: "development",
    });
    const envFile = readFileSync(join(dir, ".env.local"), "utf8");
    expect(envFile).toContain("USERBOX_API_KEY=");
    expect(envFile).toContain("NEXT_PUBLIC_USERBOX_ENVIRONMENT=development");
    // No tsconfig in this fixture, so the scaffold writes JSX.
    expect(readFileSync(join(dir, "app", "providers.jsx"), "utf8")).toContain(
      "environment={process.env.NEXT_PUBLIC_USERBOX_ENVIRONMENT}",
    );
  });

  it("without --env keeps the default environment and does not name one", async () => {
    nextApp();
    const { out, result } = capture();
    await init({ ...flags, goLive: false, skipInstall: true }, out);

    // localhost is already in production's list, so there is only the read.
    expect(calls.some((c) => c.url.endsWith("env-prod/auth-settings"))).toBe(true);
    expect(calls.some((c) => c.url.includes("env-dev/auth-settings"))).toBe(false);
    expect(result()).toMatchObject({ redirectDomainEnvironment: { id: "env-prod" }, namedEnvironment: null });
    expect(readFileSync(join(dir, ".env.local"), "utf8")).not.toContain("NEXT_PUBLIC_USERBOX_ENVIRONMENT");
  });

  it("warns when .env.local names an environment but the run used the default", async () => {
    nextApp();
    writeFileSync(join(dir, ".env.local"), "NEXT_PUBLIC_USERBOX_ENVIRONMENT=development\n");
    const warnings: string[] = [];
    const { out } = capture();
    await init({ ...flags, goLive: false, skipInstall: true }, { ...out, warn: (m) => warnings.push(m) });
    expect(warnings).toContainEqual(expect.stringContaining('names the environment "development"'));
  });

  it("updates the environment line on a later --env without --force", async () => {
    nextApp();
    writeFileSync(join(dir, ".env.local"), "NEXT_PUBLIC_USERBOX_ENVIRONMENT=staging\nUSERBOX_API_KEY=fake-existing-key\n");
    const { out } = capture();
    await init({ ...flags, goLive: false, skipInstall: true, env: "development" }, out);
    const envFile = readFileSync(join(dir, ".env.local"), "utf8");
    expect(envFile).toContain("NEXT_PUBLIC_USERBOX_ENVIRONMENT=development");
    expect(envFile).not.toContain("NEXT_PUBLIC_USERBOX_ENVIRONMENT=staging");
    expect(envFile).toContain("USERBOX_API_KEY=fake-existing-key");
  });

  it("asks to add the prop when an older Providers file exists", async () => {
    nextApp();
    writeFileSync(
      join(dir, "app", "providers.tsx"),
      '"use client";\nimport { UserboxProvider } from "@userbox/react";\nexport function Providers({ children }) { return <UserboxProvider tenantSlug="acme" baseUrl="x" tokenStorage="cookie">{children}</UserboxProvider>; }\n',
    );
    const warnings: string[] = [];
    const { out } = capture();
    await init({ ...flags, goLive: false, skipInstall: true, env: "development" }, { ...out, warn: (m) => warnings.push(m) });
    expect(warnings).toContainEqual(expect.stringContaining("predates the environment option"));
  });

  it("creates the key without workspaces:write by default, and never asks an agent", async () => {
    nextApp();
    const { out, result } = capture();
    await init({ ...flags, goLive: false, skipInstall: true }, out);

    expect(calls.find((c) => c.url.endsWith("/v1/api-keys"))?.body).toMatchObject({
      scopes: ["access:check", "memberships:read", "workspaces:read"],
    });
    expect(result()).toMatchObject({ apiKeyScopes: ["access:check", "memberships:read", "workspaces:read"] });
  });

  it("adds workspaces:write to the key with --workspaces-write", async () => {
    nextApp();
    const { out, result } = capture();
    await init({ ...flags, goLive: false, skipInstall: true, workspacesWrite: true }, out);

    expect(calls.find((c) => c.url.endsWith("/v1/api-keys"))?.body).toMatchObject({
      scopes: ["access:check", "memberships:read", "workspaces:read", "workspaces:write"],
    });
    expect(result()).toMatchObject({ apiKeyScopes: expect.arrayContaining(["workspaces:write"]) });
  });
});
