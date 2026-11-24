import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, parseError } from "../src/api.js";
import type { Flags } from "../src/bin.js";
import { init } from "../src/commands/init.js";
import { saveCredentials } from "../src/credentials.js";
import { CliError, type Output } from "../src/output.js";
import { permissionFromError } from "../src/permissions.js";

vi.mock("../src/prompt.js", () => ({ confirm: vi.fn(), ask: vi.fn(), requireTty: vi.fn() }));

const API = "https://api.test.example.dev";
const flags: Flags = { json: true, yes: false, force: false, skipInstall: true, invite: [], goLive: false, workspacesWrite: false };
const environments = [{ id: "env-dev", name: "Development", slug: "development", type: "development", isDefault: true }];
const NEW_KEY = "ub_dev_new0fake_not-a-real-secret";
// An unsigned stand-in whose payload carries only `sub`; the CLI never verifies its own token.
const ACCESS_TOKEN = `x.${Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url")}.not-a-signature`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function denied(key: string, nested = false): Response {
  const err = { code: "INSUFFICIENT_PERMISSION", error: `User lacks required permission: ${key}` };
  return json(nested ? { detail: err } : err, 403);
}

let dir: string;
let cwd: string;
let calls: { url: string; method: string }[];
let doc: Record<string, unknown>;
let grants: Response | (() => Response);
let domains: string[];
let patch: () => Response;
const out: Output = { json: true, step() {}, warn() {}, done: (r) => (doc = r) };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "userbox-init-perms-"));
  cwd = process.cwd();
  process.chdir(dir);
  vi.stubEnv("XDG_CONFIG_HOME", join(dir, "config"));
  saveCredentials({
    apiUrl: API,
    tenantSlug: "acme",
    tenantId: "tenant-1",
    email: "founder@example.dev",
    accessToken: ACCESS_TOKEN,
    refreshToken: "not-a-real-refresh-token",
    accessExpiresAt: Date.now() + 600_000,
  });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "app", "layout.tsx"), "export default function L({ children }) { return children; }\n");
  calls = [];
  doc = {};
  domains = [];
  patch = () => json({ allowed_redirect_domains: ["localhost"], allow_self_signup: true });
  grants = () =>
    json({
      items: [
        { permission_id: "p1", key: "userbox.console.access", effect: "allow" },
        { permission_id: "p2", key: "userbox.tenant.manage", effect: "allow" },
        { permission_id: "p3", key: "userbox.api_keys.manage", effect: "allow" },
      ],
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, req?: RequestInit) => {
      const url = String(input);
      const method = req?.method ?? "GET";
      calls.push({ url, method });
      if (url.endsWith("/v1/environments")) return json({ environments });
      if (url.endsWith("/v1/users/user-1/permissions")) return typeof grants === "function" ? grants() : grants;
      if (url.endsWith("/v1/environments/env-dev/auth-settings")) {
        if (method === "PATCH") return patch();
        return json({ allowed_redirect_domains: domains, allow_self_signup: true });
      }
      if (method === "POST" && url.endsWith("/v1/api-keys")) return json({ key: NEW_KEY });
      throw new Error(`unexpected call ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const writes = () => calls.filter((c) => c.method !== "GET");

async function initError(f: Flags = flags): Promise<CliError> {
  const err = await init(f, out).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CliError);
  return err as CliError;
}

describe("init permission preflight", () => {
  it("lists every missing permission and writes nothing", async () => {
    grants = json({ items: [{ permission_id: "p1", key: "userbox.console.access", effect: "allow" }] });
    const err = await initError();
    expect(err.code).toBe("MISSING_PERMISSIONS");
    expect(err.message).toContain("userbox.tenant.manage: to add localhost to the allowed redirect domains of Development");
    expect(err.message).toContain("userbox.api_keys.manage: to create the API key");
    expect(err.message).toContain("nothing was changed");
    expect(err.hint).toContain("Console → Users → Edit");
    expect(err.data?.missing_permissions).toEqual([
      expect.objectContaining({ key: "userbox.tenant.manage" }),
      expect.objectContaining({ key: "userbox.api_keys.manage" }),
    ]);
    expect(writes()).toEqual([]);
    expect(existsSync(join(dir, ".env.local"))).toBe(false);
  });

  it("treats a deny grant as missing", async () => {
    grants = json({
      items: [
        { permission_id: "p1", key: "userbox.console.access", effect: "allow" },
        { permission_id: "p2", key: "userbox.tenant.manage", effect: "deny" },
        { permission_id: "p3", key: "userbox.api_keys.manage", effect: "allow" },
      ],
    });
    const err = await initError();
    expect((err.data?.missing_permissions as { key: string }[]).map((m) => m.key)).toEqual(["userbox.tenant.manage"]);
  });

  it("without console access, asks for it and for tenant.manage, and reads nothing else", async () => {
    grants = json({ items: [{ permission_id: "p3", key: "userbox.api_keys.manage", effect: "allow" }] });
    const err = await initError();
    expect((err.data?.missing_permissions as { key: string }[]).map((m) => m.key)).toEqual([
      "userbox.console.access",
      "userbox.tenant.manage",
    ]);
    expect(calls.some((c) => c.url.includes("auth-settings"))).toBe(false);
  });

  it("does not need tenant.manage when the redirect domain is already allowed", async () => {
    domains = ["localhost"];
    grants = json({
      items: [
        { permission_id: "p1", key: "userbox.console.access", effect: "allow" },
        { permission_id: "p3", key: "userbox.api_keys.manage", effect: "allow" },
      ],
    });
    await init(flags, out);
    expect(doc.apiKeyCreated).toBe(true);
    expect(writes()).toEqual([{ url: `${API}/v1/api-keys`, method: "POST" }]);
  });

  it("does not need api_keys.manage when .env.local keeps its key", async () => {
    writeFileSync(join(dir, ".env.local"), "USERBOX_API_KEY=ub_dev_0ldf4ke0_not-a-real-secret\n");
    grants = json({
      items: [
        { permission_id: "p1", key: "userbox.console.access", effect: "allow" },
        { permission_id: "p2", key: "userbox.tenant.manage", effect: "allow" },
      ],
    });
    await init(flags, out);
    expect(doc.apiKeyCreated).toBe(false);
  });

  it("goes ahead with every permission, reading the auth settings once", async () => {
    await init(flags, out);
    expect(calls.filter((c) => c.url.includes("auth-settings") && c.method === "GET")).toHaveLength(1);
    expect(writes().map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(readFileSync(join(dir, ".env.local"), "utf8")).toContain("USERBOX_API_KEY=");
  });

  it("falls back to the refused call's own error when it cannot read the permissions", async () => {
    grants = denied("userbox.users.read");
    patch = () => denied("userbox.tenant.manage", true);
    const err = await initError();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("INSUFFICIENT_PERMISSION");
    expect(err.message).toContain("userbox.tenant.manage");
    expect(err.message).toContain("needed to change environments");
    expect(err.hint).toContain("Console → Users → Edit");
    expect(err.data).toEqual({ missing_permissions: [expect.objectContaining({ key: "userbox.tenant.manage" })] });
  });
});

describe("API error bodies", () => {
  it("reads {code, error}", async () => {
    const err = await parseError(denied("userbox.api_keys.manage"));
    expect(err.code).toBe("INSUFFICIENT_PERMISSION");
    expect(err.message).toBe(
      "User lacks required permission: userbox.api_keys.manage (needed to create and revoke API keys) (HTTP 403)",
    );
  });

  it("reads {detail: {code, error}}", async () => {
    const err = await parseError(denied("userbox.workspace.create", true));
    expect(err.code).toBe("INSUFFICIENT_PERMISSION");
    expect(err.message).toContain("userbox.workspace.create (needed to create workspaces)");
    expect(err.hint).toContain("userbox.workspace.create");
  });

  it("names an unknown permission without a purpose", async () => {
    const err = await parseError(denied("userbox.something.new"));
    expect(err.message).toBe("User lacks required permission: userbox.something.new (HTTP 403)");
    expect(err.hint).toContain("userbox.something.new");
  });

  it("leaves other errors as they were", async () => {
    const err = await parseError(json({ detail: "Not Found" }, 404));
    expect(err.code).toBe("HTTP_404");
    expect(err.message).toBe("Not Found (HTTP 404)");
    expect(err.hint).toBeUndefined();
  });

  it("finds the permission key in the message", () => {
    expect(permissionFromError("User lacks required permission: userbox.tenant.manage")).toBe("userbox.tenant.manage");
    expect(permissionFromError("API key missing required scope: workspaces:write")).toBeNull();
  });
});
