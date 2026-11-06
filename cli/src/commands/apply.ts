import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Session } from "../api.js";
import type { Flags } from "../bin.js";
import { type Manifest, type Plan, parseManifest, planApply, planIsEmpty, planRevokes } from "../manifest.js";
import { CliError, type Output } from "../output.js";
import { confirm } from "../prompt.js";
import {
  type CatalogueRole,
  type Environment,
  createCatalogueRole,
  createPermission,
  listCatalogueRoles,
  listExternalPermissions,
  listRoleGrants,
  replaceRoleGrants,
  resolveEnvironment,
  updateCatalogueRole,
} from "../userbox.js";

// Permissions and roles both live in the environment: roles form one
// catalogue (`/v1/roles`) that every workspace uses. `apply` creates the
// missing permissions, then makes each role declared in userbox.yaml hold
// exactly its listed permissions. Roles that exist only in the console are
// reported and kept; `apply` never deletes a role.

export type Sync = Awaited<ReturnType<typeof syncManifest>>;

function isInteractive(flags: Flags): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.json;
}

/**
 * A plan that removes permissions from an existing role can lock real users
 * out, and coding agents skip the plan review (agent experiment, batch 4).
 * Such a plan always needs a human answer at a terminal: `--yes` does not
 * skip it, and without a terminal the command stops with NEEDS_HUMAN.
 */
export async function confirmRevokes(sync: Sync, flags: Flags, command: string): Promise<boolean> {
  if (!planRevokes(sync.plan)) return true;
  const lines = describe(sync).filter((l) => l.startsWith("  - "));
  if (!isInteractive(flags)) {
    throw new CliError(
      "NEEDS_HUMAN",
      `the plan removes permissions from existing roles:\n${lines.join("\n")}`,
      `Ask the human to review it and run \`npx @userbox/cli ${command}${flags.env ? ` --env ${flags.env}` : ""}\` in their own terminal.`,
    );
  }
  process.stdout.write(`This removes permissions from existing roles:\n${lines.join("\n")}\n`);
  return confirm("Remove them?");
}

export function loadManifest(root: string): Manifest {
  const path = join(root, "userbox.yaml");
  if (!existsSync(path)) {
    throw new CliError(
      "NO_MANIFEST",
      "no userbox.yaml in this directory",
      "Create one:\n  permissions: [projects.read, projects.delete]\n  roles:\n    admin: [projects.*]\n    member: [projects.read]",
    );
  }
  return parseManifest(readFileSync(path, "utf8"));
}

interface RemoteRole {
  role: CatalogueRole;
  /** External permission keys the role grants now. */
  external: string[];
  /** Internal (platform) permission keys: not in userbox.yaml, always kept. */
  internal: string[];
}

/** Role names are unique per environment, compared case-insensitively. */
const norm = (name: string) => name.toLowerCase();

export async function syncManifest(s: Session, env: Environment, manifest: Manifest) {
  const existing = await listExternalPermissions(s, env);
  const permissionIds = new Map(existing.map((p) => [p.key, p.id]));
  const catalogue = await listCatalogueRoles(s, env);
  const declared = new Map(Object.keys(manifest.roles).map((name) => [norm(name), name]));

  const remote = new Map<string, RemoteRole>();
  const remoteRoles: Record<string, string[]> = {};
  const consoleOnly: string[] = [];
  for (const role of catalogue) {
    const name = declared.get(norm(role.name));
    if (name === undefined) {
      consoleOnly.push(role.name);
      continue;
    }
    const grants = (await listRoleGrants(s, env, role.id)).filter((g) => g.effect === "allow");
    const entry = {
      role,
      external: grants.filter((g) => g.type === "external").map((g) => g.key),
      internal: grants.filter((g) => g.type === "internal").map((g) => g.key),
    };
    remote.set(name, entry);
    remoteRoles[name] = entry.external;
  }
  const plan: Plan = planApply(manifest, { permissions: [...permissionIds.keys()], roles: remoteRoles });
  plan.extraRoles = consoleOnly.sort();
  // Declared roles are owned by userbox.yaml: adopt console roles and match the file's spelling.
  const update = [...remote.entries()]
    .filter(([name, r]) => r.role.managed_by !== "apply" || r.role.name !== name)
    .map(([name]) => name)
    .sort();
  return { manifest, plan, remote, update, createdPermissions: plan.createPermissions };
}

