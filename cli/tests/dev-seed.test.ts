import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Flags } from "../src/bin.js";
import { devSeed } from "../src/commands/dev-seed.js";
import { saveCredentials } from "../src/credentials.js";
import type { Output } from "../src/output.js";

const API = "https://api.test.example.dev";
const flags: Flags = { json: true, yes: true, force: false, skipInstall: false, invite: [], goLive: false, workspacesWrite: false };

// An unsigned token whose `sub` is the logged-in user; never verified by the CLI.
const fakeToken = `x.${Buffer.from(JSON.stringify({ sub: "user-me" })).toString("base64url")}.x`;

let dir: string;
let cwd: string;
let calls: { method: string; path: string; body?: unknown }[];
let warnings: string[];

const out: Output = { json: true, step() {}, warn: (m) => warnings.push(m), done() {} };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "userbox-seed-"));
  cwd = process.cwd();
  process.chdir(dir);
  vi.stubEnv("XDG_CONFIG_HOME", join(dir, "config"));
  saveCredentials({
    apiUrl: API,
    tenantSlug: "acme",
    tenantId: "tenant-1",
    email: "founder@example.dev",
    accessToken: fakeToken,
    refreshToken: "not-a-real-refresh-token",
    accessExpiresAt: Date.now() + 600_000,
  });
  calls = [];
  warnings = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path: url.pathname, body });
      const path = url.pathname;
      if (path === "/v1/environments") {
        return json({ environments: [{ id: "env-dev", name: "Development", slug: "development", type: "development", isDefault: true }] });
      }
      if (path === "/v1/workspaces" && method === "GET") {
        return json({ items: [{ id: "ws-dev", name: "Dev workspace", slug: "dev", status: "active" }] });
      }
      if (path === "/v1/roles" && method === "GET") {
        return json({
          items: [
            { id: "role-admin", name: "Admin", managed_by: "apply", scope: "environment", description: null },
            { id: "role-member", name: "member", managed_by: "apply", scope: "environment", description: null },
          ],
          next_cursor: null,
          limit: 200,
        });
      }
      if (path === "/v1/memberships" && method === "GET") {
        return json({ items: [{ id: "m-me", user_id: "user-me", workspace_id: "ws-dev", email: "founder@example.dev", status: "active" }] });
      }
      if (path === "/v1/memberships" && method === "POST") {
        return json({ id: "m-new", user_id: null, workspace_id: "ws-dev", email: "teammate@example.dev", status: "invited" }, 201);
      }
      if (/^\/v1\/memberships\/[^/]+\/roles$/.test(path) && method === "POST") {
        return json({ membership_id: path.split("/")[3], role_id: (body as { role_id: string }).role_id });
      }
      throw new Error(`unexpected call ${method} ${url.href}`);
    }),
  );
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("dev seed on the role catalogue", () => {
  it("assigns catalogue roles to memberships and creates no workspace roles", async () => {
    await devSeed({ ...flags, invite: ["teammate@example.dev:Member"] }, out);

    const assigned = calls.filter((c) => c.method === "POST" && c.path.endsWith("/roles"));
    expect(assigned).toEqual([
      { method: "POST", path: "/v1/memberships/m-me/roles", body: { role_id: "role-admin" } },
      { method: "POST", path: "/v1/memberships/m-new/roles", body: { role_id: "role-member" } },
    ]);
    expect(calls.some((c) => c.path.startsWith("/v1/workspaces/"))).toBe(false);
    expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/roles")).toHaveLength(1);
    expect(warnings).toContain("No userbox.yaml: using the roles already in the environment's catalogue.");
  });
});
