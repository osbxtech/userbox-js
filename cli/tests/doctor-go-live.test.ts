import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Flags } from "../src/bin.js";
import { doctor } from "../src/commands/doctor.js";
import { saveCredentials } from "../src/credentials.js";
import type { Output } from "../src/output.js";

const API = "https://api.test.example.dev";
const flags: Flags = { json: true, yes: false, force: false, skipInstall: false, invite: [], goLive: true };

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
let calls: { url: string; env: string | null }[];

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
      calls.push({ url, env: headers["X-Environment-ID"] ?? null });
      if (url.endsWith("/v1/environments")) return json({ environments });
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
    await doctor({ ...flags, env: "development" }, out);
    const doc = result() as { checks: { name: string; status: string }[]; goLive: unknown };
    expect(doc.goLive).toEqual({ environment: { id: "env-prod", name: "Production" }, ready: false });
    expect(doc.checks.filter((c) => c.name.startsWith("go-live"))).toEqual([
      expect.objectContaining({ name: "go-live: redirect domains", status: "warn" }),
      expect.objectContaining({ name: "go-live: dev workspace", status: "warn" }),
    ]);
    // The regular redirect check used --env; the go-live checks used production.
    expect(calls.map((c) => c.url)).toContain(`${API}/v1/environments/env-dev/auth-settings`);
    expect(calls.find((c) => c.url.includes("/v1/workspaces?"))?.env).toBe("env-prod");
  });

  it("leaves goLive out without the flag", async () => {
    const { out, result } = capture();
    await doctor({ ...flags, goLive: false }, out);
    expect(result()).not.toHaveProperty("goLive");
    expect(calls.some((c) => c.url.includes("/v1/workspaces?"))).toBe(false);
  });
});
