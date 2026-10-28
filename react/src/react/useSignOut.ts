import { useCallback, useContext } from "react";
import { UserboxContext } from "./context";
import { misconfigured } from "../core/errors";

export type SignOutOptions = {
  redirectUri?: string;
};

export function useSignOut(): { signOut: (opts?: SignOutOptions) => Promise<void> } {
  const ctx = useContext(UserboxContext);
  if (!ctx) {
    throw misconfigured(
      "tenantSlug",
      "useSignOut() must be called inside a <UserboxProvider>",
    );
  }
  const signOut = useCallback(
    async (opts?: SignOutOptions) => {
      await ctx.signOut(opts?.redirectUri);
    },
    [ctx],
  );
  return { signOut };
}
