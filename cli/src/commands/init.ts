import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { Session } from "../api.js";
import type { Flags } from "../bin.js";
import { ENV_KEYS, mergeEnv, parseEnv } from "../envfile.js";
import { CliError, type Output } from "../output.js";
import { confirm } from "../prompt.js";
import { detectNextProject, installCommand } from "../project.js";
import { scaffold } from "../scaffold.js";
import {
  type ApiKeySummary,
  createApiKey,
  type Environment,
  ensureRedirectDomain,
  findActiveApiKey,
  listEnvironments,
  pickEnvironment,
  revokeApiKey,
} from "../userbox.js";

export const KEY_SCOPES = ["access:check", "memberships:read", "workspaces:read"];
/** Opt-in: lets the backend call `createWorkspace()` for each new customer. */
export const WORKSPACES_WRITE = "workspaces:write";

/** `--workspaces-write`, or the human's answer at a terminal; never asked of an agent (`--json`, no TTY). */
async function wantsWorkspacesWrite(flags: Flags): Promise<boolean> {
  if (flags.workspacesWrite) return true;
  if (flags.json || !process.stdin.isTTY || !process.stdout.isTTY) return false;
  return confirm("Will your backend create a workspace per customer? (adds the workspaces:write scope to the API key)");
}
const SDKS = ["@userbox/react@alpha", "@userbox/node@alpha"];

