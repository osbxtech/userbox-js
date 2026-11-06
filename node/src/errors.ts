export interface UserboxErrorArgs {
  code: string;
  message: string;
  status: number;
}

/**
 * Base class of every error the SDK throws. The named subclasses below are the
 * shared taxonomy (docs/sdk-author-contract.md); an error that fits none of
 * them (400, 422, an unexpected response shape) is a plain `UserboxError`.
 */
export class UserboxError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(args: UserboxErrorArgs) {
    super(args.message);
    this.name = new.target.name;
    this.code = args.code;
    this.status = args.status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 401 or 403: the API key is missing, invalid, or lacks a scope. */
export class UserboxAuthError extends UserboxError {}

/** 404: the resource (or a user or role named in the request) does not exist. */
export class UserboxNotFoundError extends UserboxError {}

export interface UserboxConflictErrorArgs extends UserboxErrorArgs {
  existingWorkspaceId?: string;
}

/** 409: the request conflicts with existing state. */
export class UserboxConflictError extends UserboxError {
  /**
   * `createWorkspace` conflicts (`WS_EXTERNAL_ID_CONFLICT`, `WS_SLUG_CONFLICT`)
   * carry the existing workspace's id, but only when that workspace is in the
   * API key's environment.
   */
  readonly existingWorkspaceId?: string;

  constructor(args: UserboxConflictErrorArgs) {
    super(args);
    if (args.existingWorkspaceId !== undefined) this.existingWorkspaceId = args.existingWorkspaceId;
  }
}

/** 429. */
export class UserboxRateLimitError extends UserboxError {}

/** 5xx. */
export class UserboxServerError extends UserboxError {}

/** The request never got an HTTP response (`status` is 0). */
export class UserboxNetworkError extends UserboxError {}

/** The SDK is missing a setting such as the API key (`status` is 0). */
export class UserboxConfigError extends UserboxError {}

/** The taxonomy class for an HTTP error response. */
export function errorForStatus(args: UserboxErrorArgs, body?: unknown): UserboxError {
  const { status } = args;
  if (status === 401 || status === 403) return new UserboxAuthError(args);
  if (status === 404) return new UserboxNotFoundError(args);
  if (status === 409) {
    const id = (body as { existing_workspace_id?: unknown } | null | undefined)?.existing_workspace_id;
    return new UserboxConflictError({ ...args, ...(typeof id === "string" ? { existingWorkspaceId: id } : {}) });
  }
  if (status === 429) return new UserboxRateLimitError(args);
  if (status >= 500) return new UserboxServerError(args);
  return new UserboxError(args);
}
