import { useContext } from "react";
import { UserboxContext } from "./context";
import { misconfigured } from "../core/errors";

/**
 * Returns the current access token (or `null` when not signed in).
 *
 * Use this to authenticate calls from tenant frontend code to the tenant's
 * own backend (which validates the token via the Python SDK's `require_auth`
 * dependency or equivalent). The value comes from the in-memory session
 * managed by `<UserboxProvider>` — same source as the `Authorization`
 * header used internally by `useSignOut()` / refresh / `usePermissions`.
 *
 * Security note: the access token has the same exposure surface as any
 * JavaScript variable in the page. If your threat model requires the token
 * never to be reachable from user code, use a backend-cookie strategy
 * (`tokenStorage="cookie"` + a refresh proxy) instead.
 */
export function useAccessToken(): string | null {
  const ctx = useContext(UserboxContext);
  if (!ctx) {
    throw misconfigured(
      "tenantSlug",
      "useAccessToken() must be called inside a <UserboxProvider>",
    );
  }
  return ctx.session?.accessToken ?? null;
}
