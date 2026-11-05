import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Session } from "../api.js";
import type { Flags } from "../bin.js";
import { type Manifest, type Plan, parseManifest, planApply, planIsEmpty, planRevokes } from "../manifest.js";
import { CliError, type Output } from "../output.js";
import { confirm } from "../prompt.js";
import {
  type Environment,
  type Workspace,
  createPermission,
  createRole,
  grantRolePermission,
  listExternalPermissions,
  listRolePermissions,
  listRoles,
  listWorkspaces,
  resolveEnvironment,
  revokeRolePermission,
} from "../userbox.js";

// Permissions live in the environment; roles live in each workspace. `apply`
// creates the permissions once and syncs the roles into every active
// workspace of the default environment (or the one named by `--env`).

type Sync = Awaited<ReturnType<typeof syncManifest>>;

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
  if (!sync.plans.some((p) => planRevokes(p.plan))) return true;
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

interface WorkspacePlan {
  workspace: Workspace;
  plan: Plan;
  roleIds: Map<string, string>;
}

async function workspacePlan(s: Session, env: Environment, manifest: Manifest, ws: Workspace, envPerms: string[]) {
  const roles = await listRoles(s, env, ws.id);
  const remoteRoles: Record<string, string[]> = {};
  const roleIds = new Map<string, string>();
  for (const role of roles) {
    roleIds.set(role.name, role.id);
    const perms = await listRolePermissions(s, env, ws.id, role.id);
    remoteRoles[role.name] = perms.filter((p) => p.type === "external").map((p) => p.key);
  }
  return { workspace: ws, plan: planApply(manifest, { permissions: envPerms, roles: remoteRoles }), roleIds };
}

/** Make the workspace's roles match the manifest. Permissions must already exist. */
export async function executeRoles(
  s: Session,
  env: Environment,
  wp: WorkspacePlan,
  permissionIds: Map<string, string>,
): Promise<void> {
  const ids = new Map(wp.roleIds);
  for (const name of wp.plan.createRoles) {
    ids.set(name, (await createRole(s, env, wp.workspace.id, name)).id);
  }
  for (const { role, permission } of wp.plan.grant) {
    await grantRolePermission(s, env, wp.workspace.id, ids.get(role)!, permissionIds.get(permission)!);
  }
  for (const { role, permission } of wp.plan.revoke) {
    const pid = permissionIds.get(permission);
    if (pid) await revokeRolePermission(s, env, wp.workspace.id, ids.get(role)!, pid);
  }
}

export async function syncManifest(
  s: Session,
  env: Environment,
  manifest: Manifest,
  workspaces: Workspace[],
): Promise<{ createdPermissions: string[]; plans: WorkspacePlan[]; permissionIds: Map<string, string> }> {
  const existing = await listExternalPermissions(s, env);
  const permissionIds = new Map(existing.map((p) => [p.key, p.id]));
  const plans: WorkspacePlan[] = [];
  for (const ws of workspaces) plans.push(await workspacePlan(s, env, manifest, ws, [...permissionIds.keys()]));
  return { createdPermissions: manifest.permissions.filter((p) => !permissionIds.has(p)), plans, permissionIds };
}

export async function executeSync(
  s: Session,
  env: Environment,
  sync: Awaited<ReturnType<typeof syncManifest>>,
): Promise<void> {
  for (const key of sync.createdPermissions) {
    sync.permissionIds.set(key, (await createPermission(s, env, key)).id);
  }
  for (const wp of sync.plans) await executeRoles(s, env, wp, sync.permissionIds);
}

function describe(sync: Sync): string[] {
  const lines: string[] = [];
  for (const p of sync.createdPermissions) lines.push(`  + permission ${p}`);
  for (const { workspace, plan } of sync.plans) {
    const label = workspace.slug ?? workspace.name;
    for (const r of plan.createRoles) lines.push(`  + role ${r} in ${label}`);
    for (const g of plan.grant) lines.push(`  + ${g.role} → ${g.permission} in ${label}`);
    for (const r of plan.revoke) lines.push(`  - ${r.role} → ${r.permission} in ${label}`);
  }
  return lines;
}

export async function apply(flags: Flags, out: Output): Promise<void> {
  const manifest = loadManifest(process.cwd());
  const session = Session.load();
  const env = await resolveEnvironment(session, flags.env);
  const workspaces = await listWorkspaces(session, env);
  if (workspaces.length === 0) {
    out.warn("No workspaces yet: roles are created per workspace. Run `userbox dev seed` to create one.");
  }
  const sync = await syncManifest(session, env, manifest, workspaces);
  const changes = describe(sync);
  const extras = new Set(sync.plans.flatMap((p) => p.plan.extraPermissions));
  if (extras.size > 0) out.warn(`Not in userbox.yaml, left as they are: ${[...extras].join(", ")}`);
  const empty = sync.createdPermissions.length === 0 && sync.plans.every((p) => planIsEmpty(p.plan));
  const summary = {
    environment: { id: env.id, name: env.name, slug: env.slug ?? null, type: env.type },
    workspaces: workspaces.map((w) => w.slug ?? w.id),
    changes,
  };
  if (empty) {
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
