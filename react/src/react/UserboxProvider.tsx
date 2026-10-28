import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as React from "react";
import { authFailed, misconfigured, type UserboxError } from "../core/errors";
import { PermissionCache } from "../core/permission-cache";
import { assertValidSlug } from "../core/redirect";
import { request } from "../core/http";
import {
  RefreshEngine,
  type Session,
  type SessionUser,
} from "../core/refresh-engine";
import { createSessionStore, type SessionStore } from "../core/session-store";
import {
  UserboxContext,
  type ProviderConfigInternal,
  type ProviderContextValue,
} from "./context";

export type UserboxProviderProps = {
  tenantSlug: string;
  baseUrl: string;
  baseAuthUrl?: string;
  tokenStorage: "cookie" | "memory";
  refreshUrl?: string;
  refreshThresholdPct?: number;
  proactiveSkewMs?: number;
  onSessionExpired?: () => void;
  onError?: (err: UserboxError) => void;
  children: React.ReactNode;
};

const DEFAULT_REFRESH_THRESHOLD_PCT = 0.2;
const DEFAULT_PROACTIVE_SKEW_MS = 5_000;

function validateConfig(props: UserboxProviderProps): ProviderConfigInternal {
  if (typeof props.tenantSlug !== "string" || props.tenantSlug.length === 0) {
    throw misconfigured("tenantSlug", "tenantSlug is required");
  }
  assertValidSlug(props.tenantSlug);
  if (typeof props.baseUrl !== "string" || props.baseUrl.length === 0) {
    throw misconfigured("baseUrl", "baseUrl is required");
  }
  if (props.baseUrl.endsWith("/")) {
    throw misconfigured("baseUrl", "baseUrl must not have a trailing slash");
  }
  if (props.tokenStorage !== "memory" && props.tokenStorage !== "cookie") {
    throw misconfigured("tokenStorage", "tokenStorage must be 'memory' or 'cookie'");
  }
  const refreshUrl =
    props.refreshUrl ??
    (props.tokenStorage === "cookie"
      ? "/api/auth/refresh"
      : `${props.baseUrl}/v1/auth/refresh`);
  const config: ProviderConfigInternal = Object.freeze({
    tenantSlug: props.tenantSlug,
    baseUrl: props.baseUrl,
    baseAuthUrl: props.baseAuthUrl,
    tokenStorage: props.tokenStorage,
    refreshUrl,
    refreshThresholdPct: props.refreshThresholdPct ?? DEFAULT_REFRESH_THRESHOLD_PCT,
    proactiveSkewMs: props.proactiveSkewMs ?? DEFAULT_PROACTIVE_SKEW_MS,
    onSessionExpired: props.onSessionExpired,
    onError: props.onError,
  });
  return config;
}

type ProviderInternalState = {
  session: Session | null;
  isLoaded: boolean;
  permissionsVersion: number;
};

