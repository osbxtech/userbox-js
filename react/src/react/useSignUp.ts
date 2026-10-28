import { useCallback, useContext } from "react";
import { UserboxContext } from "./context";
import { assertValidReturnTo, buildAuthSurfaceUrl } from "../core/redirect";
import { issueNonce } from "../core/state-nonce";
import { misconfigured } from "../core/errors";
import type { SignInOptions } from "./useSignIn";

export function useSignUp(): { signUp: (opts?: SignInOptions) => void } {
  const ctx = useContext(UserboxContext);
  if (!ctx) {
    throw misconfigured(
      "tenantSlug",
      "useSignUp() must be called inside a <UserboxProvider>",
    );
  }

  const signUp = useCallback(
    (opts?: SignInOptions) => {
      const returnTo =
        opts?.returnTo ??
        (typeof window !== "undefined" ? window.location.href : "/");
      assertValidReturnTo(returnTo);
      const { flowId, nonce } = issueNonce();
      const url = buildAuthSurfaceUrl({
        tenantSlug: ctx.config.tenantSlug,
        baseUrl: ctx.config.baseUrl,
        baseAuthUrl: ctx.config.baseAuthUrl,
        path: "/signup",
        returnTo,
        state: nonce,
        flowId,
      });
      ctx.navigate(url);
    },
    [ctx],
  );

  return { signUp };
}
