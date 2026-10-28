import { createContext } from "react";
import type { PermissionCache, PermissionCacheEntry } from "../core/permission-cache";
import type { Session, SessionUser } from "../core/refresh-engine";
import type { UserboxError } from "../core/errors";

export type PublicSession = {
  user: SessionUser;
};

export type SessionResult =
  | { isLoaded: false; isSignedIn: false; user: null }
  | { isLoaded: true; isSignedIn: false; user: null }
  | { isLoaded: true; isSignedIn: true; user: SessionUser };

export type PermissionsResult = {
  permissions: ReadonlySet<string>;
  isLoaded: boolean;
  error: UserboxError | null;
};

export type PermissionResult = {
  allowed: boolean;
  isLoaded: boolean;
};

export type ProviderContextValue = {
  /** Snapshot of the session for `useSession`. */
  session: Session | null;
  isLoaded: boolean;
  /** Provider-internal permission cache. */
  permissionCache: PermissionCache;
  /** Fetch permissions for a workspace; safe to call from a hook effect. */
  ensurePermissions: (workspaceId: string) => void;
  /** Force the provider to re-read the permission cache (re-render subscribers). */
  permissionsVersion: number;
  /** Sign-in/sign-up/sign-out plumbing. */
  navigate: (url: string) => void;
  signOut: (redirectUri?: string) => Promise<void>;
  /** Tenant config (frozen). */
  config: ProviderConfigInternal;
  /** Refresh engine handle for internal hooks. */
  refreshEngine: import("../core/refresh-engine").RefreshEngine;
  /** Adopt a session from the callback flow. */
  adoptCallbackSession: (session: Session, rawRefreshToken: string | null) => void;
};

export type ProviderConfigInternal = Readonly<{
  tenantSlug: string;
  baseUrl: string;
  baseAuthUrl?: string;
  tokenStorage: "memory" | "cookie";
  refreshUrl: string;
  refreshThresholdPct: number;
  proactiveSkewMs: number;
  onSessionExpired?: () => void;
  onError?: (err: UserboxError) => void;
}>;

export const UserboxContext = createContext<ProviderContextValue | null>(null);

export type { Session, SessionUser, PermissionCacheEntry };
