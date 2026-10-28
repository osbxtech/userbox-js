import {
  authFailed,
  networkError,
  refreshFailed,
  permissionFetchFailed,
  type UserboxError,
} from "./errors";

export type HttpRequestInput = {
  url: string;
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  tenantSlug: string;
  accessToken?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  /**
   * Maps a non-2xx response to the right `UserboxError` kind. Each caller
   * names its own context (refresh / permissions / etc.) so the error surface
   * stays meaningful.
   */
  errorKind: "auth" | "refresh" | "permissions";
  workspaceId?: string;
};

export type HttpResponse<T> =
  | { ok: true; data: T; requestId?: string }
  | { ok: false; error: UserboxError };

type ServerErrorShape = {
  code?: unknown;
  error?: unknown;
};

export async function request<T>(input: HttpRequestInput): Promise<HttpResponse<T>> {
  const headers: Record<string, string> = {
    "X-Tenant-ID": input.tenantSlug,
    Accept: "application/json",
    ...input.headers,
  };
  if (input.accessToken) {
    headers.Authorization = `Bearer ${input.accessToken}`;
  }
  const init: RequestInit = {
    method: input.method ?? "GET",
    headers,
  };
  if (input.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(input.body);
  }
  if (input.credentials !== undefined) {
    init.credentials = input.credentials;
  }
  if (input.signal) init.signal = input.signal;

  let response: Response;
  try {
    response = await fetch(input.url, init);
  } catch (err) {
    return {
      ok: false,
      error: networkError(humaniseNetworkError(err)),
    };
  }

  const requestId = response.headers.get("X-Request-ID") ?? undefined;

  if (response.status === 204) {
    return { ok: true, data: undefined as T, requestId };
  }

  let parsed: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (response.ok) {
    return { ok: true, data: parsed as T, requestId };
  }

  const shape = (parsed ?? {}) as ServerErrorShape;
  const code = typeof shape.code === "string" ? shape.code : "UNKNOWN";
  const message =
    typeof shape.error === "string"
      ? shape.error
      : `HTTP ${response.status}`;
  const error = mapServerError(input, response.status, code, message, requestId);
  return { ok: false, error };
}

function mapServerError(
  input: HttpRequestInput,
  status: number,
  code: string,
  message: string,
  requestId?: string,
): UserboxError {
  switch (input.errorKind) {
    case "refresh":
      return refreshFailed(message, status, code, requestId);
    case "permissions":
      return permissionFetchFailed(
        message,
        status,
        code,
        input.workspaceId ?? "",
        requestId,
      );
    case "auth":
    default:
      return authFailed(message, status, code, requestId);
  }
}

function humaniseNetworkError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return "Request aborted";
  }
  if (err instanceof Error) return err.message || "Network error";
  return "Network error";
}
