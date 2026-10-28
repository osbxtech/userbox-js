import { useContext, useEffect, useRef } from "react";
import * as React from "react";
import { UserboxContext, type PublicSession } from "./context";
import { authFailed, missingCredentials, type UserboxError } from "../core/errors";
import { decodeJwtClaims } from "../core/token";
import { consumeNonce } from "../core/state-nonce";
import { request } from "../core/http";
import type { Session } from "../core/refresh-engine";

export type UserboxCallbackProps = {
  onSuccess?: (session: PublicSession) => void;
  onError?: (err: UserboxError) => void;
};

function parseHash(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return out;
  for (const piece of raw.split("&")) {
    const [k, v] = piece.split("=");
    if (!k) continue;
    out[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
  }
  return out;
}

export const UserboxCallback: React.FC<UserboxCallbackProps> = ({
  onSuccess,
  onError,
}) => {
  const ctx = useContext(UserboxContext);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!ctx) return;
    if (typeof window === "undefined") return;

    const hash = window.location.hash;
    const params = parseHash(hash);

    if (!hash || Object.keys(params).length === 0) {
      // Spec edge case: re-mount with no fragment → silent no-op.
      return;
    }

    // Strip the fragment BEFORE invoking onSuccess so the next render sees a
    // clean URL.
    const stripFragment = (): void => {
      const { pathname, search } = window.location;
      try {
        window.history.replaceState(null, "", pathname + search);
      } catch {
        // ignore
      }
    };

    if (params.error) {
      stripFragment();
      const err = authFailed(
        params.error_description || params.error,
        400,
        params.error,
      );
      onError?.(err);
      return;
    }

    const accessToken = params.access_token;
    const refreshToken = params.refresh_token;
    const expiresIn = Number.parseInt(params.expires_in ?? "0", 10);
    const refreshExpiresIn = Number.parseInt(
      params.refresh_expires_in ?? params.expires_in ?? "0",
      10,
    );
    const state = params.state;
    const flowId = params.flow_id;

    if (!accessToken || !refreshToken || !expiresIn) {
      onError?.(missingCredentials("Callback URL missing access_token / refresh_token / expires_in"));
      return;
    }

    if (!flowId || !state) {
      stripFragment();
      onError?.(authFailed("Callback URL missing state/flow_id", 400, "STATE_MISSING"));
      return;
    }

    const expectedNonce = consumeNonce(flowId);
    if (expectedNonce === null || expectedNonce !== state) {
      stripFragment();
      onError?.(authFailed("Callback state mismatch — possible CSRF", 400, "STATE_MISMATCH"));
      return;
    }

    let claims;
    try {
      claims = decodeJwtClaims(accessToken);
    } catch (e) {
      stripFragment();
      onError?.(e as UserboxError);
      return;
    }

    const session: Session = {
      accessToken,
      accessTokenExpiresAt: Date.now() + expiresIn * 1000,
      refreshExpiresAt: Date.now() + refreshExpiresIn * 1000,
      user: {
        id: claims.sub,
        tenantId: claims.tid,
        email: null,
        fullName: null,
      },
    };

    // For cookie storage: hand the refresh token to the tenant backend to set
    // the httpOnly cookie. Fire-and-forget; failure surfaces via onError.
    if (ctx.config.tokenStorage === "cookie") {
      void (async () => {
        const res = await request<unknown>({
          url: ctx.config.refreshUrl,
          method: "POST",
          tenantSlug: ctx.config.tenantSlug,
          body: { action: "init", refresh_token: refreshToken },
          credentials: "include",
          errorKind: "auth",
        });
        if (!res.ok) onError?.(res.error);
      })();
    }

    ctx.adoptCallbackSession(session, refreshToken);
    stripFragment();
    onSuccess?.({ user: session.user });
  }, [ctx, onError, onSuccess]);

  return null;
};
