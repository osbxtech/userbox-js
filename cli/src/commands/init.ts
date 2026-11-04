import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { Session } from "../api.js";
import type { Flags } from "../bin.js";
import { ENV_KEYS, mergeEnv, parseEnv } from "../envfile.js";
import { CliError, type Output } from "../output.js";
import { detectNextProject, installCommand } from "../project.js";
import { scaffold } from "../scaffold.js";
import { createApiKey, defaultEnvironment, ensureRedirectDomain } from "../userbox.js";

export const KEY_SCOPES = ["access:check", "memberships:read", "workspaces:read"];
const SDKS = ["@userbox/react@alpha", "@userbox/node@alpha"];

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

  const env = await defaultEnvironment(session);
  out.step(`Tenant ${session.tenantSlug}, environment ${env.name} (${env.type})`);
  if (env.type === "production") out.warn("The default environment is production; the key created here is a production key.");

  if (await ensureRedirectDomain(session, env, host)) out.step(`Added ${host} to the allowed redirect domains`);
  else out.step(`${host} is already an allowed redirect domain`);

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
  if (flags.force || !current.get("USERBOX_API_KEY")) {
    const date = new Date().toISOString().slice(0, 10);
    values.USERBOX_API_KEY = await createApiKey(session, env, `cli ${hostname()} ${date}`, KEY_SCOPES);
    keyCreated = true;
    out.step(`Created an API key with scopes ${KEY_SCOPES.join(", ")}`);
  }
  const merged = mergeEnv(existing, values, flags.force ? new Set(ENV_KEYS) : new Set());
  writeFileSync(envPath, merged.text, { mode: 0o600 });
  out.step(`.env.local: ${merged.added.length} added, ${merged.replaced.length} replaced, ${merged.kept.length} kept`);
  const ignored = ensureGitignored(root);
  if (ignored) out.step("Added .env.local to .gitignore");
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
  for (const f of files.written) out.step(`Wrote ${f}`);
  for (const t of files.todo) out.warn(t);

  out.done(
    {
      tenant: { id: session.tenantId, slug: session.tenantSlug },
      environment: { id: env.id, name: env.name, type: env.type },
      redirectDomain: host,
      envFile: { path: ".env.local", added: merged.added, replaced: merged.replaced, kept: merged.kept },
      apiKeyCreated: keyCreated,
      sdksInstalled: installed,
      files,
      next: ["userbox apply", "userbox dev seed", "userbox doctor"],
    },
    [
      "",
      "Userbox is set up. Next:",
      "  1. Declare permissions and roles in userbox.yaml, then run `userbox apply`.",
      "  2. Run `userbox dev seed` for a workspace where you are admin.",
      "  3. Run `userbox doctor`, then start the app and sign in.",
      "Use verifyRequest() and can() from @userbox/node in your API routes (see https://docs.test.userbox.app/llms.txt).",
    ],
  );
}
