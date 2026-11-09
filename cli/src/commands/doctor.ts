import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ApiError, Session, rawRequest } from "../api.js";
import type { Flags } from "../bin.js";
import { loadCredentials } from "../credentials.js";
import { ENV_KEYS, ENVIRONMENT_KEY, parseEnv } from "../envfile.js";
import { CliError, type Output } from "../output.js";
import { detectNextProject, type NextProject } from "../project.js";
import { providerPassesEnvironment } from "../scaffold.js";
import {
  type Environment,
  type Workspace,
  getAuthSettings,
  listEnvironments,
  listWorkspaces,
  pickEnvironment,
} from "../userbox.js";

type Status = "pass" | "warn" | "fail" | "skip";

export interface Check {
  name: string;
  status: Status;
  message: string;
  hint?: string;
}

const MIN = { "@userbox/react": 4, "@userbox/node": 1 } as const;
/** First `@userbox/react` alpha with the `environment` provider prop. */
const REACT_ENVIRONMENT_MIN = 5;

function alphaNumber(version: string): number | null {
  const m = /^1\.0\.0-alpha\.(\d+)$/.exec(version);
  if (m) return Number(m[1]);
  return /^\d+\.\d+\.\d+$/.test(version) && !version.startsWith("0.") ? Number.POSITIVE_INFINITY : null;
}

/** The workspace `userbox dev seed` creates. */
const DEV_WORKSPACE_SLUG = "dev";

/** True for a redirect domain that only works on a developer machine. */
export function isLocalRedirectDomain(domain: string): boolean {
  let host = domain.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "");
  if (host.startsWith("[")) host = host.slice(0, host.indexOf("]") + 1);
  else if (host.split(":").length === 2) host = host.split(":")[0] ?? host;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  );
}

/**
 * The `--go-live` checks for the production environment. Warnings, never failures.
 * `projectEnvironment` is the environment this project names on hosted sign-in
 * (`NEXT_PUBLIC_USERBOX_ENVIRONMENT`), if any.
 */
export function goLiveChecks(
  env: Environment,
  domains: string[],
  workspaces: Workspace[],
  projectEnvironment?: Environment,
): Check[] {
  const local = domains.filter(isLocalRedirectDomain);
  const dev = workspaces.find((w) => w.slug === DEV_WORKSPACE_SLUG);
  return [
    local.length === 0
      ? { name: "go-live: redirect domains", status: "pass", message: `no local host allowed in ${env.name}` }
      : {
          name: "go-live: redirect domains",
          status: "warn",
          message: `${env.name} allows redirects to ${local.join(", ")}`,
          hint: goLiveRedirectHint(env, local.length, projectEnvironment),
        },
    dev
      ? {
          name: "go-live: dev workspace",
          status: "warn",
          message: `${env.name} has the workspace "${DEV_WORKSPACE_SLUG}" (${dev.id}) from \`userbox dev seed\``,
          hint: `Archive it in Console → Workspaces before going live; seed dev data with \`userbox dev seed --env <name>\` instead.`,
        }
      : { name: "go-live: dev workspace", status: "pass", message: `no "${DEV_WORKSPACE_SLUG}" workspace in ${env.name}` },
  ];
}

