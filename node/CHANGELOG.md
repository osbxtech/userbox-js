# Changelog

All notable changes to `@userbox/node` are documented in this file.

## [1.0.0-alpha.0] — 2026-10-28

First alpha. Renamed from the unpublished `@userbox/sdk`; the API is unchanged.

### Fixed
- `getUserMemberships()` reads the page size from `page_size`, the field
  `GET /v1/memberships` returns. It used to require `per_page` and failed with
  `UNKNOWN_ERROR` on every real response. The returned `MembershipPage` still
  exposes it as `per_page`.
