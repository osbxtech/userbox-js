import { useContext, useEffect, useMemo } from "react";
import { UserboxContext, type PermissionsResult } from "./context";
import { misconfigured } from "../core/errors";

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Returns the cached permission set for `workspaceId`. Issues at most one
 * outbound `GET /v1/access/permissions` per workspace (cached for the
 * lifetime of the provider).
 *
 * IMPORTANT — UI HINTS ONLY: the returned set is for show/hide rendering only.
 * The server enforces permissions on every request that performs an action.
 */
export function usePermissions(workspaceId: string): PermissionsResult {
  const ctx = useContext(UserboxContext);
  if (!ctx) {
    throw misconfigured(
      "tenantSlug",
      "usePermissions() must be called inside a <UserboxProvider>",
    );
  }

  useEffect(() => {
    if (!workspaceId) return;
    if (!ctx.session) return;
    ctx.ensurePermissions(workspaceId);
  }, [workspaceId, ctx.session, ctx]);

  return useMemo(() => {
    if (!workspaceId) {
      return { permissions: EMPTY_SET, isLoaded: false, error: null };
    }
    const entry = ctx.permissionCache.get(workspaceId);
    if (!entry) {
      return { permissions: EMPTY_SET, isLoaded: false, error: null };
    }
    if (entry.state === "loaded") {
      return { permissions: entry.permissions, isLoaded: true, error: null };
    }
    if (entry.state === "error") {
      return {
        permissions: entry.lastGood ?? EMPTY_SET,
        isLoaded: true,
        error: entry.error,
      };
    }
    return { permissions: EMPTY_SET, isLoaded: false, error: null };
    // Depend on permissionsVersion so consumers re-render when the cache
    // mutates (the cache itself is mutable, so React can't see it directly).
  }, [workspaceId, ctx.permissionCache, ctx.permissionsVersion]);
}
