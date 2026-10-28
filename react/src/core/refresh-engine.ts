import { authFailed, type UserboxError } from "./errors";
import { request } from "./http";
import { decodeJwtClaims, type JwtClaims } from "./token";
import type { SessionStore, TokenStorage } from "./session-store";

export type SessionUser = {
  id: string;
  tenantId: string;
  email: string | null;
  fullName: string | null;
};

export type Session = {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshExpiresAt: number;
  user: SessionUser;
};

export type RefreshSuccess = {
  kind: "ok";
  session: Session;
  rawRefreshToken: string | null;
  nextRefreshIn: number;
};

export type RefreshPermanent = {
  kind: "permanent_fail";
  error: UserboxError;
};

export type RefreshTransient = {
  kind: "transient_fail";
  error: UserboxError;
  retryInMs: number;
};

export type RefreshResult = RefreshSuccess | RefreshPermanent | RefreshTransient;

export type RefreshEngineOptions = {
  tenantSlug: string;
  baseUrl: string;
  refreshUrl: string;
  tokenStorage: TokenStorage;
  sessionStore: SessionStore;
  refreshThresholdPct: number; // 0..1 — refresh when this fraction of TTL is REMAINING
  proactiveSkewMs: number;
  onSession: (session: Session) => void;
  onSessionExpired: () => void;
  onError: (err: UserboxError) => void;
  /**
   * BroadcastChannel name suffix (typically tenant slug). When provided and
   * `BroadcastChannel` is available, refresh requests are coordinated across
   * tabs so that only one tab issues the outbound HTTP call.
   */
  broadcastChannelName?: string;
  /** Test hooks. */
  now?: () => number;
};

type RefreshHttpResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
};

const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];
const PERMANENT_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 401, 403]);
const CLAIM_WINDOW_MS = 200;

export class RefreshEngine {
  private readonly options: RefreshEngineOptions;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<RefreshResult> | null = null;
  private failureCount = 0;
  private permanentlyFailed = false;
  private sessionExpiredFired = false;
  private channel: BroadcastChannel | null = null;
  private currentSession: Session | null = null;

  constructor(options: RefreshEngineOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.setupChannel();
  }

  private setupChannel(): void {
    if (!this.options.broadcastChannelName) return;
    if (typeof BroadcastChannel === "undefined") return;
    try {
      this.channel = new BroadcastChannel(
        `userbox-refresh-${this.options.broadcastChannelName}`,
      );
      this.channel.addEventListener("message", (evt: MessageEvent) => {
        this.handleBroadcast(evt.data);
      });
    } catch {
      this.channel = null;
    }
  }

  private handleBroadcast(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as { type?: unknown; session?: unknown };
    if (msg.type !== "session" || typeof msg.session !== "object" || msg.session === null) return;
    const session = msg.session as Partial<Session>;
    if (
      typeof session.accessToken !== "string" ||
      typeof session.accessTokenExpiresAt !== "number" ||
      typeof session.refreshExpiresAt !== "number" ||
      typeof session.user !== "object" ||
      session.user === null
    ) {
      return;
    }
    const u = session.user as Partial<SessionUser>;
    if (typeof u.id !== "string" || typeof u.tenantId !== "string") return;
    const normalised: Session = {
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      user: {
        id: u.id,
        tenantId: u.tenantId,
        email: typeof u.email === "string" ? u.email : null,
        fullName: typeof u.fullName === "string" ? u.fullName : null,
      },
    };
    this.adoptSession(normalised);
  }

  private adoptSession(session: Session): void {
    if (this.currentSession && this.currentSession.user.id !== session.user.id) {
      // Identity swap is a hard error per data-model I-2 — surface and stop.
      this.permanentlyFailed = true;
      this.clearTimer();
      this.options.onError(authFailed("Session identity changed unexpectedly", 401, "IDENTITY_SWAP"));
      this.fireSessionExpiredOnce();
      return;
    }
    this.currentSession = session;
    this.options.onSession(session);
    this.scheduleNextRefresh();
  }

  /**
   * Adopt the initial session (e.g. from the callback flow). Subsequent
   * refreshes are scheduled automatically.
   */
  primeSession(session: Session): void {
    this.permanentlyFailed = false;
    this.sessionExpiredFired = false;
    this.failureCount = 0;
    this.currentSession = session;
    this.scheduleNextRefresh();
  }

  hasSession(): boolean {
    return this.currentSession !== null;
  }

  isPermanentlyFailed(): boolean {
    return this.permanentlyFailed;
  }

  getSession(): Session | null {
    return this.currentSession;
  }

