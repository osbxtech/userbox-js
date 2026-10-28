import { useContext } from "react";
import { UserboxContext, type SessionResult } from "./context";
import { misconfigured } from "../core/errors";

/**
 * Returns the session state as a discriminated union. Never throws.
 *
 * Must be called inside a `<UserboxProvider>`. Throws if used outside one
 * (misconfigured error) — that throw is a developer-time signal, not a runtime
 * error to handle in production code.
 */
export function useSession(): SessionResult {
  const ctx = useContext(UserboxContext);
  if (!ctx) {
    throw misconfigured(
      "tenantSlug",
      "useSession() must be called inside a <UserboxProvider>",
    );
  }
  if (!ctx.isLoaded) {
    return { isLoaded: false, isSignedIn: false, user: null };
  }
  if (!ctx.session) {
    return { isLoaded: true, isSignedIn: false, user: null };
  }
  return { isLoaded: true, isSignedIn: true, user: ctx.session.user };
}
