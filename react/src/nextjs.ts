// Public surface for `@userbox/react/nextjs` (Next.js entry point).
export {
  userboxMiddleware,
  type MiddlewareConfig,
} from "./nextjs/middleware";
export { getSession, type ServerSession } from "./nextjs/server";
export { isUserboxError } from "./core/errors";
export type { UserboxError } from "./core/errors";
export type { PublicSession, SessionUser } from "./react/context";
