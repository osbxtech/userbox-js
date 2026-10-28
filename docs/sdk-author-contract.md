# SDK author contract

Every official Userbox SDK, in every language, implements this contract without
deviation. It is the consistency promise Userbox makes to the developers who
integrate it. A change to an SDK that breaks a rule below is a bug.

## Required capabilities

| Capability | Notes |
|---|---|
| JWT verification (RS256 only) | The algorithm is fixed in code, never read from the token header. Use the language's best-maintained JWT library. |
| Automatic token refresh | Refresh proactively at 80% of the access-token TTL. Refresh is single-flight: concurrent requests coalesce into one outbound call. |
| Cookie strategy support | Server framework integrations register the `/api/auth/refresh` proxy route. Browser code never sees the refresh token in cookie mode. |
| Memory strategy support | Access and refresh tokens are held in process memory. The SDK calls `POST /v1/auth/refresh` directly. |
| `require_auth` / middleware | For server SDKs: a framework-native guard that resolves a `UserboxUser` from the `Authorization: Bearer` header and attaches it to the request context. |
| Workspace permission check | Wraps `POST /v1/access/check` or `GET /v1/access/permissions`. Every permission check is scoped to a workspace. |
| Error types | The shared taxonomy below. |
| Sync and async clients | Where the language has both styles, both are offered with the same surface. |

## Token handling (non-negotiable)

- **Access tokens**: memory only. Never `localStorage`, `sessionStorage`, cookies or disk.
- **Refresh tokens, memory strategy**: memory only.
- **Refresh tokens, cookie strategy**: an `httpOnly` cookie set by the tenant's backend. The SDK never sets this cookie from browser JavaScript.
- **Algorithm lock**: `RS256`, hard-coded in the verification call, never negotiated from the token header.
- **Refresh is single-use and single-flight**: two concurrent refreshes resolve to the same result. Two refresh tokens are never consumed in parallel.

## Token lifecycle

- Access token TTL: 15 minutes. Stateless, verified locally.
- Refresh token TTL: up to 7 days. Single-use, rotated on every exchange.
- Proactive refresh: start at 80% of the access-token TTL. Do not wait for expiry.

## Session strategies

- `memory`: both tokens in process or React state. The SDK calls `POST /v1/auth/refresh` directly. The session is lost on page or process restart. No backend required.
- `cookie`: the access token in memory, the refresh token in an `httpOnly` cookie managed by the tenant backend. The SDK calls the tenant's refresh proxy (default `/api/auth/refresh`). The session survives a restart. Requires a backend.

## Backend framework integrations

For languages with server-side SDKs:

- Register the `/api/auth/refresh` proxy route automatically (`init_userbox(app)` or the equivalent).
- Provide a `require_auth` / middleware pattern that resolves a `UserboxUser` from the `Authorization: Bearer` header.
- Verify JWTs locally with a cached public key and `RS256`. Never call Userbox on every request.

## HTTP conventions

| Header | Value | Notes |
|---|---|---|
| `X-Tenant-ID` | The tenant slug (e.g. `acme`) | Always present on SDK-initiated requests. |
| `Authorization` | `Bearer <access_token>` or `Bearer <api_key>` | On every protected call. |
| `Content-Type` | `application/json` | On requests with a body. |
| `User-Agent` | `userbox-{language}/{version}` | e.g. `userbox-php/1.0.0`. |

## Error taxonomy

Every SDK exposes the same named error types:
`UserboxAuthError`, `UserboxNotFoundError`, `UserboxConflictError`,
`UserboxRateLimitError`, `UserboxServerError`, `UserboxNetworkError`,
`UserboxConfigError`.

Credentials (API keys, access tokens, refresh tokens) never appear in error
messages, logs or warnings.

## Minimal runtime dependencies

An HTTP client and a JWT library, and nothing else. No bundled frameworks,
utility libraries or logging infrastructure. Use the ecosystem's standard HTTP
client where one exists.

## Versioning

SDKs are versioned independently with semver. A breaking change requires a
major version bump. From `1.0.0`, the compatibility promise covers every public
method signature, the error types, and the HTTP conventions above. Before
`1.0.0`, releases are published as `X.Y.Z-alpha.N` on the `alpha` channel and
may change.
