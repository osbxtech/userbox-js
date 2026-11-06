# Changelog

All notable changes to `@userbox/cli` are documented in this file.

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
