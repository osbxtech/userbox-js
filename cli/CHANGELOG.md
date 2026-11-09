# Changelog

All notable changes to `@userbox/cli` are documented in this file.

## [0.1.0-alpha.6] — 2026-11-09

### Fixed
- `login` no longer says the login "lasts 7 days of inactivity". It reads the
  default environment's session duration and says the login expires after that
  long without use (24 hours by default; the API caps it at 7 days). If the
  setting cannot be read, the message names no number.
- A token refresh that failed in transit (network error or 5xx) is retried
  once, with the same refresh token. The Userbox API replays the same rotated
  pair for a short grace window, so a response lost during a rollout no longer
  ends the login. A 4xx is never retried.

## [0.1.0-alpha.5] — 2026-11-09

### Added
- `init --env <name>` adds the redirect domain to that environment instead of
  the default one, and writes its slug to `NEXT_PUBLIC_USERBOX_ENVIRONMENT` in
  `.env.local`; the scaffolded `providers.tsx` passes it as
  `<UserboxProvider environment>`. `init` warns when an existing Providers file
  lacks the prop, and when `.env.local` names an environment but `init` ran
  without `--env`.

### Changed
- `doctor` checks the redirect domain in the environment the project names
  (sign-up mode still comes from the default one), warns when the Providers
  file does not pass it or `@userbox/react` is older than `1.0.0-alpha.5`, and
  fails when the tenant has no such environment. `doctor --go-live` no longer
  says that removing `localhost` from production breaks local sign-in for a
  project on another environment.
- `init --force` finds the API key it replaces (by its public prefix; the
  secret is never sent) and, at a terminal, offers to revoke it. With `--json`
  or without a terminal it never revokes: it warns and reports the key in
  `replacedApiKey` (`id`, `name`, `prefix`, `revoked`).

### Fixed
- A failed token refresh no longer always reads as `SESSION_EXPIRED`. Only a
  refresh token the API rejects (401 `INVALID_REFRESH_TOKEN`: expired, revoked
  or already used) means the login is over. Any other 4xx keeps the API's code
  and message, with a hint that a new login will not fix it.

## [0.1.0-alpha.4] — 2026-11-06

### Changed
- `apply` syncs `userbox.yaml` into the environment's role catalogue
  (`/v1/roles`) instead of into each workspace. It lists the roles once,
  creates missing ones with `managed_by: "apply"`, takes over a declared role
  that was created in the console (name matched case-insensitively and set to
  the file's spelling), and converges each role's grants with one
  `PUT /v1/roles/{id}/permissions` after creating the permissions. Platform
  (internal) permissions on a role are kept. Roles that exist only in the
  console are reported as "exists only in the console (kept)" and listed in
  `consoleOnlyRoles`; the `--json` result no longer has `workspaces`. `apply`
  never deletes a role, and removing a grant still needs a human at a
  terminal.
- `dev seed` takes role ids from the catalogue (`GET /v1/roles`) and assigns
  them to memberships directly. The CLI no longer calls the deprecated
  `/v1/workspaces/{id}/roles` routes.

### Added
- `init --workspaces-write`, or a yes to "Will your backend create a
  workspace per customer?" at a terminal, adds the `workspaces:write` scope to
  the API key it creates, for `createWorkspace()` in `@userbox/node`. Agents
  (`--json`, no terminal) are never asked. The `--json` result has
  `apiKeyScopes`.

## [0.1.0-alpha.3] — 2026-11-06

### Added
- `--env <name>` on `init`, `apply` and `dev seed` targets another environment
  (slug, name or type, e.g. `development`) for the API key, the synced roles
  and the `dev` workspace; the default environment stays the default. An
  unknown name fails with `UNKNOWN_ENVIRONMENT` and lists the available
  environments. The redirect domain still goes to the default environment, the
  only one hosted sign-in reads, and `init` warns when that differs from
  `--env`.
- `doctor --go-live` warns about `localhost` / `127.0.0.1` redirect domains
  and the `dev` workspace in the production environment, and adds `goLive` to
  the `--json` result.

### Changed
- `--version` reads the version from `package.json` at build time instead of a
  hard-coded string.

## [0.1.0-alpha.2] — 2026-11-05

### Changed
- `login`: a failed login (`INVALID_CREDENTIALS`, reported the same way for an
  unknown email, a wrong password or an unknown tenant slug) now points to
  founder sign-up. The hint and the `--json` error carry `signup_url`, taken
  from `GET /v1/founder-signup/status`, with `https://auth.<base>/create-account`
  as the fallback.

### Fixed
- `login`: the success message shows where the login was actually stored, so
  it honours `XDG_CONFIG_HOME` instead of always printing
  `~/.config/userbox/credentials.json`.

## [0.1.0-alpha.1] — 2026-11-04

### Changed
- `apply` and `dev seed`: a plan that removes permissions from an existing
  role always needs a human answer at a terminal. `--yes` no longer skips it,
  and without a terminal the command stops with `NEEDS_HUMAN`. Purely additive
  plans still run with `--yes`.

## [0.1.0-alpha.0] — 2026-11-04

### Added
- First release. `userbox login`, `logout`, `whoami`, `init` (Next.js App
  Router), `apply` (`userbox.yaml`), `dev seed` and `doctor`. Every command
  takes `--json` for coding agents.
