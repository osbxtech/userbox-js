import type { Session } from "./api.js";
import { CliError } from "./output.js";

// Thin typed calls to the management API, as a tenant admin.

export interface Environment {
  id: string;
  name: string;
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

export interface Role {
  id: string;
  name: string;
}

export interface AuthSettings {
  allowed_redirect_domains: string[] | null;
  allow_self_signup: boolean;
}

export async function defaultEnvironment(s: Session): Promise<Environment> {
  const { environments } = await s.request<{ environments: Environment[] }>("/v1/environments");
  const env = environments.find((e) => e.isDefault);
  if (!env) throw new CliError("NO_DEFAULT_ENVIRONMENT", "the tenant has no default environment");
  return env;
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

export async function listRoles(s: Session, env: Environment, workspaceId: string): Promise<Role[]> {
  const res = await s.request<{ items: Role[] }>(`/v1/workspaces/${workspaceId}/roles?limit=200`, {
    envId: env.id,
  });
  return res.items;
}

export function createRole(s: Session, env: Environment, workspaceId: string, name: string): Promise<Role> {
  return s.request<Role>(`/v1/workspaces/${workspaceId}/roles`, { method: "POST", envId: env.id, body: { name } });
}

export interface RolePermission {
  permission_id: string;
  key: string;
  type: "internal" | "external";
}

export async function listRolePermissions(
  s: Session,
  env: Environment,
  workspaceId: string,
  roleId: string,
): Promise<RolePermission[]> {
  const res = await s.request<{ items: RolePermission[] }>(
    `/v1/workspaces/${workspaceId}/roles/${roleId}/permissions?limit=200`,
    { envId: env.id },
  );
  return res.items;
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

export function assignRole(s: Session, membershipId: string, roleId: string): Promise<unknown> {
  return s.request(`/v1/memberships/${membershipId}/roles`, { method: "POST", body: { role_id: roleId } });
}
export function grantRolePermission(
  s: Session,
  env: Environment,
  workspaceId: string,
  roleId: string,
  permissionId: string,
): Promise<unknown> {
  return s.request(`/v1/workspaces/${workspaceId}/roles/${roleId}/permissions`, {
    method: "POST",
    envId: env.id,
    body: { permission_id: permissionId, effect: "allow" },
  });
}

export function revokeRolePermission(
  s: Session,
  env: Environment,
  workspaceId: string,
  roleId: string,
  permissionId: string,
): Promise<unknown> {
  return s.request(`/v1/workspaces/${workspaceId}/roles/${roleId}/permissions/${permissionId}`, {
    method: "DELETE",
    envId: env.id,
  });
}