function goLiveRedirectHint(env: Environment, count: number, projectEnvironment?: Environment): string {
  const them = count === 1 ? "it" : "them";
  const remove = `Remove ${them} in Console → Auth settings for ${env.name} before going live.`;
  if (projectEnvironment && projectEnvironment.id !== env.id) {
    return `${remove} This project signs in through ${projectEnvironment.name}, so its local sign-in is not affected.`;
  }
  if (!env.isDefault) return remove;
  return `${remove} A local app that names no environment uses ${env.name}'s list and stops signing in once ${count === 1 ? "it is" : "they are"} gone: set it up with \`userbox init --env development\` first.`;
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
  let project: NextProject | null = null;
  try {
    project = detectNextProject(root);
    appDir = project.appDir;
    add({ name: "project", status: "pass", message: `Next.js ${project.nextVersion ?? ""} (${appDir})`.trim() });
  } catch (err) {
    add({ name: "project", status: "fail", message: (err as Error).message, hint: (err as CliError).hint });
  }

  const installed: Record<string, number | null> = {};
  for (const [name, min] of Object.entries(MIN)) {
    const pkgPath = join(root, "node_modules", name, "package.json");
    if (!existsSync(pkgPath)) {
      add({ name, status: "fail", message: "not installed", hint: "Run `userbox init` or install @userbox/react@alpha @userbox/node@alpha." });
      continue;
    }
    const version = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
    const n = alphaNumber(version);
    installed[name] = n;
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
  const named = env.get(ENVIRONMENT_KEY);
  const reactAlpha = installed["@userbox/react"];
  if (named && reactAlpha !== undefined && reactAlpha !== null && reactAlpha < REACT_ENVIRONMENT_MIN) {
    add({
      name: "environment",
      status: "warn",
      message: `.env.local names "${named}", but the installed @userbox/react ignores the environment option`,
      hint: `Install @userbox/react@alpha (1.0.0-alpha.${REACT_ENVIRONMENT_MIN} or newer); until then hosted sign-in uses the default environment's redirect domains.`,
    });
  }
  if (named && project && providerPassesEnvironment(project) === false) {
    add({
      name: "environment",
      status: "warn",
      message: `.env.local names "${named}", but <UserboxProvider> does not pass \`environment\``,
      hint: "Add `environment={process.env.NEXT_PUBLIC_USERBOX_ENVIRONMENT}` to <UserboxProvider>, or hosted sign-in uses the default environment's redirect domains.",
    });
  }
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
  let goLive: { environment: { id: string; name: string } | null; ready: boolean } | undefined;
  if (!creds) {
    add({ name: "redirect domain", status: "skip", message: "not logged in", hint: "Run `userbox login` to also check the tenant settings." });
    if (flags.goLive) {
      add({ name: "go-live", status: "skip", message: "not logged in", hint: "Ask the human to run `npx @userbox/cli login`, then run `userbox doctor --go-live` again." });
      goLive = { environment: null, ready: false };
    }
  } else {
    try {
      const session = Session.load();
      if (tenantId && session.tenantId !== tenantId) {
        add({ name: "login", status: "warn", message: `logged in to ${session.tenantSlug}, but .env.local points at another tenant` });
      } else {
        const environments = await listEnvironments(session);
        // Hosted sign-in checks the redirect against the environment the app
        // names (NEXT_PUBLIC_USERBOX_ENVIRONMENT), else the default one.
        const namedEnv = named ? environments.find((e) => e.slug?.toLowerCase() === named.trim().toLowerCase()) : undefined;
        if (named && !namedEnv) {
          add({
            name: "environment",
            status: "fail",
            message: `.env.local names "${named}", which is not an environment of ${session.tenantSlug}`,
            hint: "Hosted sign-in then uses the default environment. Run `userbox init --env <name>` with an existing environment, or remove the line.",
          });
        }
        const envr = namedEnv ?? pickEnvironment(environments);
        const settings = await getAuthSettings(session, envr);
        const host = new URL(env.get("APP_ORIGIN") ?? "http://localhost:3000").hostname;
        const domains = settings.allowed_redirect_domains ?? [];
        add(domains.includes(host)
          ? { name: "redirect domain", status: "pass", message: `${host} allowed in ${envr.name}` }
          : { name: "redirect domain", status: "fail", message: `${host} is not an allowed redirect domain of ${envr.name}`, hint: `Run \`userbox init${namedEnv ? ` --env ${named}` : ""}\`, or add it in Console → Auth settings for ${envr.name}.` });
        // Sign-up settings always come from the default environment.
        const defaultEnv = pickEnvironment(environments);
        const signupSettings = defaultEnv.id === envr.id ? settings : await getAuthSettings(session, defaultEnv);
        add(signupSettings.allow_self_signup
          ? { name: "sign-up", status: "pass", message: "self-service sign-up is on" }
          : { name: "sign-up", status: "warn", message: "sign-up is invitation-only", hint: "Fine for dev. Turn on self-service sign-up in the console if new users should register." });

        if (flags.goLive) {
          const prod = environments.find((e) => e.type === "production");
          if (!prod) {
            add({ name: "go-live", status: "skip", message: "the tenant has no production environment" });
            goLive = { environment: null, ready: false };
          } else {
            const prodSettings = prod.id === envr.id ? settings : await getAuthSettings(session, prod);
            const found = goLiveChecks(prod, prodSettings.allowed_redirect_domains ?? [], await listWorkspaces(session, prod), namedEnv);
            for (const c of found) add(c);
            goLive = { environment: { id: prod.id, name: prod.name }, ready: found.every((c) => c.status === "pass") };
          }
        }
      }
    } catch (err) {
      add({ name: "login", status: "warn", message: (err as Error).message, hint: (err as CliError).hint });
    }
  }
  if (flags.goLive && !goLive) {
    add({ name: "go-live", status: "skip", message: "the tenant settings could not be checked (see above)" });
    goLive = { environment: null, ready: false };
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  const lines = [failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`];
  if (goLive) {
    lines.push(
      goLive.ready
        ? `Go-live: ${goLive.environment?.name ?? "production"} has no dev leftovers.`
        : "Go-live: review the go-live warnings above before launch.",
    );
  }
  out.done({ healthy: failed === 0, checks, ...(goLive ? { goLive } : {}) }, lines);
  return failed === 0 ? 0 : 1;
}
