import { expectError, expectType } from "tsd";
import { UserboxClient } from "../src/client";
import { UserboxError } from "../src/errors";
import type { CanArgs, GetUserPermissionsArgs } from "../src/types/access";
import type { UserResponse } from "../src/types/user";
import type { WorkspaceResponse } from "../src/types/workspace";
import type {
  GetUserMembershipsArgs,
  MembershipPage,
  MembershipResponse,
} from "../src/types/membership";

const client = new UserboxClient({ apiKey: "fake_api_key_for_types", tenantId: "t-1" });

// --- CanArgs compile-time checks ---

expectError(client.can({}));
expectError(client.can({ userId: 42, workspaceId: "x", permission: "y" }));
expectError(client.can({ userId: "x", workspaceId: "y", permission: "z", extra: true }));
expectType<boolean>(await client.can({ userId: "x", workspaceId: "y", permission: "z" }));

// --- Constructor compile-time checks ---

expectError(new UserboxClient({ apiKey: "x" }));
expectError(new UserboxClient({ tenantId: "t" }));

// --- UserboxError is a proper Error subclass ---
expectType<string>((null as unknown as UserboxError).code);
expectType<number>((null as unknown as UserboxError).status);
expectType<string>((null as unknown as UserboxError).message);

// --- CanArgs is exported and structurally correct ---
const args: CanArgs = { userId: "u", workspaceId: "w", permission: "p" };
expectType<CanArgs>(args);

// --- getUser ---

expectType<UserResponse>(await client.getUser("u-1"));
// The SDK's UserResponse deliberately omits tenant_id — caller's tenant is implicit.
expectError((await client.getUser("u-1")).tenant_id);
expectError(client.getUser());
expectError(client.getUser(42));

// --- getWorkspace ---

expectType<WorkspaceResponse>(await client.getWorkspace("ws-1"));
expectError(client.getWorkspace());
expectError(client.getWorkspace(42));

// --- getUserMemberships ---

expectType<MembershipPage>(await client.getUserMemberships({ userId: "u-1" }));
expectType<MembershipResponse[]>(
  (await client.getUserMemberships({ userId: "u-1" })).data,
);
expectError(client.getUserMemberships({}));
expectError(client.getUserMemberships({ userId: 42 }));

const memArgs: GetUserMembershipsArgs = { userId: "u-1", page: 2, perPage: 50 };
expectType<GetUserMembershipsArgs>(memArgs);

// --- getUserPermissions ---

expectType<string[]>(
  await client.getUserPermissions({ userId: "u-1", workspaceId: "ws-1" }),
);
expectError(client.getUserPermissions({}));
expectError(client.getUserPermissions({ userId: "u-1" }));

const permArgs: GetUserPermissionsArgs = { userId: "u-1", workspaceId: "ws-1" };
expectType<GetUserPermissionsArgs>(permArgs);

// --- getAuditLogs ---

import type {
  AuditLogPage,
  AuditLogRecord,
  GetAuditLogsArgs,
} from "../src/types/audit-log";

expectType<AuditLogPage>(await client.getAuditLogs());
expectType<AuditLogPage>(await client.getAuditLogs({}));
expectType<AuditLogRecord[]>((await client.getAuditLogs()).data);

// Wrong type for targetType is rejected.
expectError(client.getAuditLogs({ targetType: 42 }));

// Wrong type for from is rejected.
expectError(client.getAuditLogs({ from: 123 }));

// camelCase arg names are the public surface; snake_case is rejected.
expectError(client.getAuditLogs({ target_type: "api_key" }));
expectError(client.getAuditLogs({ per_page: 50 }));

// AuditLogRecord field types match data-model §3.2.
expectType<string | null>((null as unknown as AuditLogRecord).actor_id);
expectType<string>((null as unknown as AuditLogRecord).actor_type);
expectType<Record<string, unknown> | null>(
  (null as unknown as AuditLogRecord).metadata,
);

const logArgs: GetAuditLogsArgs = {
  action: "api_key.created",
  targetType: "api_key",
  from: "2026-05-01T00:00:00Z",
  to: "2026-05-02T00:00:00Z",
  page: 2,
  perPage: 50,
};
expectType<GetAuditLogsArgs>(logArgs);
