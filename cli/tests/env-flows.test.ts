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
        return json({ allowed_redirect_domains: ["localhost", "app.example.dev"], allow_self_signup: true });
      }
      if (url.endsWith("/v1/environments/env-dev/auth-settings")) {
        return json({ allowed_redirect_domains: ["localhost"], allow_self_signup: true });
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

  it("creates the key in --env but adds the redirect domain to the default environment", async () => {
    nextApp();
    const warnings: string[] = [];
    const { out, result } = capture();
    await init({ ...flags, goLive: false, skipInstall: true, env: "development", origin: "http://shop.localhost:3000" }, { ...out, warn: (m) => warnings.push(m) });

    expect(calls.find((c) => c.url.endsWith("/v1/api-keys"))?.env).toBe("env-dev");
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url).toBe(`${API}/v1/environments/env-prod/auth-settings`);
    expect(patch?.body).toEqual({ allowed_redirect_domains: ["localhost", "app.example.dev", "shop.localhost"] });
    expect(calls.some((c) => c.url.includes("env-dev/auth-settings"))).toBe(false);
    expect(warnings).toContainEqual(expect.stringContaining('default environment "Production", not "Development"'));
    expect(result()).toMatchObject({
      environment: { id: "env-dev" },
      redirectDomainEnvironment: { id: "env-prod" },
    });
    expect(readFileSync(join(dir, ".env.local"), "utf8")).toContain("USERBOX_API_KEY=");
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
