import { headers } from "next/headers.js";
import { decodeJwtClaims } from "../core/token";
import type { Session } from "../core/refresh-engine";

const DEFAULT_ACCESS_TOKEN_HEADER = "x-userbox-access-token";

export type UnverifiedSessionOptions = {
  /** Must match `MiddlewareConfig.accessTokenHeader`. */
  accessTokenHeader?: string;
};

/**
 * Reads the access token forwarded by `userboxMiddleware` from the request
 * headers and returns the session it describes. Returns `null` if the header is
 * absent (no signed-in user for this request), malformed, or expired.
 *
 * **NOT VERIFIED**: the token's claims are decoded, never checked against the
 * Userbox JWKS. The value is trustworthy only on routes that `userboxMiddleware`
 * (`proxy.ts` / `middleware.ts`) matches, because the middleware deletes any
 * client-supplied token header and forwards only a token it just obtained from
 * Userbox. Use it to render UI, never to authorize: authorization verifies the
 * Bearer token (RS256, JWKS, `tid`) on the server and checks permissions with
 * `@userbox/node`.
 *
 * **SECURITY**: the returned `ServerSession` contains the bearer `accessToken`.
 * This object MUST NOT be passed as a prop to a Client Component — Next.js
 * will serialise the token into the client bundle and defeat the
 * memory-only-storage guarantee. Pass `session.user` instead.
 */
export async function getUnverifiedSession(
  options: UnverifiedSessionOptions = {},
): Promise<Session | null> {
  const hdrs = await headers();
  const accessToken = hdrs.get(options.accessTokenHeader ?? DEFAULT_ACCESS_TOKEN_HEADER);
  if (!accessToken) return null;

  let claims;
  try {
    claims = decodeJwtClaims(accessToken);
  } catch {
    return null;
  }
  const accessTokenExpiresAt = claims.exp * 1000;
  if (accessTokenExpiresAt <= Date.now()) return null;

  return {
    accessToken,
    accessTokenExpiresAt,
    refreshExpiresAt: 0,
    user: {
      id: claims.sub,
      tenantId: claims.tid,
      email: null,
      fullName: null,
    },
  };
}

export type { Session as ServerSession } from "../core/refresh-engine";
