# Changelog

All notable changes to `@userbox/react` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0-alpha.6] — 2026-11-09

### Fixed
- The Next.js refresh handler (`createRefreshHandler`) retries the upstream
  token exchange once, with the same refresh token, when the first attempt
  failed in transit (network error or 5xx). The Userbox API replays the same
  rotated pair for a short grace window, so a response lost during a rollout
  no longer ends the session. A 4xx is never retried.

## [1.0.0-alpha.5] — 2026-11-09

### Added
- `UserboxProvider` takes an optional `environment` prop: the slug of the
  tenant environment the app signs in against, for example `development`.
  `useSignIn()` and `useSignUp()` add it to the hosted sign-in and sign-up URLs
  as `environment=<slug>`, and hosted sign-in then checks the return address
  against that environment's allowed redirect domains, so `localhost` can stay
  out of production's list. An empty string counts as omitted; an invalid slug
  throws `misconfigured("environment")`. Without the prop, URLs are unchanged.
  Needs a Userbox platform with environment-aware redirects; an older platform
  ignores the parameter.

## [1.0.0-alpha.4] — 2026-11-04

### Added
- `createRefreshHandler(config?)` in `@userbox/react/nextjs`: the cookie-mode
  refresh route as an SDK export. `app/api/auth/refresh/route.ts` becomes
  `export const { POST } = createRefreshHandler();` instead of ~90 copied
  lines. Same behaviour as the snippet it replaces in the docs: JSON-only and
  `Origin` checks before anything else, `init` / refresh / `logout`, an
  `HttpOnly; SameSite=Strict; Path=/api/auth` cookie (`Secure` on https), the
  rotated refresh token stored on every refresh and never returned, and the
  cookie cleared when Userbox rejects it. Defaults come from
  `NEXT_PUBLIC_USERBOX_API_URL`, `NEXT_PUBLIC_USERBOX_TENANT_SLUG` and
  `APP_ORIGIN`; missing configuration answers 500 `CONFIG_ERROR` at request
  time. Responses carry `Cache-Control: no-store`, and a refresh also returns
  `refresh_expires_in` when Userbox sends it.

## [1.0.0-alpha.3] — 2026-11-03

### Fixed
- With `tokenStorage="cookie"`, the app sometimes stayed signed out after
  hosted sign-in until a manual reload. On the callback page,
  `UserboxProvider`'s mount-time refresh left before the tenant backend had set
  the refresh cookie, came back 401, and cleared the session that
  `<UserboxCallback>` had just adopted. Now:
  - the provider skips its bootstrap refresh when a session was already
    adopted, and ignores the result of a refresh that started before a session
    was adopted (the refresh engine reports it as superseded, without
    `onError` or `onSessionExpired`);
  - `<UserboxCallback>` waits for the cookie `init` request before calling
    `onSuccess`, so a navigation in `onSuccess` happens after the cookie
    exists. If `init` fails, it calls `onError` and not `onSuccess` (before, it
    called both).

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
