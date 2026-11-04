import { parse } from "yaml";

import { CliError } from "./output.js";

// userbox.yaml: permissions and roles as code.
//
//   permissions: [projects.read, projects.create, projects.delete]
//   roles:
//     admin:  [projects.*]
//     member: [projects.read, projects.create]
//
// A role entry ending in `.*` expands to every declared permission with that
// prefix. `apply` makes each declared role hold exactly its listed
// permissions; permissions and roles that exist only in the environment are
// reported, never deleted.

export interface Manifest {
  permissions: string[];
  roles: Record<string, string[]>;
}

// Same rule as the API: 2 to 5 lowercase segments separated by dots.
const PERMISSION_KEY = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){1,4}$/;

export function parseManifest(text: string): Manifest {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw new CliError("MANIFEST_INVALID", `userbox.yaml is not valid YAML: ${(err as Error).message}`);
  }
  const doc = (raw ?? {}) as { permissions?: unknown; roles?: unknown };
  const permissions = doc.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== "string")) {
    throw new CliError("MANIFEST_INVALID", "`permissions` must be a list of strings");
  }
  for (const p of permissions as string[]) {
    if (!PERMISSION_KEY.test(p)) {
      throw new CliError(
        "MANIFEST_INVALID",
        `invalid permission key "${p}"`,
        "Use 2 to 5 lowercase segments separated by dots, for example projects.delete.",
      );
    }
  }
  const rolesRaw = doc.roles ?? {};
  if (typeof rolesRaw !== "object" || Array.isArray(rolesRaw)) {
    throw new CliError("MANIFEST_INVALID", "`roles` must map role names to lists of permissions");
  }
  const declared = new Set(permissions as string[]);
  const roles: Record<string, string[]> = {};
  for (const [name, list] of Object.entries(rolesRaw as Record<string, unknown>)) {
    if (!Array.isArray(list) || list.some((p) => typeof p !== "string")) {
      throw new CliError("MANIFEST_INVALID", `role "${name}" must be a list of permission keys`);
    }
    const expanded = new Set<string>();
    for (const entry of list as string[]) {
      if (entry.endsWith(".*")) {
        const prefix = entry.slice(0, -1);
        const matches = [...declared].filter((p) => p.startsWith(prefix));
        if (matches.length === 0) {
          throw new CliError("MANIFEST_INVALID", `role "${name}": "${entry}" matches no declared permission`);
        }
        matches.forEach((m) => expanded.add(m));
      } else if (!declared.has(entry)) {
        throw new CliError(
          "MANIFEST_INVALID",
          `role "${name}" uses "${entry}", which is not under \`permissions\``,
        );
      } else {
        expanded.add(entry);
      }
    }
    roles[name] = [...expanded].sort();
  }
  return { permissions: [...declared].sort(), roles };
}

export interface RemoteState {
  permissions: string[];
  /** Role name → permission keys it holds now. */
  roles: Record<string, string[]>;
}

export interface Plan {
  createPermissions: string[];
  createRoles: string[];
  grant: { role: string; permission: string }[];
  revoke: { role: string; permission: string }[];
  /** Exist in the environment but not in the file. Reported only. */
  extraPermissions: string[];
  extraRoles: string[];
}

export function planApply(manifest: Manifest, remote: RemoteState): Plan {
  const remotePerms = new Set(remote.permissions);
  const plan: Plan = {
    createPermissions: manifest.permissions.filter((p) => !remotePerms.has(p)),
    createRoles: Object.keys(manifest.roles).filter((r) => !(r in remote.roles)).sort(),
    grant: [],
    revoke: [],
    extraPermissions: remote.permissions.filter((p) => !manifest.permissions.includes(p)).sort(),
    extraRoles: Object.keys(remote.roles).filter((r) => !(r in manifest.roles)).sort(),
  };
  for (const [role, wanted] of Object.entries(manifest.roles)) {
    const have = new Set(remote.roles[role] ?? []);
    for (const p of wanted) if (!have.has(p)) plan.grant.push({ role, permission: p });
    for (const p of have) if (!wanted.includes(p)) plan.revoke.push({ role, permission: p });
  }
  return plan;
}

export function planIsEmpty(plan: Plan): boolean {
  return (
    plan.createPermissions.length === 0 &&
    plan.createRoles.length === 0 &&
    plan.grant.length === 0 &&
    plan.revoke.length === 0
  );
}
