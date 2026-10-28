# Security policy — `@userbox/react`

## Threat model summary

- **Access token storage**: memory-only. The SDK never writes the access
  token to `localStorage`, `sessionStorage`, IndexedDB, or `document.cookie`.
  An architectural test (`tests/architectural/no-localstorage-writes.test.ts`)
  scans the built bundle and fails the build if these writes appear.
- **Refresh token storage** (two strategies):
  - `cookie` (recommended): httpOnly + Secure + SameSite=Lax cookie managed
    by the tenant backend; the SDK never reads `document.cookie`.
  - `memory`: closure-scoped, lost on reload — by design.
- **Server authority**: permission decisions are made by the API on every
  request that performs an action. The SDK's `usePermission` is a UI hint;
  a `true` value does NOT authorize a destructive action.
- **JWT verification**: the SDK decodes JWT claims for routing/timer use
  (`sub`, `tid`, `exp`) without signature verification — the server is the
  sole authority on token validity.
- **No credentials in logs**: error messages, `console.warn`, and `Error`
  objects produced by the SDK MUST NOT contain access or refresh tokens.
  Enforced by `tests/architectural/no-credential-logs.test.ts` against the
  built bundle.

## CSRF / replay protection on sign-in

Each `signIn()` / `signUp()` call generates a cryptographic random state
nonce, stored in `sessionStorage` under `ub.auth.state` keyed by a
per-flow `flowId`. The callback verifies the returned `state` matches the
stored value. Mismatch → `UserboxError { kind: "auth_failed", code: "STATE_MISMATCH" }`.

Multi-flow safety: starting multiple concurrent sign-in flows is supported;
each is keyed independently and consuming one does not affect others.

## Cross-tab coordination

When `BroadcastChannel` is available, refresh requests are coordinated so
exactly one tab issues the outbound HTTP call per refresh cycle. The other tabs adopt the broadcast session.

## Cookie attributes (Next.js middleware)

The middleware sets the rotated refresh cookie with:

- `HttpOnly` — non-negotiable.
- `Secure` — required in production builds, optional in dev.
- `SameSite=Lax` — default; overridable to `Strict` or `None`.
- `Domain` — defaults to the request host; configurable for cookie-domain
  sharing (e.g. `.acme.com`).
- `Max-Age` — derived from the refresh-token TTL the server returned.

Silent regression of these attributes is a release-blocker.

## Failure-mode preservation (Next.js middleware)

A 5xx or network failure from the refresh endpoint does NOT clear the
refresh cookie. Only HTTP 400/401/403 (genuine credential rejection) clears
the cookie. This prevents a Userbox-side outage from mass-logging-out users.

## Reporting a vulnerability

See the repository [security policy](../SECURITY.md). Report privately through
GitHub private vulnerability reporting or **security@osbxtech.nl**, never in a
public issue.
