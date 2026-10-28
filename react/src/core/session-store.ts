/**
 * Storage strategy abstraction for the refresh credential.
 *
 * - `MemoryStore` holds the refresh token in a closure variable (V1 SPA mode).
 * - `CookieStore` is a stub: it never touches `document.cookie`. The refresh
 *   cookie is set/cleared by the tenant's backend in response to the
 *   `refreshUrl` POST or `Set-Cookie` header from the Edge middleware. Its
 *   read/write methods are no-ops by design.
 */

export type TokenStorage = "memory" | "cookie";

export interface SessionStore {
  readonly kind: TokenStorage;
  getRefreshToken(): string | null;
  setRefreshToken(token: string | null): void;
}

export class MemoryStore implements SessionStore {
  readonly kind: TokenStorage = "memory";
  private token: string | null = null;
  getRefreshToken(): string | null {
    return this.token;
  }
  setRefreshToken(token: string | null): void {
    this.token = token;
  }
}

export class CookieStore implements SessionStore {
  readonly kind: TokenStorage = "cookie";
  // The browser owns the cookie; the SDK never reads or writes it directly.
  getRefreshToken(): string | null {
    return null;
  }
  setRefreshToken(_token: string | null): void {
    void _token;
  }
}

export function createSessionStore(kind: TokenStorage): SessionStore {
  return kind === "memory" ? new MemoryStore() : new CookieStore();
}
