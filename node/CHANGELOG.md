# Changelog

All notable changes to `@userbox/node` are documented in this file.

## [1.0.0-alpha.1] — 2026-11-04

### Added
- `verifyRequest(req, options?)` and `verifyAccessToken(token, options?)`:
  verify a Userbox access token from `Authorization: Bearer` (a `Request` or a
  `Headers` object). RS256 only, fixed in code; signature checked against
  `{apiUrl}/.well-known/jwks.json` with the Web Crypto API (no new
  dependency); `exp`/`nbf` with 5 s tolerance; `sub` and `tid` required and
  `tid` equal to the configured tenant. Returns `{ userId, tenantId, expiresAt }`
  or `null`, never throws. The key set is cached for 10 minutes and refetched
  at most every 30 seconds for an unknown `kid`.
- `can({ userId, workspaceId, permission }, options?)`: a deny-on-error
  permission check. Any error (configuration, 4xx, 5xx, network, unexpected
  response) returns `false` and is reported through `onError`, or a
  `console.warn` line with the code and status. Never throws.
- `new UserboxClient()` reads missing fields from `USERBOX_API_KEY`,
  `USERBOX_TENANT_ID` and `USERBOX_API_URL` / `NEXT_PUBLIC_USERBOX_API_URL`,
  and throws `UserboxError` `CONFIG_ERROR` when the key or tenant id is missing.

## [1.0.0-alpha.0] — 2026-10-28

First alpha. Renamed from the unpublished `@userbox/sdk`; the API is unchanged.

### Fixed
- `getUserMemberships()` reads the page size from `page_size`, the field
  `GET /v1/memberships` returns. It used to require `per_page` and failed with
  `UNKNOWN_ERROR` on every real response. The returned `MembershipPage` still
  exposes it as `per_page`.
