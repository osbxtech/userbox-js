import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiError, Session, rawRequest } from "../api.js";
import type { Flags } from "../bin.js";
import { loadCredentials } from "../credentials.js";
import { ENV_KEYS, parseEnv } from "../envfile.js";
import { CliError, type Output } from "../output.js";
import { detectNextProject } from "../project.js";
import { defaultEnvironment, getAuthSettings } from "../userbox.js";

type Status = "pass" | "warn" | "fail" | "skip";

interface Check {
  name: string;
  status: Status;
  message: string;
  hint?: string;
}

const MIN = { "@userbox/react": 4, "@userbox/node": 1 } as const;

function alphaNumber(version: string): number | null {
  const m = /^1\.0\.0-alpha\.(\d+)$/.exec(version);
  if (m) return Number(m[1]);
  return /^\d+\.\d+\.\d+$/.test(version) && !version.startsWith("0.") ? Number.POSITIVE_INFINITY : null;
}

export async function doctor(flags: Flags, out: Output): Promise<number> {
  const root = process.cwd();
  const checks: Check[] = [];
  const add = (c: Check) => {
    checks.push(c);
    const mark = { pass: "✓", warn: "!", fail: "✗", skip: "-" }[c.status];
    out.step(`${mark} ${c.name}: ${c.message}${c.hint && c.status !== "pass" ? `\n      → ${c.hint}` : ""}`);
  };

  // Project and files
  let appDir = "app";
  try {
    const project = detectNextProject(root);
    appDir = project.appDir;
    add({ name: "project", status: "pass", message: `Next.js ${project.nextVersion ?? ""} (${appDir})`.trim() });
  } catch (err) {
    add({ name: "project", status: "fail", message: (err as Error).message, hint: (err as CliError).hint });
  }

  for (const [name, min] of Object.entries(MIN)) {
    const pkgPath = join(root, "node_modules", name, "package.json");
    if (!existsSync(pkgPath)) {
      add({ name, status: "fail", message: "not installed", hint: "Run `userbox init` or install @userbox/react@alpha @userbox/node@alpha." });
      continue;
    }
    const version = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
    const n = alphaNumber(version);
    add(
      n !== null && n >= min
        ? { name, status: "pass", message: version }
        : { name, status: "fail", message: `${version} is too old`, hint: `Install ${name}@alpha (1.0.0-alpha.${min} or newer).` },
    );
  }

  const files = [
    `${appDir}/api/auth/refresh/route.ts`,
    `${appDir}/auth/callback/page.tsx`,
  ];
  for (const f of files) {
    const found = [f, f.replace(/\.tsx?$/, ".js"), f.replace(/\.tsx$/, ".jsx")].some((p) => existsSync(join(root, p)));
    add(found
      ? { name: f, status: "pass", message: "present" }
      : { name: f, status: "fail", message: "missing", hint: "Run `userbox init` to write it." });
  }

  // Environment file
  const envPath = join(root, ".env.local");
  const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : new Map<string, string>();
  const missing = ENV_KEYS.filter((k) => !env.get(k));
  add(
    missing.length === 0
      ? { name: ".env.local", status: "pass", message: "all five variables set" }
      : { name: ".env.local", status: "fail", message: `missing ${missing.join(", ")}`, hint: "Run `userbox init` (it never overwrites existing values without --force)." },
  );
  const leaked = [...env.entries()].filter(
    ([k, v]) => k.startsWith("NEXT_PUBLIC_") && (/KEY|SECRET|TOKEN|PASSWORD/.test(k) || /^ub_(live|prod|stg|dev)_/.test(v)),
  );
  add(
    leaked.length === 0
      ? { name: "secrets", status: "pass", message: "no secret in a NEXT_PUBLIC_ variable" }
      : { name: "secrets", status: "fail", message: `${leaked.map(([k]) => k).join(", ")} is exposed to the browser`, hint: "Rename it without NEXT_PUBLIC_ and rotate the key in the console." },
  );
  const gitignore = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
  add(
    /^(\.env\*|\.env\.local|\.env\*\.local|\*\.local)\s*$/m.test(gitignore)
      ? { name: ".gitignore", status: "pass", message: ".env.local is ignored" }
      : { name: ".gitignore", status: "fail", message: ".env.local is not ignored", hint: "Add `.env.local` to .gitignore before committing." },
  );

  // Live checks against the API
  const apiUrl = env.get("NEXT_PUBLIC_USERBOX_API_URL");
  const apiKey = env.get("USERBOX_API_KEY");
  const tenantId = env.get("USERBOX_TENANT_ID");
  if (apiUrl) {
    try {
      const jwks = await rawRequest<{ keys: unknown[] }>(apiUrl, "/.well-known/jwks.json");
      add({ name: "api", status: jwks.keys.length > 0 ? "pass" : "fail", message: `${apiUrl} reachable, JWKS has ${jwks.keys.length} key(s)` });
    } catch (err) {
      add({ name: "api", status: "fail", message: (err as Error).message, hint: "Check NEXT_PUBLIC_USERBOX_API_URL." });
    }
  }
  if (apiUrl && apiKey) {
    const auth = { Authorization: `Bearer ${apiKey}` };
    try {
      const t = await rawRequest<{ id: string; slug: string }>(apiUrl, "/v1/tenants/me", { headers: auth });
      const slugOk = t.slug === env.get("NEXT_PUBLIC_USERBOX_TENANT_SLUG");
      add(
        t.id === tenantId && slugOk
          ? { name: "api key", status: "pass", message: `valid for tenant ${t.slug}` }
          : { name: "api key", status: "fail", message: `the key belongs to tenant ${t.slug} (${t.id}), not the one in .env.local`, hint: "Fix USERBOX_TENANT_ID / NEXT_PUBLIC_USERBOX_TENANT_SLUG, or run `userbox init --force`." },
      );
    } catch (err) {
      add({ name: "api key", status: "fail", message: (err as Error).message, hint: "The key is revoked or wrong: run `userbox init --force` for a new one." });
    }
    try {
      await rawRequest(apiUrl, "/v1/access/check", {
        method: "POST",
        headers: auth,
        body: { user_id: randomUUID(), workspace_id: randomUUID(), permission_key: "doctor.probe" },
      });
      add({ name: "scope access:check", status: "pass", message: "granted" });
    } catch (err) {
      const scope = err instanceof ApiError && err.code === "INSUFFICIENT_SCOPE";
      add(scope
        ? { name: "scope access:check", status: "fail", message: "missing: can() always returns false", hint: "Run `userbox init --force` for a key with the right scopes." }
        : { name: "scope access:check", status: "pass", message: "granted" });
    }
  }

  // Checks that need the CLI login
  const creds = loadCredentials();
  if (!creds) {
    add({ name: "redirect domain", status: "skip", message: "not logged in", hint: "Run `userbox login` to also check the tenant settings." });
  } else {
    try {
      const session = Session.load();
      if (tenantId && session.tenantId !== tenantId) {
        add({ name: "login", status: "warn", message: `logged in to ${session.tenantSlug}, but .env.local points at another tenant` });
      } else {
        const envr = await defaultEnvironment(session);
        const settings = await getAuthSettings(session, envr);
        const host = new URL(env.get("APP_ORIGIN") ?? "http://localhost:3000").hostname;
        const domains = settings.allowed_redirect_domains ?? [];
        add(domains.includes(host)
          ? { name: "redirect domain", status: "pass", message: `${host} allowed` }
          : { name: "redirect domain", status: "fail", message: `${host} is not an allowed redirect domain`, hint: "Run `userbox init`, or add it in Console → Auth settings." });
        add(settings.allow_self_signup
          ? { name: "sign-up", status: "pass", message: "self-service sign-up is on" }
          : { name: "sign-up", status: "warn", message: "sign-up is invitation-only", hint: "Fine for dev. Turn on self-service sign-up in the console if new users should register." });
      }
    } catch (err) {
      add({ name: "login", status: "warn", message: (err as Error).message, hint: (err as CliError).hint });
    }
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  out.done({ healthy: failed === 0, checks }, [
    failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`,
  ]);
  return failed === 0 ? 0 : 1;
}
