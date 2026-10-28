# Changelog

All notable changes to `@userbox/react` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
