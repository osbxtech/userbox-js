import { UserboxError } from "./errors";

export const DEFAULT_BASE_URL = "https://api.userbox.app";

export function normaliseBaseUrl(baseUrl: string | undefined): string {
  const value = baseUrl ?? DEFAULT_BASE_URL;
  return value.replace(/\/+$/, "");
}

export type QueryValue = string | number | boolean | undefined | null;

export interface BuildUrlArgs {
  baseUrl: string;
  path: string;
  query?: Record<string, QueryValue>;
}

export function buildUrl({ baseUrl, path, query }: BuildUrlArgs): string {
  const base = normaliseBaseUrl(baseUrl);
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${normalisedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export interface BuildHeadersArgs {
  apiKey: string;
  tenantId: string;
  hasBody: boolean;
}

export function buildHeaders({ apiKey, tenantId, hasBody }: BuildHeadersArgs): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "X-Tenant-ID": tenantId,
    Accept: "application/json",
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RequestArgs<T = unknown> {
  apiKey: string;
  tenantId: string;
  baseUrl: string;
  method: HttpMethod;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /**
   * Optional top-level shape validator. When provided, the parsed 2xx body
   * is passed through this predicate; a `false` result throws `UserboxError`
   * with `code: "UNKNOWN_ERROR"`, `message: "Unexpected response shape"`,
   * and the actual HTTP status.
   */
  validate?: (body: unknown) => body is T;
}

interface PlatformErrorBody {
  code?: unknown;
  error?: unknown;
  message?: unknown;
}

function extractErrorContract(body: unknown): { code: string; message: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as PlatformErrorBody;
  const codeOk = typeof candidate.code === "string" && candidate.code.length > 0;
  const messageRaw = typeof candidate.error === "string"
    ? candidate.error
    : typeof candidate.message === "string"
      ? candidate.message
      : null;
  if (!codeOk || messageRaw === null) return null;
  return { code: candidate.code as string, message: messageRaw };
}

function statusMessage(status: number, statusText: string): string {
  if (statusText && statusText.length > 0) {
    return `HTTP ${status} ${statusText}`;
  }
  return `HTTP ${status}`;
}

export async function request<T>(args: RequestArgs<T>): Promise<T> {
  const url = buildUrl({ baseUrl: args.baseUrl, path: args.path, query: args.query });
  const hasBody = args.body !== undefined;
  const headers = buildHeaders({ apiKey: args.apiKey, tenantId: args.tenantId, hasBody });

  let response: Response;
  try {
    response = await fetch(url, {
      method: args.method,
      headers,
      body: hasBody ? JSON.stringify(args.body) : undefined,
    });
  } catch (err) {
    const original = err instanceof Error ? err.message : "Network request failed";
    throw new UserboxError({
      status: 0,
      code: "NETWORK_ERROR",
      message: original,
    });
  }

  const status = response.status;

  if (status >= 200 && status < 300) {
    if (status === 204) {
      return undefined as T;
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new UserboxError({
        status,
        code: "UNKNOWN_ERROR",
        message: statusMessage(status, response.statusText),
      });
    }
    if (args.validate !== undefined) {
      return requireShape<T>(parsed, args.validate, status);
    }
    return parsed as T;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  const contract = extractErrorContract(body);
  if (contract) {
    throw new UserboxError({
      status,
      code: contract.code,
      message: contract.message,
    });
  }

  throw new UserboxError({
    status,
    code: "UNKNOWN_ERROR",
    message: statusMessage(status, response.statusText),
  });
}

/**
 * Top-level shape guard for 2xx response bodies.
 *
 * Throws `UserboxError { code: "UNKNOWN_ERROR", message: "Unexpected response shape" }`
 * carrying the original HTTP `status` when `predicate(body)` is false.
 * This is the SDK's ONLY runtime validation — it catches gross platform
 * misbehaviour (missing top-level field, wrong-typed envelope) without
 * the weight of a full schema validator (zero runtime deps).
 */
export function requireShape<T>(
  body: unknown,
  predicate: (v: unknown) => v is T,
  status: number,
): T {
  if (!predicate(body)) {
    throw new UserboxError({
      status,
      code: "UNKNOWN_ERROR",
      message: "Unexpected response shape",
    });
  }
  return body;
}

/** Predicate: `{ allowed: boolean }`. */
export function isAccessCheckShape(body: unknown): body is { allowed: boolean } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { allowed?: unknown }).allowed === "boolean"
  );
}

/** Predicate: `{ permissions: string[] }`. */
export function isAccessPermissionsShape(
  body: unknown,
): body is { permissions: string[] } {
  if (typeof body !== "object" || body === null) return false;
  const value = (body as { permissions?: unknown }).permissions;
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Predicate: list envelope `{ items: unknown[], total, page, per_page }`. */
export function isListEnvelope(
  body: unknown,
): body is { items: unknown[]; total: number; page: number; per_page: number } {
  if (typeof body !== "object" || body === null) return false;
  const v = body as {
    items?: unknown;
    total?: unknown;
    page?: unknown;
    per_page?: unknown;
  };
  return (
    Array.isArray(v.items) &&
    typeof v.total === "number" &&
    typeof v.page === "number" &&
    typeof v.per_page === "number"
  );
}

/**
 * Predicate: membership list envelope `{ items: unknown[], total, page, page_size }`.
 * `GET /v1/memberships` names its page size `page_size`, unlike the audit-log list.
 */
export function isMembershipListEnvelope(
  body: unknown,
): body is { items: unknown[]; total: number; page: number; page_size: number } {
  if (typeof body !== "object" || body === null) return false;
  const v = body as {
    items?: unknown;
    total?: unknown;
    page?: unknown;
    page_size?: unknown;
  };
  return (
    Array.isArray(v.items) &&
    typeof v.total === "number" &&
    typeof v.page === "number" &&
    typeof v.page_size === "number"
  );
}
