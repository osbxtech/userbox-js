import { UserboxError } from "../errors";

/**
 * Errors a framework throws on purpose to control rendering, which must reach
 * it unchanged: Next.js dynamic-usage / prerender bail-outs, `redirect()` and
 * `notFound()` (all carry a string `digest`), and React `postpone()`.
 * Catching one would, for example, let `next build` prerender a protected
 * route with the "denied" answer baked in.
 */
export function isFrameworkControlFlow(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { digest?: unknown; $$typeof?: unknown };
  return typeof e.digest === "string" || e.$$typeof === Symbol.for("react.postpone");
}

export type ErrorReporter = (error: UserboxError) => void;

export function toUserboxError(err: unknown): UserboxError {
  if (err instanceof UserboxError) return err;
  return new UserboxError({
    status: 0,
    code: "UNKNOWN_ERROR",
    message: err instanceof Error ? err.name : "Unknown error",
  });
}

/**
 * Reports a denial cause. Only `code`, `status` and the platform message are
 * printed, never a token, key or request header.
 */
export function report(scope: string, err: unknown, onError: ErrorReporter | undefined): void {
  const error = toUserboxError(err);
  if (onError) {
    try {
      onError(error);
    } catch {
      // A throwing reporter must not turn a denial into an exception.
    }
    return;
  }
  // eslint-disable-next-line no-console -- default reporter: a silent deny hides misconfiguration.
  console.warn(`[@userbox/node] ${scope} denied: ${error.code} (status ${error.status}): ${error.message}`);
}
