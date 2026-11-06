import { type Credentials, loadCredentials, saveCredentials } from "./credentials.js";
import { CliError } from "./output.js";

export const DEFAULT_API_URL = "https://api.test.userbox.app";

interface ApiErrorBody {
  code?: string;
  error?: string;
  detail?: unknown;
}

export class ApiError extends CliError {
  constructor(
    readonly status: number,
    code: string,
    message: string,
  ) {
    super(code, `${message} (HTTP ${status})`);
  }
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // non-JSON error body
  }
  const message =
    body.error ??
    (typeof body.detail === "string" ? body.detail : body.detail ? JSON.stringify(body.detail) : res.statusText);
  return new ApiError(res.status, body.code ?? `HTTP_${res.status}`, message);
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function rawRequest<T>(apiUrl: string, path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new CliError("NETWORK", `cannot reach ${apiUrl}: ${(err as Error).message}`);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export function expiryFrom(tokens: TokenPair): number {
  return Date.now() + (tokens.expires_in ?? 900) * 1000;
}

/**
 * Map a failed `/v1/auth/refresh` to a CLI error. Only a refresh token the API
 * no longer accepts (expired, revoked, or already used: 401
 * `INVALID_REFRESH_TOKEN`) means the login is over. Any other 4xx keeps the
 * API's own code and message, so the cause is not hidden behind a re-login.
 */
export function refreshError(err: unknown): unknown {
  if (!(err instanceof ApiError) || err.status < 400 || err.status >= 500) return err;
  if (err.status === 401 || err.code === "INVALID_REFRESH_TOKEN") {
    return new CliError(
      "SESSION_EXPIRED",
      "the CLI login has expired or was revoked",
      "Ask the human to run `npx @userbox/cli login` again.",
    );
  }
  return new CliError(
    err.code,
    `refreshing the CLI login failed: ${err.message}`,
    "This is not an expired login. Retry; if it persists, report the code and message.",
  );
}

/** An authenticated client bound to the stored CLI login. */
export class Session {
  private constructor(private creds: Credentials) {}

  static load(): Session {
    const creds = loadCredentials();
    if (!creds) {
      throw new CliError(
        "NOT_LOGGED_IN",
        "not logged in",
        "Ask the human to run `npx @userbox/cli login` in their own terminal, then retry.",
      );
    }
    return new Session(creds);
  }

  get apiUrl(): string {
    return this.creds.apiUrl;
  }
  get tenantSlug(): string {
    return this.creds.tenantSlug;
  }
  get tenantId(): string {
    return this.creds.tenantId;
  }
  get email(): string {
    return this.creds.email;
  }
  /** The logged-in user's id: the `sub` of our own access token (not an authorization decision). */
  get userId(): string {
    const payload = this.creds.accessToken.split(".")[1] ?? "";
    return (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string }).sub;
  }

  private async refresh(): Promise<void> {
    try {
      const tokens = await rawRequest<TokenPair>(this.creds.apiUrl, "/v1/auth/refresh", {
        method: "POST",
        body: { refresh_token: this.creds.refreshToken },
        headers: { "X-Tenant-ID": this.creds.tenantId },
      });
      this.creds = {
        ...this.creds,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessExpiresAt: expiryFrom(tokens),
      };
      saveCredentials(this.creds);
    } catch (err) {
      throw refreshError(err);
    }
  }

  async request<T>(path: string, opts: RequestOptions & { envId?: string } = {}): Promise<T> {
    if (Date.now() > this.creds.accessExpiresAt - 30_000) await this.refresh();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.creds.accessToken}`,
      "X-Tenant-ID": this.creds.tenantId,
      ...opts.headers,
    };
    if (opts.envId) headers["X-Environment-ID"] = opts.envId;
    try {
      return await rawRequest<T>(this.creds.apiUrl, path, { ...opts, headers });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await this.refresh();
        headers.Authorization = `Bearer ${this.creds.accessToken}`;
        return rawRequest<T>(this.creds.apiUrl, path, { ...opts, headers });
      }
      throw err;
    }
  }
}
