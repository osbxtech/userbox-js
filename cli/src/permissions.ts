// Console (internal, `userbox.*`) permissions the CLI's calls need. They are
// granted directly to a user in Console → Users → Edit; the API checks each
// one per route and answers 403 INSUFFICIENT_PERMISSION without it.

export const CONSOLE_ACCESS = "userbox.console.access";
export const TENANT_MANAGE = "userbox.tenant.manage";
export const API_KEYS_MANAGE = "userbox.api_keys.manage";

/** What each permission is for, in the words a missing-permission message uses. */
const PURPOSES: Record<string, string> = {
  [CONSOLE_ACCESS]: "read an environment's sign-in settings (allowed redirect domains)",
  [TENANT_MANAGE]: "change environments and their sign-in settings (allowed redirect domains)",
  "userbox.api_keys.read": "list API keys",
  [API_KEYS_MANAGE]: "create and revoke API keys",
  "userbox.workspace.create": "create workspaces",
};

export const GRANT_HINT = "ask a tenant owner to tick it in Console → Users → Edit";

export interface MissingPermission {
  key: string;
  purpose: string;
}

export function permissionPurpose(key: string): string | null {
  return PURPOSES[key] ?? null;
}

/** The permission a 403 names (`User lacks required permission: <key>`), if any. */
export function permissionFromError(message: string): string | null {
  return /required permission:\s*(userbox\.[a-z0-9_.]*[a-z0-9_])/i.exec(message)?.[1] ?? null;
}
