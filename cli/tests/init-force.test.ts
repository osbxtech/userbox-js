import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Flags } from "../src/bin.js";
import { init } from "../src/commands/init.js";
import { saveCredentials } from "../src/credentials.js";
import type { Output } from "../src/output.js";
import { apiKeyPrefix } from "../src/userbox.js";

const confirm = vi.fn<(q: string) => Promise<boolean>>();
vi.mock("../src/prompt.js", () => ({ confirm: (q: string) => confirm(q), ask: vi.fn(), requireTty: vi.fn() }));

const API = "https://api.test.example.dev";
const flags: Flags = { json: true, yes: false, force: true, skipInstall: true, invite: [], goLive: false, workspacesWrite: false };
const environments = [{ id: "env-prod", name: "Production", slug: "production", type: "production", isDefault: true }];
// Obviously fake keys in the real shape (ub_<ns>_<hex>_<secret>).
const OLD_KEY = "ub_prod_0ldf4ke0_not-a-real-secret";
const NEW_KEY = "ub_prod_new0fake_not-a-real-secret";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

let dir: string;
let cwd: string;
let calls: { url: string; method: string }[];
let warnings: string[];
let doc: Record<string, unknown>;
const out: Output = {
  json: true,
  step() {},
  warn: (m) => warnings.push(m),
  done: (r) => (doc = r),
};

function setTty(on: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: on });
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: on });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "userbox-init-force-"));
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
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "app", "layout.tsx"), "export default function L({ children }) { return children; }\n");
  writeFileSync(join(dir, ".env.local"), `USERBOX_API_KEY=${OLD_KEY}\n`);
  calls = [];
  warnings = [];
  doc = {};
  confirm.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.endsWith("/v1/environments")) return json({ environments });
      if (url.endsWith("/v1/environments/env-prod/auth-settings") && method === "GET") {
        return json({ allowed_redirect_domains: ["localhost"], allow_self_signup: true });
      }
      if (method === "POST" && url.endsWith("/v1/api-keys")) return json({ key: NEW_KEY });
      if (method === "GET" && url.includes("/v1/api-keys?")) {
        return json({
          items: [
            { id: "key-other", name: "ci", prefix: "ub_prod_aaaa1111", status: "active" },
            { id: "key-old", name: "cli laptop 2026-11-05", prefix: "ub_prod_0ldf4ke0", status: "active" },
          ],
          total: 2,
        });
      }
      if (method === "DELETE" && url.endsWith("/v1/api-keys/key-old")) return new Response(null, { status: 204 });
      throw new Error(`unexpected call ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setTty(false);
});

const deletes = () => calls.filter((c) => c.method === "DELETE");

describe("apiKeyPrefix", () => {
  it("keeps the public prefix and drops the secret", () => {
    expect(apiKeyPrefix(OLD_KEY)).toBe("ub_prod_0ldf4ke0");
    expect(apiKeyPrefix("not-a-key")).toBeNull();
  });
});

describe("init --force and the replaced API key", () => {
  it("never revokes for an agent (--json): it reports the key instead", async () => {
    await init(flags, out);
    expect(confirm).not.toHaveBeenCalled();
    expect(deletes()).toEqual([]);
    expect(doc.replacedApiKey).toEqual({ id: "key-old", name: "cli laptop 2026-11-05", prefix: "ub_prod_0ldf4ke0", revoked: false });
    expect(warnings).toContainEqual(expect.stringContaining("is still active"));
    // The old key's secret is never sent anywhere.
    expect(calls.some((c) => c.url.includes("not-a-real-secret"))).toBe(false);
  });

  it("never revokes without a TTY, even without --json", async () => {
    setTty(false);
    await init({ ...flags, json: false }, { ...out, json: false });
    expect(confirm).not.toHaveBeenCalled();
    expect(deletes()).toEqual([]);
  });

  it("revokes the replaced key when the human says yes", async () => {
    setTty(true);
    confirm.mockResolvedValue(true);
    await init({ ...flags, json: false }, { ...out, json: false });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('"cli laptop 2026-11-05" (ub_prod_0ldf4ke0…)'));
    expect(deletes()).toEqual([{ url: `${API}/v1/api-keys/key-old`, method: "DELETE" }]);
    expect(doc.replacedApiKey).toMatchObject({ id: "key-old", revoked: true });
  });

  it("keeps the replaced key when the human says no", async () => {
    setTty(true);
    confirm.mockResolvedValue(false);
    await init({ ...flags, json: false }, { ...out, json: false });
    expect(deletes()).toEqual([]);
    expect(doc.replacedApiKey).toMatchObject({ revoked: false });
  });

  it("does not look anything up when there was no key to replace", async () => {
    writeFileSync(join(dir, ".env.local"), "");
    await init(flags, out);
    expect(calls.some((c) => c.url.includes("/v1/api-keys?"))).toBe(false);
    expect(doc.replacedApiKey).toBeNull();
  });
});
