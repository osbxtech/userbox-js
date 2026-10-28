import { headers } from "next/headers";
import { decodeJwtClaims } from "../core/token";
import type { Session } from "../core/refresh-engine";

/**
 * Reads the access token forwarded by `userboxMiddleware` from the request
 * headers and returns the full session. Returns `null` if the header is absent
 * (no signed-in user for this request).
 *
 * **SECURITY**: the returned `ServerSession` contains the bearer `accessToken`.
 * This object MUST NOT be passed as a prop to a Client Component — Next.js
 * will serialise the token into the client bundle and defeat the
 * memory-only-storage guarantee. Pass `session.user` instead.
 */
export async function getSession(): Promise<Session | null> {
  const hdrs = await headers();
  const accessTokenHeader =
    hdrs.get("x-userbox-access-token") ?? hdrs.get("X-Userbox-Access-Token");
  if (!accessTokenHeader) return null;

  let claims;
  try {
    claims = decodeJwtClaims(accessTokenHeader);
  } catch {
    return null;
  }

  return {
    accessToken: accessTokenHeader,
    accessTokenExpiresAt: claims.exp * 1000,
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
