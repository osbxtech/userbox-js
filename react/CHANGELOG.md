# Changelog

All notable changes to `@userbox/react` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0-alpha.2] — 2026-11-03

### Security
- `userboxMiddleware` now deletes the incoming access-token header
  (`x-userbox-access-token`, or `accessTokenHeader`) on every path before it
  forwards the request: no refresh cookie, failed refresh, malformed refresh
  response, and success (which then sets the refreshed token). Before, a request
  without a refresh cookie passed a client-supplied header through to Server
  Components unchanged.

### Changed (breaking)
- `getSession()` from `@userbox/react/nextjs` is renamed
  `getUnverifiedSession()`. It decodes the forwarded token without verifying its
  signature, and the old name made it look like an authorization source. It now
  also returns `null` for an expired token, and takes an optional
  `{ accessTokenHeader }` matching the middleware's option. Authorize on the
  server by verifying the Bearer token against the JWKS.

### Added
- Next.js 16 support: `peerDependencies.next` accepts `^16.0.0`, so the package
  installs in a fresh `create-next-app` app. The README shows the Next 16
  `proxy.ts` convention next to `middleware.ts`.

### Docs
- Links and examples use the live `test` environment:
  `https://docs.test.userbox.app` and `baseUrl: "https://api.test.userbox.app"`.

## [1.0.0-alpha.1] — 2026-11-02

### Fixed
- `@userbox/react/nextjs` now loads in plain Node ESM. It imports
  `next/server.js` and `next/headers.js` instead of the extensionless
  `next/server` and `next/headers`; `next` has no `exports` map, so the
  extensionless imports failed with `ERR_MODULE_NOT_FOUND`, and TypeScript
  reported TS2307 under `moduleResolution: nodenext` without `skipLibCheck`.
  Next.js apps were not affected: the Next bundler resolves both forms.

## [1.0.0-alpha.0] — 2026-05-18

Initial alpha. Public surface frozen for the V1 scope.

### Added
- `UserboxProvider` — bootstraps the session, owns the proactive 12-minute
  refresh timer, exposes session + permission state to descendants.
- Hooks: `useSession`, `usePermissions`, `usePermission`, `useSignIn`,
  `useSignUp`, `useSignOut`.
- `<UserboxCallback>` — consumes `access_token` / `refresh_token` from the
  URL fragment, validates state nonce, scrubs the URL.
- Next.js App Router subpath `@userbox/react/nextjs`:
  - `userboxMiddleware(config)` — Edge middleware that refreshes the access
    token and rotates the refresh cookie.
  - `getSession()` — Server Components helper.
- Storage strategies: `memory` (closure-scoped) and `cookie` (httpOnly,
  managed by tenant backend).
- Cross-tab refresh coordination via `BroadcastChannel` with 200ms claim
  window.
- Single-flight refresh coalescing + permanent-fail latch + transient
  retry policy (1s/3s/9s).
- `UserboxError` tagged union with type guard.
- Architectural tests enforcing: no React/Next imports from `core/`, no
  `localStorage`/`sessionStorage` writes for credentials, no
  `accessToken` in the React entry's `.d.ts`, `usePermission` JSDoc
  carries the literal "UI HINTS ONLY" disclaimer.

### Known limitations
- Refresh-token rotation race on browser crash (documented).
- External-tenant `<UserboxCallback>` depends on an auth-surface
  prerequisite tracked separately.
- No Vue / Svelte adapters in V1.
