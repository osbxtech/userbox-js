import { UserboxClient } from "../client";
import { UserboxError } from "../errors";
import type { CanArgs } from "../types/access";
import { isFrameworkControlFlow, report, type ErrorReporter } from "./report";

export interface SafeCanOptions {
  /** The client to use. Default: one client built from the environment (`new UserboxClient()`). */
  client?: UserboxClient;
  /** Called with the reason a check was denied by an error. Default: `console.warn` (code and status only). */
  onError?: ErrorReporter;
}

let defaultClient: UserboxClient | null = null;

/** Test hook: drop the environment-built default client. */
export function _resetDefaultClient(): void {
  defaultClient = null;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Deny-on-error permission check: "can `userId` do `permission` in
 * `workspaceId`?". Returns `true` only when Userbox answers `allowed: true`.
 * Every error (missing configuration, bad API key, unknown workspace, rate
 * limit, network failure, malformed response) returns `false` and is reported
 * through `onError`. It never throws, except to pass on a framework
 * control-flow signal (Next.js prerender bail-out, `redirect()`), which is
 * not an answer.
 *
 * Use `UserboxClient#can()` instead when you need to tell "denied" apart from
 * "the check failed".
 */
export async function can(args: CanArgs, options: SafeCanOptions = {}): Promise<boolean> {
  try {
    if (!isNonEmpty(args?.userId) || !isNonEmpty(args.workspaceId) || !isNonEmpty(args.permission)) {
      throw new UserboxError({
        status: 0,
        code: "INVALID_ARGUMENT",
        message: "can() needs a non-empty userId, workspaceId and permission",
      });
    }
    const client = options.client ?? (defaultClient ??= new UserboxClient());
    return (await client.can(args)) === true;
  } catch (err) {
    if (isFrameworkControlFlow(err)) throw err;
    report("can()", err, options.onError);
    return false;
  }
}
