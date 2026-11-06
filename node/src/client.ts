import {
  DEFAULT_BASE_URL,
  isAccessCheckShape,
  isAccessPermissionsShape,
  isListEnvelope,
  isMembershipListEnvelope,
  normaliseBaseUrl,
  request,
  type HttpMethod,
  type QueryValue,
} from "./http";
import type { UserboxClientConfig } from "./types/client-config";
import { ENV, fromEnv, requireSetting } from "./server/env";
import type { CanArgs, GetUserPermissionsArgs } from "./types/access";
import type { UserResponse } from "./types/user";
import type { CreatedWorkspace, CreateWorkspaceArgs, WorkspaceResponse } from "./types/workspace";
import type {
  GetUserMembershipsArgs,
  MembershipPage,
  MembershipResponse,
} from "./types/membership";
import type {
  AuditLogPage,
  AuditLogRecord,
  GetAuditLogsArgs,
} from "./types/audit-log";

interface AccessCheckResponse {
  allowed: boolean;
}

interface AccessPermissionsResponse {
  permissions: string[];
}

interface MembershipListWire {
  items: MembershipResponse[];
  total: number;
  page: number;
  page_size: number;
}

interface CreateWorkspaceWire {
  id: string;
  slug: string;
  external_id: string | null;
  created?: boolean;
}

function isCreateWorkspaceShape(body: unknown): body is CreateWorkspaceWire {
  if (typeof body !== "object" || body === null) return false;
  const v = body as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.slug === "string" &&
    (v.external_id === null || v.external_id === undefined || typeof v.external_id === "string")
  );
}

interface AuditLogListWire {
  items: AuditLogRecord[];
  total: number;
  page: number;
  per_page: number;
}

export class UserboxClient {
  private readonly apiKey: string;
  private readonly tenantId: string;
  private readonly baseUrl: string;

  /**
   * Every field falls back to the environment: `apiKey` to `USERBOX_API_KEY`,
   * `tenantId` to `USERBOX_TENANT_ID`, `baseUrl` to `USERBOX_API_URL` then
   * `NEXT_PUBLIC_USERBOX_API_URL`. Throws `UserboxError` `CONFIG_ERROR` when
   * the API key or tenant id is missing from both.
   */
  constructor(config: Partial<UserboxClientConfig> = {}) {
    this.apiKey = requireSetting(config.apiKey, ENV.apiKey, "Userbox API key");
    this.tenantId = requireSetting(config.tenantId, ENV.tenantId, "Userbox tenant id");
    this.baseUrl = normaliseBaseUrl(config.baseUrl ?? fromEnv(ENV.apiUrl) ?? DEFAULT_BASE_URL);
  }

  protected _request<T>(args: {
    method: HttpMethod;
    path: string;
    query?: Record<string, QueryValue>;
    body?: unknown;
    validate?: (body: unknown) => body is T;
    onStatus?: (status: number) => void;
  }): Promise<T> {
    return request<T>({
      apiKey: this.apiKey,
      tenantId: this.tenantId,
      baseUrl: this.baseUrl,
      method: args.method,
      path: args.path,
      query: args.query,
      body: args.body,
      validate: args.validate,
      onStatus: args.onStatus,
    });
  }

  async can(args: CanArgs): Promise<boolean> {
    const body = await this._request<AccessCheckResponse>({
      method: "POST",
      path: "/v1/access/check",
      body: {
        user_id: args.userId,
        workspace_id: args.workspaceId,
        permission_key: args.permission,
      },
      validate: isAccessCheckShape,
    });
    return body.allowed;
  }

  async getUser(userId: string): Promise<UserResponse> {
    return await this._request<UserResponse>({
      method: "GET",
      path: `/v1/users/${encodeURIComponent(userId)}`,
    });
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceResponse> {
    return await this._request<WorkspaceResponse>({
      method: "GET",
      path: `/v1/workspaces/${encodeURIComponent(workspaceId)}`,
    });
  }

  /**
   * Create the workspace for a new customer and make `ownerUserId` its first
   * member with `ownerRole`, in one call. Needs an API key with the
   * `workspaces:write` scope.
   *
   * Safe to retry: with the same `externalId`, owner and role it returns the
   * existing workspace with `created: false`.
   *
   * Throws `UserboxConflictError` (`WS_EXTERNAL_ID_CONFLICT`,
   * `WS_SLUG_CONFLICT`; `existingWorkspaceId` when that workspace is in the
   * key's environment), `UserboxNotFoundError` (`USER_NOT_FOUND`,
   * `ROLE_NOT_FOUND`) and `UserboxAuthError` (missing scope).
   */
  async createWorkspace(args: CreateWorkspaceArgs): Promise<CreatedWorkspace> {
    let status = 201;
    const wire = await this._request<CreateWorkspaceWire>({
      method: "POST",
      path: "/v1/workspaces",
      body: {
        name: args.name,
        ...(args.slug !== undefined ? { slug: args.slug } : {}),
        ...(args.externalId !== undefined ? { external_id: args.externalId } : {}),
        owner: { user_id: args.ownerUserId, role: args.ownerRole },
      },
      validate: isCreateWorkspaceShape,
      onStatus: (s) => {
        status = s;
      },
    });
    return {
      id: wire.id,
      slug: wire.slug,
      externalId: wire.external_id ?? null,
      // 201 creates; 200 is an identical retry that returned the existing workspace.
      created: status === 201 && wire.created !== false,
    };
  }

  async getUserMemberships(args: GetUserMembershipsArgs): Promise<MembershipPage> {
    const page = args.page ?? 1;
    const perPage = args.perPage ?? 20;
    const wire = await this._request<MembershipListWire>({
      method: "GET",
      path: "/v1/memberships",
      query: {
        user_id: args.userId,
        page,
        per_page: perPage,
      },
      validate: isMembershipListEnvelope as (b: unknown) => b is MembershipListWire,
    });
    return {
      data: wire.items,
      total: wire.total,
      page: wire.page,
      per_page: wire.page_size,
    };
  }

  async getUserPermissions(args: GetUserPermissionsArgs): Promise<string[]> {
    const body = await this._request<AccessPermissionsResponse>({
      method: "GET",
      path: "/v1/access/permissions",
      query: {
        user_id: args.userId,
        workspace_id: args.workspaceId,
      },
      validate: isAccessPermissionsShape,
    });
    return body.permissions;
  }

  async getAuditLogs(args: GetAuditLogsArgs = {}): Promise<AuditLogPage> {
    const page = args.page ?? 1;
    const perPage = args.perPage ?? 20;
    const wire = await this._request<AuditLogListWire>({
      method: "GET",
      path: "/v1/audit-logs",
      query: {
        action: args.action,
        target_type: args.targetType,
        from: args.from,
        to: args.to,
        page,
        per_page: perPage,
      },
      validate: isListEnvelope as (b: unknown) => b is AuditLogListWire,
    });
    return {
      data: wire.items,
      total: wire.total,
      page: wire.page,
      per_page: wire.per_page,
    };
  }
}