export const UserboxProvider: React.FC<UserboxProviderProps> = (props) => {
  // Forbid nested mounts.
  const parent = React.useContext(UserboxContext);
  if (parent) {
    throw misconfigured("tenantSlug", "UserboxProvider cannot be nested");
  }

  const config = useMemo(() => validateConfig(props), [
    props.tenantSlug,
    props.baseUrl,
    props.baseAuthUrl,
    props.tokenStorage,
    props.refreshUrl,
    props.refreshThresholdPct,
    props.proactiveSkewMs,
  ]);

  const [state, setState] = useState<ProviderInternalState>({
    session: null,
    isLoaded: false,
    permissionsVersion: 0,
  });
  const cacheRef = useRef<PermissionCache>(new PermissionCache());
  const sessionStoreRef = useRef<SessionStore | null>(null);
  const engineRef = useRef<RefreshEngine | null>(null);
  const userMeFetchedRef = useRef<string | null>(null);

  if (!sessionStoreRef.current) {
    sessionStoreRef.current = createSessionStore(config.tokenStorage);
  }

  // Build the refresh engine exactly once per provider mount.
  if (!engineRef.current) {
    engineRef.current = new RefreshEngine({
      tenantSlug: config.tenantSlug,
      baseUrl: config.baseUrl,
      refreshUrl: config.refreshUrl,
      tokenStorage: config.tokenStorage,
      sessionStore: sessionStoreRef.current,
      refreshThresholdPct: config.refreshThresholdPct,
      proactiveSkewMs: config.proactiveSkewMs,
      onSession: (session) => {
        setState((s) => ({ ...s, session, isLoaded: true }));
      },
      onSessionExpired: () => {
        cacheRef.current.clear();
        setState((s) => ({
          session: null,
          isLoaded: true,
          permissionsVersion: s.permissionsVersion + 1,
        }));
        config.onSessionExpired?.();
      },
      onError: (err) => {
        config.onError?.(err);
      },
      broadcastChannelName: config.tenantSlug,
    });
  }

  // Bootstrap on mount.
  useEffect(() => {
    const engine = engineRef.current!;
    let cancelled = false;
    void (async () => {
      const result = await engine.refresh();
      if (cancelled) return;
      if (result.kind !== "ok") {
        setState((s) => ({ ...s, session: null, isLoaded: true }));
      }
    })();
    return () => {
      cancelled = true;
      engine.dispose();
    };

  }, []);

  // Lazy GET /v1/users/me to populate email + fullName.
  useEffect(() => {
    const session = state.session;
    if (!session) return;
    if (userMeFetchedRef.current === session.user.id && session.user.email !== null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await request<{
        id?: unknown;
        email?: unknown;
        full_name?: unknown;
      }>({
        url: `${config.baseUrl}/v1/users/me`,
        tenantSlug: config.tenantSlug,
        accessToken: session.accessToken,
        errorKind: "auth",
      });
      if (cancelled) return;
      if (!res.ok) {
        // Fire-and-forget: leave email/fullName null; retry next refresh tick.
        return;
      }
      const data = res.data;
      const email = typeof data?.email === "string" ? data.email : null;
      const fullName = typeof data?.full_name === "string" ? data.full_name : null;
      userMeFetchedRef.current = session.user.id;
      setState((s) => {
        if (!s.session || s.session.user.id !== session.user.id) return s;
        const next: Session = {
          ...s.session,
          user: { ...s.session.user, email, fullName },
        };
        return { ...s, session: next };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [state.session, config.baseUrl, config.tenantSlug]);

  const ensurePermissions = useCallback(
    (workspaceId: string) => {
      const cache = cacheRef.current;
      if (cache.has(workspaceId)) return;
      const engine = engineRef.current!;
      const session = engine.getSession();
      if (!session) return;
      const url = `${config.baseUrl}/v1/access/permissions?user_id=${encodeURIComponent(
        session.user.id,
      )}&workspace_id=${encodeURIComponent(workspaceId)}`;
      const promise = (async () => {
        const res = await request<{ permissions?: unknown }>({
          url,
          tenantSlug: config.tenantSlug,
          accessToken: session.accessToken,
          errorKind: "permissions",
          workspaceId,
        });
        if (!res.ok) {
          cache.setError(workspaceId, res.error);
          config.onError?.(res.error);
          setState((s) => ({ ...s, permissionsVersion: s.permissionsVersion + 1 }));
          return new Set<string>();
        }
        const list = Array.isArray(res.data?.permissions)
          ? (res.data!.permissions as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : [];
        cache.setLoaded(workspaceId, list);
        setState((s) => ({ ...s, permissionsVersion: s.permissionsVersion + 1 }));
        return new Set(list);
      })();
      cache.setLoading(workspaceId, promise);
    },
    [config.baseUrl, config.tenantSlug],
  );

  const adoptCallbackSession = useCallback(
    (session: Session, rawRefreshToken: string | null) => {
      const engine = engineRef.current!;
      if (config.tokenStorage === "memory" && rawRefreshToken) {
        sessionStoreRef.current?.setRefreshToken(rawRefreshToken);
      }
      engine.primeSession(session);
      setState((s) => ({ ...s, session, isLoaded: true }));
    },
    [config.tokenStorage],
  );

  const navigate = useCallback((url: string) => {
    if (typeof window !== "undefined") {
      window.location.href = url;
    }
  }, []);

  const signOut = useCallback(
    async (redirectUri?: string) => {
      const engine = engineRef.current!;
      const session = engine.getSession();
      const refreshToken =
        config.tokenStorage === "memory"
          ? sessionStoreRef.current?.getRefreshToken() ?? null
          : null;
      // Step 1: clear in-memory state immediately.
      sessionStoreRef.current?.setRefreshToken(null);
      cacheRef.current.clear();
      setState((s) => ({
        session: null,
        isLoaded: true,
        permissionsVersion: s.permissionsVersion + 1,
      }));

      // Step 2 (memory mode): server-side revoke (best effort). In cookie
      // mode the refresh token lives in the tenant backend's httpOnly cookie,
      // so the SDK cannot send it; the backend revokes in step 3 instead.
      if (config.tokenStorage === "memory") try {
        const body = { refresh_token: refreshToken ?? "" };
        const res = await request<unknown>({
          url: `${config.baseUrl}/v1/auth/logout`,
          method: "POST",
          tenantSlug: config.tenantSlug,
          accessToken: session?.accessToken ?? null,
          body,
          credentials: "same-origin",
          errorKind: "auth",
        });
        if (!res.ok) {
          const err = res.error;
          if (
            !(err.kind === "auth_failed" && err.code === "INVALID_REFRESH_TOKEN")
          ) {
            config.onError?.(err);
          }
        }
      } catch (err) {
        config.onError?.(authFailed("logout failed", 0, "LOGOUT_FAILED"));
        void err;
      }

      // Step 3 (cookie mode): ask the tenant backend to revoke the platform
      // session (it holds the refresh token) and clear its cookie. The access
      // token goes along because platform logout requires it.
      if (config.tokenStorage === "cookie") {
        try {
          await request<unknown>({
            url: config.refreshUrl,
            method: "POST",
            tenantSlug: config.tenantSlug,
            accessToken: session?.accessToken ?? null,
            body: { action: "logout" },
            credentials: "include",
            errorKind: "auth",
          });
        } catch {
          // ignore
        }
      }

      // Step 5: navigate.
      navigate(redirectUri ?? (typeof window !== "undefined" ? window.location.origin : "/"));
    },
    [config, navigate],
  );

  const contextValue: ProviderContextValue = useMemo(
    () => ({
      session: state.session,
      isLoaded: state.isLoaded,
      permissionCache: cacheRef.current,
      ensurePermissions,
      permissionsVersion: state.permissionsVersion,
      navigate,
      signOut,
      config,
      refreshEngine: engineRef.current!,
      adoptCallbackSession,
    }),
    [
      state.session,
      state.isLoaded,
      state.permissionsVersion,
      ensurePermissions,
      navigate,
      signOut,
      config,
      adoptCallbackSession,
    ],
  );

  // Re-export user type for downstream consumers
  void ({} as SessionUser);

  return (
    <UserboxContext.Provider value={contextValue}>
      {props.children}
    </UserboxContext.Provider>
  );
};
