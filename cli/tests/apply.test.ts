import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Flags } from "../src/bin.js";
import { type Sync, apply, confirmRevokes } from "../src/commands/apply.js";
import { saveCredentials } from "../src/credentials.js";
import { type Plan, planApply } from "../src/manifest.js";
import type { Output } from "../src/output.js";

const API = "https://api.test.example.dev";
const flags: Flags = { json: true, yes: true, force: false, skipInstall: false, invite: [], goLive: false };

function syncWith(plan: Plan): Sync {
  return { manifest: { permissions: [], roles: {} }, plan, remote: new Map(), update: [], createdPermissions: plan.createPermissions };
}

const manifest = { permissions: ["projects.read", "projects.delete"], roles: { admin: ["projects.read", "projects.delete"] } };

describe("confirmRevokes", () => {
  it("lets a purely additive plan through with --yes and no terminal", async () => {
    const plan = planApply(manifest, { permissions: ["projects.read"], roles: { admin: ["projects.read"] } });
    await expect(confirmRevokes(syncWith(plan), flags, "apply")).resolves.toBe(true);
  });

  it("stops a plan that removes a grant with NEEDS_HUMAN, even with --yes", async () => {
    const plan = planApply(
      { permissions: manifest.permissions, roles: { admin: ["projects.read"] } },
      { permissions: manifest.permissions, roles: { admin: ["projects.read", "projects.delete"] } },
    );
    await expect(confirmRevokes(syncWith(plan), flags, "apply")).rejects.toMatchObject({
      code: "NEEDS_HUMAN",
      message: expect.stringContaining("admin → projects.delete"),
    });
  });
});

// --- apply against a fake role catalogue -----------------------------------

interface FakeRole {
  id: string;
  name: string;
  managed_by: string;
  scope?: string;
  grants: { key: string; type: "internal" | "external" }[];
}

let dir: string;
let cwd: string;
let calls: { method: string; path: string; body?: unknown }[];
let permissions: string[];
let roles: FakeRole[];
let warnings: string[];
let result: Record<string, unknown>;