  async refresh(): Promise<RefreshResult> {
    if (this.permanentlyFailed) {
      return {
        kind: "permanent_fail",
        error: authFailed("Refresh already permanently failed", 401, "PERMANENT_FAIL"),
      };
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefreshWithCoordination().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async performRefreshWithCoordination(): Promise<RefreshResult> {
    if (this.channel) {
      // Best-effort cross-tab claim: announce intent and wait briefly for a
      // session broadcast from another tab. If one arrives first, adopt it
      // and skip the HTTP call.
      const winner = await this.claimRefreshWindow();
      if (winner) return winner;
    }
    return this.performRefresh();
  }

  private claimRefreshWindow(): Promise<RefreshResult | null> {
    return new Promise<RefreshResult | null>((resolve) => {
      let resolved = false;
      const channel = this.channel;
      if (!channel) {
        resolve(null);
        return;
      }
      const listener = (evt: MessageEvent): void => {
        if (resolved) return;
        if (!evt.data || typeof evt.data !== "object") return;
        const msg = evt.data as { type?: unknown; session?: unknown };
        if (msg.type !== "session") return;
        const previous = this.currentSession;
        this.handleBroadcast(evt.data);
        // The broadcast adopter does not return a RefreshResult directly; we
        // synthesise one from `currentSession` if it changed.
        if (this.currentSession && this.currentSession !== previous) {
          resolved = true;
          channel.removeEventListener("message", listener);
          resolve({
            kind: "ok",
            session: this.currentSession,
            rawRefreshToken: null,
            nextRefreshIn: this.computeNextRefreshIn(this.currentSession),
          });
        }
      };
      channel.addEventListener("message", listener);
      try {
        channel.postMessage({ type: "claim" });
      } catch {
        // ignore
      }
      setTimeout(() => {
        if (resolved) return;
        channel.removeEventListener("message", listener);
        resolve(null);
      }, CLAIM_WINDOW_MS);
    });
  }

  private async performRefresh(): Promise<RefreshResult> {
    const body =
      this.options.tokenStorage === "memory"
        ? { refresh_token: this.options.sessionStore.getRefreshToken() ?? "" }
        : {};

    const res = await request<RefreshHttpResponse>({
      url: this.options.refreshUrl,
      method: "POST",
      tenantSlug: this.options.tenantSlug,
      body,
      // Under cookie mode the refresh cookie may live on a different origin
      // (tenant backend). Same-origin keeps memory mode safe.
      credentials: this.options.tokenStorage === "cookie" ? "include" : "same-origin",
      errorKind: "refresh",
    });

    if (!res.ok) {
      const error = res.error;
      const status =
        error.kind === "refresh_failed" || error.kind === "auth_failed"
          ? error.httpStatus
          : 0;
      if (
        error.kind === "refresh_failed" &&
        PERMANENT_HTTP_STATUSES.has(status)
      ) {
        return this.transitionPermanent(error);
      }
      return this.transitionTransient(error);
    }

    const data = res.data;
    const accessToken =
      typeof data.access_token === "string" ? data.access_token : "";
    const expiresIn =
      typeof data.expires_in === "number" ? data.expires_in : 0;
    const refreshExpiresIn =
      typeof data.refresh_expires_in === "number"
        ? data.refresh_expires_in
        : expiresIn;
    if (!accessToken || expiresIn <= 0) {
      return this.transitionTransient(
        authFailed("Refresh response missing access_token / expires_in", 500, "MALFORMED_RESPONSE"),
      );
    }

    let claims: JwtClaims;
    try {
      claims = decodeJwtClaims(accessToken);
    } catch (e) {
      const err = e as UserboxError;
      return this.transitionPermanent(err);
    }

    const newRefreshToken =
      typeof data.refresh_token === "string" ? data.refresh_token : null;
    if (this.options.tokenStorage === "memory" && newRefreshToken) {
      this.options.sessionStore.setRefreshToken(newRefreshToken);
    }

    const previousUserId = this.currentSession?.user.id ?? null;
    if (previousUserId && previousUserId !== claims.sub) {
      const err = authFailed("Session identity changed unexpectedly", 401, "IDENTITY_SWAP");
      return this.transitionPermanent(err);
    }

    const session: Session = {
      accessToken,
      accessTokenExpiresAt: this.now() + expiresIn * 1000,
      refreshExpiresAt: this.now() + refreshExpiresIn * 1000,
      user: {
        id: claims.sub,
        tenantId: claims.tid,
        email: this.currentSession?.user.email ?? null,
        fullName: this.currentSession?.user.fullName ?? null,
      },
    };

    this.failureCount = 0;
    this.currentSession = session;
    this.options.onSession(session);
    this.scheduleNextRefresh();
    this.broadcast(session);

    return {
      kind: "ok",
      session,
      rawRefreshToken: newRefreshToken,
      nextRefreshIn: this.computeNextRefreshIn(session),
    };
  }

  private transitionPermanent(error: UserboxError): RefreshPermanent {
    this.permanentlyFailed = true;
    this.clearTimer();
    this.options.onError(error);
    this.fireSessionExpiredOnce();
    return { kind: "permanent_fail", error };
  }

  private transitionTransient(error: UserboxError): RefreshTransient {
    this.failureCount += 1;
    this.options.onError(error);
    if (this.failureCount >= RETRY_DELAYS_MS.length) {
      // Escalate to permanent for this lifetime.
      const escalated = authFailed(
        "Refresh transient failures exceeded retry budget",
        503,
        "REFRESH_RETRY_BUDGET",
      );
      this.transitionPermanent(escalated);
      return { kind: "transient_fail", error, retryInMs: 0 };
    }
    const retryInMs = RETRY_DELAYS_MS[this.failureCount - 1] ?? 9_000;
    this.scheduleTimer(retryInMs);
    return { kind: "transient_fail", error, retryInMs };
  }

  private fireSessionExpiredOnce(): void {
    if (this.sessionExpiredFired) return;
    this.sessionExpiredFired = true;
    this.options.onSessionExpired();
  }

  private computeNextRefreshIn(session: Session): number {
    const ttl = session.accessTokenExpiresAt - this.now();
    const reserved = Math.max(
      ttl * this.options.refreshThresholdPct,
      this.options.proactiveSkewMs,
    );
    const next = ttl - reserved;
    return Math.max(next, 0);
  }

  private scheduleNextRefresh(): void {
    if (!this.currentSession) return;
    if (this.permanentlyFailed) return;
    const delay = this.computeNextRefreshIn(this.currentSession);
    this.scheduleTimer(delay);
  }

  private scheduleTimer(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private broadcast(session: Session): void {
    if (!this.channel) return;
    try {
      this.channel.postMessage({ type: "session", session });
    } catch {
      // ignore
    }
  }

  /** Test/teardown hook. */
  dispose(): void {
    this.clearTimer();
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        // ignore
      }
      this.channel = null;
    }
  }
}
