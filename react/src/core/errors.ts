/**
 * Userbox error tagged-union. Used by every layer of the SDK as the single
 * error shape callers may inspect. Tokens (access / refresh) MUST NEVER appear
 * in any `message` produced by these constructors — security invariant S-2.
 */

export type MisconfiguredField =
  | "tenantSlug"
  | "baseUrl"
  | "tokenStorage"
  | "refreshUrl"
  | "callbackUrl";

export type UserboxError =
  | {
      kind: "missing_credentials";
      message: string;
      requestId?: string;
    }
  | {
      kind: "auth_failed";
      message: string;
      httpStatus: number;
      code: string;
      requestId?: string;
    }
  | {
      kind: "refresh_failed";
      message: string;
      httpStatus: number;
      code: string;
      requestId?: string;
    }
  | {
      kind: "permission_fetch_failed";
      message: string;
      httpStatus: number;
      code: string;
      workspaceId: string;
      requestId?: string;
    }
  | { kind: "network"; message: string }
  | { kind: "misconfigured"; message: string; field: MisconfiguredField };

const ERROR_KINDS: ReadonlySet<string> = new Set([
  "missing_credentials",
  "auth_failed",
  "refresh_failed",
  "permission_fetch_failed",
  "network",
  "misconfigured",
]);

/** Type guard verifying a value is a `UserboxError`. */
export function isUserboxError(value: unknown): value is UserboxError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; message?: unknown };
  return (
    typeof candidate.kind === "string" &&
    ERROR_KINDS.has(candidate.kind) &&
    typeof candidate.message === "string"
  );
}

export function missingCredentials(message: string, requestId?: string): UserboxError {
  return requestId
    ? { kind: "missing_credentials", message, requestId }
    : { kind: "missing_credentials", message };
}

export function authFailed(
  message: string,
  httpStatus: number,
  code: string,
  requestId?: string,
): UserboxError {
  return requestId
    ? { kind: "auth_failed", message, httpStatus, code, requestId }
    : { kind: "auth_failed", message, httpStatus, code };
}

export function refreshFailed(
  message: string,
  httpStatus: number,
  code: string,
  requestId?: string,
): UserboxError {
  return requestId
    ? { kind: "refresh_failed", message, httpStatus, code, requestId }
    : { kind: "refresh_failed", message, httpStatus, code };
}

export function permissionFetchFailed(
  message: string,
  httpStatus: number,
  code: string,
  workspaceId: string,
  requestId?: string,
): UserboxError {
  return requestId
    ? {
        kind: "permission_fetch_failed",
        message,
        httpStatus,
        code,
        workspaceId,
        requestId,
      }
    : { kind: "permission_fetch_failed", message, httpStatus, code, workspaceId };
}

export function networkError(message: string): UserboxError {
  return { kind: "network", message };
}

export function misconfigured(field: MisconfiguredField, message: string): UserboxError {
  return { kind: "misconfigured", message, field };
}
