export { UserboxClient } from "./client";
export { UserboxError } from "./errors";
export {
  verifyRequest,
  verifyAccessToken,
  type VerifiedUser,
  type VerifyOptions,
  type RequestLike,
} from "./server/verify";
export { can, type SafeCanOptions } from "./server/can";
export type { ErrorReporter } from "./server/report";
export type {
  UserboxClientConfig,
  CanArgs,
  GetUserPermissionsArgs,
  UserResponse,
  WorkspaceResponse,
  MembershipResponse,
  MembershipPage,
  GetUserMembershipsArgs,
  AuditLogRecord,
  AuditLogPage,
  GetAuditLogsArgs,
} from "./types";
