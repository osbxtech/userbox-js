import {
  DEFAULT_BASE_URL,
  isAccessCheckShape,
  isAccessPermissionsShape,
  isListEnvelope,
  normaliseBaseUrl,
  request,
  type HttpMethod,
  type QueryValue,
} from "./http";
import type { UserboxClientConfig } from "./types/client-config";
import type { CanArgs, GetUserPermissionsArgs } from "./types/access";
import type { UserResponse } from "./types/user";
import type { WorkspaceResponse } from "./types/workspace";
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
  per_page: number;
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

  constructor(config: UserboxClientConfig) {
    this.apiKey = config.apiKey;
    this.tenantId = config.tenantId;
    this.baseUrl = normaliseBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
  }

  protected _request<T>(args: {
    method: HttpMethod;
    path: string;
    query?: Record<string, QueryValue>;
    body?: unknown;
    validate?: (body: unknown) => body is T;
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
      validate: isListEnvelope as (b: unknown) => b is MembershipListWire,
    });
    return {
      data: wire.items,
      total: wire.total,
      page: wire.page,
      per_page: wire.per_page,
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
