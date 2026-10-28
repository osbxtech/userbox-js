import { usePermissions } from "./usePermissions";
import type { PermissionResult } from "./context";

/**
 * Returns whether the current user holds `permissionKey` in `workspaceId`,
 * as a synchronous derivation from `usePermissions`.
 *
 * IMPORTANT — UI HINTS ONLY: this result is for show/hide rendering decisions
 * only. The server must always enforce permissions on the request that
 * performs the operation. A frontend `allowed: true` does NOT authorize a
 * destructive action — that is the responsibility of the API the action
 * targets.
 */
export function usePermission(
  workspaceId: string,
  permissionKey: string,
): PermissionResult {
  const { permissions, isLoaded } = usePermissions(workspaceId);
  // Fail-closed: strict `boolean`, never `undefined`.
  const allowed: boolean = isLoaded ? permissions.has(permissionKey) : false;
  return { allowed, isLoaded };
}