export function syncIsEmpty(sync: Sync): boolean {
  return planIsEmpty(sync.plan) && sync.update.length === 0;
}

/** Role ids by userbox.yaml name, after `executeSync`. */
export async function executeSync(s: Session, env: Environment, sync: Sync): Promise<Map<string, string>> {
  // Permissions first: PUT /v1/roles/{id}/permissions rejects unknown keys.
  for (const key of sync.createdPermissions) await createPermission(s, env, key);
  const touched = new Set([...sync.plan.grant, ...sync.plan.revoke].map((g) => g.role));
  const ids = new Map<string, string>();
  for (const [name, wanted] of Object.entries(sync.manifest.roles)) {
    const remote = sync.remote.get(name);
    let id = remote?.role.id;
    if (id === undefined) id = (await createCatalogueRole(s, env, name)).id;
    else if (sync.update.includes(name)) await updateCatalogueRole(s, env, id, name);
    ids.set(name, id);
    if (touched.has(name) || (remote === undefined && wanted.length > 0)) {
      await replaceRoleGrants(s, env, id, [...wanted, ...(remote?.internal ?? [])]);
    }
  }
  return ids;
}

export function describe(sync: Sync): string[] {
  const lines: string[] = [];
  for (const p of sync.createdPermissions) lines.push(`  + permission ${p}`);
  for (const r of sync.plan.createRoles) lines.push(`  + role ${r}`);
  for (const name of sync.update) {
    const role = sync.remote.get(name)!.role;
    const changes = [
      ...(role.name !== name ? [`renamed from ${role.name}`] : []),
      ...(role.managed_by !== "apply" ? [`managed by userbox.yaml from now on (was ${role.managed_by})`] : []),
    ];
    lines.push(`  ~ role ${name}: ${changes.join("; ")}`);
  }
  for (const g of sync.plan.grant) lines.push(`  + ${g.role} → ${g.permission}`);
  for (const r of sync.plan.revoke) lines.push(`  - ${r.role} → ${r.permission}`);
  return lines;
}

/** Warnings about what `apply` leaves alone. */
export function keptWarnings(sync: Sync): string[] {
  const warnings: string[] = [];
  if (sync.plan.extraPermissions.length > 0) {
    warnings.push(`Not in userbox.yaml, left as they are: ${sync.plan.extraPermissions.join(", ")}`);
  }
  for (const r of sync.plan.extraRoles) warnings.push(`Role ${r} exists only in the console (kept)`);
  return warnings;
}

export async function apply(flags: Flags, out: Output): Promise<void> {
  const manifest = loadManifest(process.cwd());
  const session = Session.load();
  const env = await resolveEnvironment(session, flags.env);
  const sync = await syncManifest(session, env, manifest);
  const changes = describe(sync);
  for (const w of keptWarnings(sync)) out.warn(w);
  const summary = {
    environment: { id: env.id, name: env.name, slug: env.slug ?? null, type: env.type },
    changes,
    consoleOnlyRoles: sync.plan.extraRoles,
  };
  if (syncIsEmpty(sync)) {
    out.done({ ...summary, applied: false, upToDate: true }, ["Up to date: nothing to apply."]);
    return;
  }
  if (!flags.yes) {
    if (!isInteractive(flags)) {
      out.done({ ...summary, applied: false, hint: "Re-run with --yes to apply." }, [
        "Plan:",
        ...changes,
        "Re-run with --yes to apply.",
      ]);
      return;
    }
    process.stdout.write(`Plan for ${env.name}:\n${changes.join("\n")}\n`);
    if (!(await confirm("Apply these changes?"))) {
      out.done({ ...summary, applied: false }, ["Nothing applied."]);
      return;
    }
  } else if (!(await confirmRevokes(sync, flags, "apply"))) {
    out.done({ ...summary, applied: false }, ["Nothing applied."]);
    return;
  }
  await executeSync(session, env, sync);
  out.done({ ...summary, applied: true }, ["Applied:", ...changes]);
}