function interactive(flags: Flags): boolean {
  return !flags.json && Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** The active key in `env` that .env.local's USERBOX_API_KEY names; null if none or the lookup fails. */
async function findReplacedKey(session: Session, env: Environment, raw: string, out: Output): Promise<ApiKeySummary | null> {
  try {
    const key = await findActiveApiKey(session, env, raw);
    if (!key) out.step(`The replaced USERBOX_API_KEY is not an active key of ${env.name}; nothing to revoke there.`);
    return key;
  } catch (err) {
    out.warn(`Could not look up the replaced API key (${(err as Error).message}); check API keys in the console.`);
    return null;
  }
}

/**
 * Offer to revoke the key `--force` replaced. Only a human at a terminal can
 * say yes; an agent (`--json`, no TTY) gets a warning and the JSON field,
 * never a silent revoke, because something else may still use the key.
 */
async function settleReplacedKey(
  session: Session,
  env: Environment,
  key: ApiKeySummary,
  flags: Flags,
  out: Output,
): Promise<{ id: string; name: string; prefix: string; revoked: boolean }> {
  const label = `"${key.name}" (${key.prefix}…)`;
  let revoked = false;
  if (interactive(flags) && (await confirm(`Revoke the replaced API key ${label}? Anything still using it stops working.`))) {
    try {
      await revokeApiKey(session, env, key.id);
      revoked = true;
      out.step(`Revoked the replaced API key ${label}`);
    } catch (err) {
      out.warn(`Could not revoke the replaced API key ${label}: ${(err as Error).message}`);
    }
  }
  if (!revoked) {
    out.warn(
      `The replaced API key ${label} is still active. Revoke it in the console (API keys) once nothing uses it.`,
    );
  }
  return { id: key.id, name: key.name, prefix: key.prefix, revoked };
}

function ensureGitignored(root: string): boolean {
  const path = join(root, ".gitignore");
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const covered = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => [".env*", ".env.local", ".env*.local", "*.local"].includes(l));
  if (covered) return false;
  writeFileSync(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}.env.local\n`);
  return true;
}

export async function init(flags: Flags, out: Output): Promise<void> {
  const root = process.cwd();
  const project = detectNextProject(root);
  const session = Session.load();
  const origin = flags.origin ?? "http://localhost:3000";
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    throw new CliError("INVALID_ORIGIN", `--origin must be a URL such as http://localhost:3000, got "${origin}"`);
  }

  const environments = await listEnvironments(session);
  const env = pickEnvironment(environments, flags.env);
  // Hosted sign-in checks redirects against the default environment's auth
  // settings only (it gets a tenant slug, never an environment), so the
  // redirect domain always goes there, whatever --env says.
  const signInEnv = pickEnvironment(environments);
  out.step(`Tenant ${session.tenantSlug}, environment ${env.name} (${env.type})`);
  if (env.type === "production") {
    out.warn(
      flags.env
        ? `The environment "${env.name}" is production; the key created here is a production key.`
        : "The default environment is production; the key created here is a production key. Pass --env <name> to use another environment.",
    );
  }

  const where = signInEnv.id === env.id ? "" : ` of the default environment ${signInEnv.name}`;
  if (await ensureRedirectDomain(session, signInEnv, host)) out.step(`Added ${host} to the allowed redirect domains${where}`);
  else out.step(`${host} is already an allowed redirect domain${where}`);
  if (signInEnv.id !== env.id) {
    out.warn(
      `${host} was added to the redirect domains of the default environment "${signInEnv.name}", not "${env.name}": hosted sign-in only reads the default environment's redirect domains for now.`,
    );
  }

  // .env.local: reuse an existing key unless --force; never print values.
  const envPath = join(root, ".env.local");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const current = parseEnv(existing);
  const values: Record<string, string> = {
    NEXT_PUBLIC_USERBOX_TENANT_SLUG: session.tenantSlug,
    NEXT_PUBLIC_USERBOX_API_URL: session.apiUrl,
    USERBOX_TENANT_ID: session.tenantId,
    APP_ORIGIN: origin,
  };
  let keyCreated = false;
  let keyScopes: string[] | null = null;
  const oldRaw = current.get("USERBOX_API_KEY");
  let replaced: ApiKeySummary | null = null;
  if (flags.force || !oldRaw) {
    // --force replaces the key in .env.local; find the one it replaces first,
    // so it can be revoked once the new key is written.
    if (oldRaw) replaced = await findReplacedKey(session, env, oldRaw, out);
    const date = new Date().toISOString().slice(0, 10);
    keyScopes = (await wantsWorkspacesWrite(flags)) ? [...KEY_SCOPES, WORKSPACES_WRITE] : KEY_SCOPES;
    values.USERBOX_API_KEY = await createApiKey(session, env, `cli ${hostname()} ${date}`, keyScopes);
    keyCreated = true;
    out.step(`Created an API key with scopes ${keyScopes.join(", ")}`);
  } else if (flags.workspacesWrite) {
    out.warn(".env.local keeps its existing USERBOX_API_KEY, so --workspaces-write had no effect; run with --force for a new key.");
  }
  const merged = mergeEnv(existing, values, flags.force ? new Set(ENV_KEYS) : new Set());
  writeFileSync(envPath, merged.text, { mode: 0o600 });
  out.step(`.env.local: ${merged.added.length} added, ${merged.replaced.length} replaced, ${merged.kept.length} kept`);
  const replacedApiKey = replaced ? await settleReplacedKey(session, env, replaced, flags, out) : null;
  const ignored = ensureGitignored(root);
  if (ignored) out.step("Added .env.local to .gitignore");
  if (flags.env && !keyCreated) {
    out.warn(`.env.local keeps its existing USERBOX_API_KEY, which may belong to another environment; run with --force for a key in "${env.name}".`);
  }
  for (const key of merged.kept) {
    if (current.get(key) !== values[key] && key !== "USERBOX_API_KEY") {
      out.warn(`.env.local keeps a different ${key}; run with --force to replace it.`);
    }
  }

  let installed = false;
  if (!flags.skipInstall) {
    const [cmd, args] = installCommand(project.packageManager, SDKS);
    out.step(`Installing the SDKs: ${cmd} ${args.join(" ")}`);
    const res = spawnSync(cmd, args, {
      cwd: root,
      stdio: flags.json ? ["ignore", "ignore", "inherit"] : "inherit",
      shell: process.platform === "win32",
    });
    if (res.status !== 0) {
      throw new CliError("INSTALL_FAILED", `${cmd} exited with ${res.status ?? res.signal}`, `Run \`${cmd} ${args.join(" ")}\` yourself.`);
    }
    installed = true;
  }

  const files = scaffold(project);
  const envArg = flags.env ? ` --env ${flags.env}` : "";
  for (const f of files.written) out.step(`Wrote ${f}`);
  for (const t of files.todo) out.warn(t);

  out.done(
    {
      tenant: { id: session.tenantId, slug: session.tenantSlug },
      environment: { id: env.id, name: env.name, slug: env.slug ?? null, type: env.type },
      redirectDomain: host,
      redirectDomainEnvironment: { id: signInEnv.id, name: signInEnv.name, type: signInEnv.type },
      envFile: { path: ".env.local", added: merged.added, replaced: merged.replaced, kept: merged.kept },
      apiKeyCreated: keyCreated,
      apiKeyScopes: keyScopes,
      replacedApiKey,
      sdksInstalled: installed,
      files,
      next: flags.env
        ? [`userbox apply --env ${flags.env}`, `userbox dev seed --env ${flags.env}`, "userbox doctor"]
        : ["userbox apply", "userbox dev seed", "userbox doctor"],
    },
    [
      "",
      `Userbox is set up in environment ${env.name}. Next:`,
      `  1. Declare permissions and roles in userbox.yaml, then run \`userbox apply${envArg}\`.`,
      `  2. Run \`userbox dev seed${envArg}\` for a workspace where you are admin.`,
      "  3. Run `userbox doctor`, then start the app and sign in.",
      "Use verifyRequest() and can() from @userbox/node in your API routes (see https://docs.test.userbox.app/llms.txt).",
    ],
  );
}