const out: Output = {
  json: true,
  step() {},
  warn: (m) => warnings.push(m),
  done: (r) => (result = r),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function writes() {
  return calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "userbox-apply-"));
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
  warnings = [];
  result = {};
  permissions = ["projects.read"];
  roles = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      calls.push({ method, path: url.pathname, body });
      const path = url.pathname;
      if (path === "/v1/environments") {
        return json({ environments: [{ id: "env-1", name: "Production", slug: "production", type: "production", isDefault: true }] });
      }
      if (path === "/v1/permissions" && method === "GET") {
        return json({ items: permissions.map((key) => ({ id: `p-${key}`, key, type: "external" })), next_cursor: null });
      }
      if (path === "/v1/permissions" && method === "POST") {
        permissions.push(String(body!.key));
        return json({ id: `p-${body!.key}`, key: body!.key, type: "external" }, 201);
      }
      if (path === "/v1/roles" && method === "GET") {
        // Two pages, to exercise the cursor.
        const items = roles.map(({ grants: _g, ...r }) => ({ description: null, ...r }));
        const cursor = url.searchParams.get("cursor");
        return cursor
          ? json({ items: items.slice(1), next_cursor: null, limit: 200 })
          : json({ items: items.slice(0, 1), next_cursor: items.length > 1 ? "page-2" : null, limit: 200 });
      }
      if (path === "/v1/roles" && method === "POST") {
        const role = { id: `r-${body!.name}`, name: String(body!.name), managed_by: String(body!.managed_by), grants: [] };
        roles.push(role);
        return json({ ...role, description: null }, 201);
      }
      const m = /^\/v1\/roles\/([^/]+)(\/permissions)?$/.exec(path);
      const role = m ? roles.find((r) => r.id === m[1]) : undefined;
      if (role && m![2] && method === "GET") {
        return json({
          items: role.grants.map((g) => ({ role_id: role.id, permission_id: `p-${g.key}`, key: g.key, type: g.type, effect: "allow" })),
          next_cursor: null,
          limit: 200,
        });
      }
      if (role && m![2] && method === "PUT") {
        role.grants = (body!.grants as { permission_key: string }[]).map((g) => ({
          key: g.permission_key,
          type: g.permission_key.startsWith("userbox.") ? "internal" : "external",
        }));
        return json({ added: [], changed: [], removed: [] });
      }
      if (role && method === "PATCH") {
        Object.assign(role, body);
        return json({ ...role, description: null });
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

function manifestFile(text: string) {
  writeFileSync(join(dir, "userbox.yaml"), text);
}

describe("apply on the role catalogue", () => {
  it("creates permissions first, then the role in the catalogue, then its grants", async () => {
    manifestFile("permissions: [projects.read, projects.delete]\nroles:\n  admin: [projects.*]\n");
    roles = [{ id: "r-billing", name: "billing", managed_by: "console", grants: [{ key: "projects.read", type: "external" }] }];

    await apply(flags, out);

    expect(writes()).toEqual(["POST /v1/permissions", "POST /v1/roles", "PUT /v1/roles/r-admin/permissions"]);
    expect(calls.find((c) => c.method === "POST" && c.path === "/v1/roles")!.body).toEqual({ name: "admin", managed_by: "apply" });
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({
      grants: [
        { permission_key: "projects.delete", effect: "allow" },
        { permission_key: "projects.read", effect: "allow" },
      ],
      managed_by: "apply",
    });
    expect(calls.some((c) => c.path.startsWith("/v1/workspaces"))).toBe(false);
    expect(warnings).toContain("Role billing exists only in the console (kept)");
    expect(result).toMatchObject({ applied: true, consoleOnlyRoles: ["billing"] });
  });

  it("reads every page of the catalogue", async () => {
    manifestFile("permissions: [projects.read]\nroles:\n  member: [projects.read]\n");
    roles = [
      { id: "r-billing", name: "billing", managed_by: "console", grants: [] },
      { id: "r-member", name: "member", managed_by: "apply", grants: [{ key: "projects.read", type: "external" }] },
    ];

    await apply(flags, out);

    expect(calls.filter((c) => c.method === "GET" && c.path === "/v1/roles")).toHaveLength(2);
    expect(writes()).toEqual([]);
    expect(result).toMatchObject({ upToDate: true });
  });

  it("adopts a console role declared in the file, matching its name case-insensitively, and keeps internal grants", async () => {
    manifestFile("permissions: [projects.read, projects.delete]\nroles:\n  admin: [projects.*]\n");
    permissions = ["projects.read", "projects.delete"];
    roles = [
      {
        id: "r-1",
        name: "Admin",
        managed_by: "console",
        grants: [
          { key: "projects.read", type: "external" },
          { key: "userbox.members.manage", type: "internal" },
        ],
      },
    ];

    await apply(flags, out);

    expect(writes()).toEqual(["PATCH /v1/roles/r-1", "PUT /v1/roles/r-1/permissions"]);
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ name: "admin", managed_by: "apply" });
    const keys = (calls.find((c) => c.method === "PUT")!.body as { grants: { permission_key: string }[] }).grants.map(
      (g) => g.permission_key,
    );
    expect(keys.sort()).toEqual(["projects.delete", "projects.read", "userbox.members.manage"]);
    expect(result.changes).toContain("  ~ role admin: renamed from Admin; managed by userbox.yaml from now on (was console)");
  });

  it("stops with NEEDS_HUMAN before any write when a grant would be removed", async () => {
    manifestFile("permissions: [projects.read, projects.delete]\nroles:\n  admin: [projects.read]\n");
    permissions = ["projects.read", "projects.delete"];
    roles = [
      {
        id: "r-admin",
        name: "admin",
        managed_by: "apply",
        grants: [
          { key: "projects.read", type: "external" },
          { key: "projects.delete", type: "external" },
        ],
      },
    ];

    await expect(apply(flags, out)).rejects.toMatchObject({ code: "NEEDS_HUMAN" });
    expect(writes()).toEqual([]);
  });

  it("ignores workspace-scoped roles left from before the catalogue", async () => {
    manifestFile("permissions: [projects.read]\nroles:\n  admin: [projects.read]\n");
    roles = [{ id: "r-old", name: "admin", managed_by: "console", scope: "workspace", grants: [] }];

    await apply(flags, out);

    expect(writes()).toEqual(["POST /v1/roles", "PUT /v1/roles/r-admin/permissions"]);
    expect(warnings).toEqual([]);
  });
});
