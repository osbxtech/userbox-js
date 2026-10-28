// Public surface for `@userbox/react` (React entry point).
// Per contracts §6, this entry-point does NOT expose `accessToken` in any
// exported type: `Session` is internal-only, `ServerSession` is Next.js-only,
// and `PublicSession` is the safe shape for cross-component passing.

export { UserboxProvider, type UserboxProviderProps } from "./react/UserboxProvider";
export { useSession } from "./react/useSession";
export { useAccessToken } from "./react/useAccessToken";
export { usePermissions } from "./react/usePermissions";
export { usePermission } from "./react/usePermission";
export { useSignIn, type SignInOptions } from "./react/useSignIn";
export { useSignUp } from "./react/useSignUp";
export { useSignOut, type SignOutOptions } from "./react/useSignOut";
export { UserboxCallback, type UserboxCallbackProps } from "./react/UserboxCallback";
export { isUserboxError } from "./core/errors";
export type { UserboxError } from "./core/errors";
export type {
  PublicSession,
  SessionUser,
  SessionResult,
  PermissionsResult,
  PermissionResult,
} from "./react/context";
