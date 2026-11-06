import type { Session } from "./api.js";
import { CliError } from "./output.js";

// Thin typed calls to the management API, as a tenant admin.

export interface Environment {
  id: string;
  name: string;
  slug?: string;
  type: "production" | "staging" | "development";
  isDefault: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string | null;
  status: string;
}

export interface Permission {
  id: string;
  key: string;
  type: "internal" | "external";
}

export interface AuthSettings {
  allowed_redirect_domains: string[] | null;
  allow_self_signup: boolean;
}

export async function listEnvironments(s: Session): Promise<Environment[]> {
  const { environments } = await s.request<{ environments: Environment[] }>("/v1/environments");
  return environments;
}

function describe(e: Environment): string {
  const tags = [e.type, ...(e.isDefault ? ["default"] : [])];
  return `${e.slug ?? e.name} (${tags.join(", ")})`;
}

/**
 * Picks the environment named by `--env`: matched against slug, name, then
 * type (a tenant has at most one environment per type), case-insensitively.
 * Without a name, the tenant's default environment.
 */
export function pickEnvironment(environments: Environment[], name?: string): Environment {
  if (name === undefined) {
    const env = environments.find((e) => e.isDefault);
    if (!env) throw new CliError("NO_DEFAULT_ENVIRONMENT", "the tenant has no default environment");
    return env;
  }
  const wanted = name.trim().toLowerCase();
  const env =
    environments.find((e) => e.slug?.toLowerCase() === wanted) ??
    environments.find((e) => e.name.toLowerCase() === wanted) ??
    environments.find((e) => e.type === wanted);
  if (env) return env;
  throw new CliError(
    "UNKNOWN_ENVIRONMENT",
    `no environment "${name}" in this tenant`,
    environments.length > 0
      ? `Available: ${environments.map(describe).join(", ")}. Omit --env for the default; create more in Console → Environments.`
      : "The tenant has no environments.",
    {
      environments: environments.map((e) => ({
        id: e.id,
        name: e.name,
        slug: e.slug ?? null,
        type: e.type,
        isDefault: e.isDefault,
      })),
    },
  );
}

/** The environment named by `--env`, or the tenant's default one. */
export async function resolveEnvironment(s: Session, name?: string): Promise<Environment> {
  return pickEnvironment(await listEnvironments(s), name);
}

export async function defaultEnvironment(s: Session): Promise<Environment> {
  return resolveEnvironment(s);
}

export function getAuthSettings(s: Session, env: Environment): Promise<AuthSettings> {
  return s.request<AuthSettings>(`/v1/environments/${env.id}/auth-settings`);
}

/** Adds `host` (a bare hostname such as `localhost`) to the allowed redirect domains. */
export async function ensureRedirectDomain(s: Session, env: Environment, host: string): Promise<boolean> {
  const settings = await getAuthSettings(s, env);
  const domains = settings.allowed_redirect_domains ?? [];
  if (domains.includes(host)) return false;
  await s.request(`/v1/environments/${env.id}/auth-settings`, {
    method: "PATCH",
    body: { allowed_redirect_domains: [...domains, host] },
  });
  return true;
}

export async function createApiKey(
  s: Session,
  env: Environment,
  name: string,
  scopes: string[],
): Promise<string> {
  const res = await s.request<{ key: string }>("/v1/api-keys", {
    method: "POST",
    envId: env.id,
    body: { name, scopes },
  });
  return res.key;
}

export async function listWorkspaces(s: Session, env: Environment): Promise<Workspace[]> {
  const res = await s.request<{ items: Workspace[] }>("/v1/workspaces?status=active&per_page=100", {
    envId: env.id,
  });
  return res.items;
}

export function createWorkspace(s: Session, env: Environment, name: string, slug: string): Promise<Workspace> {
  return s.request<Workspace>("/v1/workspaces", { method: "POST", envId: env.id, body: { name, slug } });
}

export async function listExternalPermissions(s: Session, env: Environment): Promise<Permission[]> {
  const all: Permission[] = [];
  let cursor: string | null = null;
  do {
    const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page: { items: Permission[]; next_cursor: string | null } = await s.request(
      `/v1/permissions?type=external&limit=200${q}`,
      { envId: env.id },
    );
    all.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return all;
}

export function createPermission(s: Session, env: Environment, key: string): Promise<Permission> {
  return s.request<Permission>("/v1/permissions", { method: "POST", envId: env.id, body: { key, name: key } });
}

export interface Membership {
  id: string;
  user_id: string | null;
  workspace_id: string;
  email: string | null;
  status: string;
}

export async function listMemberships(s: Session, workspaceId: string): Promise<Membership[]> {
  const res = await s.request<{ items: Membership[] }>(
    `/v1/memberships?workspace_id=${workspaceId}&per_page=100`,
  );
  return res.items;
}

export function inviteMember(s: Session, workspaceId: string, email: string): Promise<Membership> {
  return s.request<Membership>("/v1/memberships", { method: "POST", body: { email, workspace_id: workspaceId } });
}

/** Give a membership a catalogue role (`GET /v1/roles` id). Idempotent. */
export function assignRole(s: Session, membershipId: string, roleId: string): Promise<unknown> {
  return s.request(`/v1/memberships/${membershipId}/roles`, { method: "POST", body: { role_id: roleId } });
}

// The environment's role catalogue (`/v1/roles`). Roles are defined once per
// environment and assigned to memberships in any workspace.

export interface CatalogueRole {
  id: string;
  name: string;
  description: string | null;
  /** "console" (edited by hand) or "apply" (owned by userbox.yaml). */
  managed_by: string;
  /** "environment" for catalogue roles; older workspace roles report "workspace". */
  scope?: string;
}

export interface RoleGrant {
  permission_id: string;
  key: string;
  type: "internal" | "external";
  effect: string;
}

async function paginate<T>(s: Session, env: Environment, path: string): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  do {
    const q: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page: { items: T[]; next_cursor: string | null } = await s.request(`${path}?limit=200${q}`, {
      envId: env.id,
    });
    all.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return all;
}

export async function listCatalogueRoles(s: Session, env: Environment): Promise<CatalogueRole[]> {
  const roles = await paginate<CatalogueRole>(s, env, "/v1/roles");
  return roles.filter((r) => (r.scope ?? "environment") === "environment");
}

export function listRoleGrants(s: Session, env: Environment, roleId: string): Promise<RoleGrant[]> {
  return paginate<RoleGrant>(s, env, `/v1/roles/${roleId}/permissions`);
}

export function createCatalogueRole(s: Session, env: Environment, name: string): Promise<CatalogueRole> {
  return s.request<CatalogueRole>("/v1/roles", { method: "POST", envId: env.id, body: { name, managed_by: "apply" } });
}

/** Hand a role over to userbox.yaml (`managed_by: "apply"`) under the file's spelling of its name. */
export function updateCatalogueRole(s: Session, env: Environment, roleId: string, name: string): Promise<CatalogueRole> {
  return s.request<CatalogueRole>(`/v1/roles/${roleId}`, {
    method: "PATCH",
    envId: env.id,
    body: { name, managed_by: "apply" },
  });
}

export interface GrantsResult {
  added: string[];
  changed: string[];
  removed: string[];
}

/** Replace the role's grants with exactly `keys` (all `allow`). Unknown keys fail with 422 and change nothing. */
export function replaceRoleGrants(s: Session, env: Environment, roleId: string, keys: string[]): Promise<GrantsResult> {
  return s.request<GrantsResult>(`/v1/roles/${roleId}/permissions`, {
    method: "PUT",
    envId: env.id,
    body: { grants: keys.map((k) => ({ permission_key: k, effect: "allow" })), managed_by: "apply" },
  });
}
