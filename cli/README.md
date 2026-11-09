# `@userbox/cli`

The Userbox command-line tool, binary `userbox`. It sets up
[Userbox](https://docs.test.userbox.app) in a Next.js App Router app: allowed
redirect domain, API key, `.env.local`, SDKs and the auth files. It then keeps
permissions and roles in sync with a `userbox.yaml` in your repository.

Status: alpha, `test` environment only. The unscoped npm name `userbox` belongs
to an unrelated third party; the CLI is only published as `@userbox/cli`.

```bash
npx @userbox/cli login      # a human, once: tenant slug, email, password
npx @userbox/cli init       # in the app root
npx @userbox/cli apply      # sync userbox.yaml
npx @userbox/cli dev seed   # a dev workspace where you are admin
npx @userbox/cli doctor     # check everything
npx @userbox/cli doctor --go-live   # before launch: no dev leftovers in production
```

## For coding agents

Every command takes `--json` and exits non-zero with `{ "ok": false, "error": { "code", "message", "hint" } }`.
Secrets never pass through the model:

- `login` refuses to run without an interactive terminal. If a command fails
  with `NOT_LOGGED_IN`, `SESSION_EXPIRED` or `NEEDS_HUMAN`, ask the human to
  run `npx @userbox/cli login` in their own terminal. `SESSION_EXPIRED` means
  the API rejected the stored login (expired, revoked or already used). Any
  other error while refreshing keeps the API's own code and message: report
  it, a new login will not fix it.
- `login` fails with `INVALID_CREDENTIALS` for an unknown email, a wrong
  password or an unknown tenant slug alike. The error carries `signup_url`
  (also at the top level of the `--json` document): a founder with no account
  creates one there, in a browser. The CLI never creates accounts.
- `init` writes the API key straight to `.env.local` and never prints it.
- `apply` without `--yes` only prints the plan when there is no terminal: show
  it to the human, then run `apply --yes`. A plan that removes permissions from
  an existing role fails with `NEEDS_HUMAN` even with `--yes`: the human runs
  `npx @userbox/cli apply` in their own terminal.
- `--env <name>` with an unknown name fails with `UNKNOWN_ENVIRONMENT`; the
  hint and the `--json` error (`environments`, at the top level) list the
  tenant's environments. Without `--env` every command uses the default one.
  `init --env` also adds the redirect domain to that environment and names it
  in `.env.local` (see [Environments](#environments)).
- `doctor --go-live` adds `goLive: { environment, ready }` to the `--json`
  result; its findings are `warn` checks, so the exit code stays 0. Show them
  to the human before launch: removing a redirect domain or archiving a
  workspace is a console action.

## Commands

| Command | What it does |
|---|---|
| `login` | Logs in as a tenant admin (a user with console access). Stores the session in `~/.config/userbox/credentials.json`, mode 600. `--api-url` picks another API. |
| `logout` / `whoami` | Forget / show the login. |
| `init` | Creates the API key in the default environment, or the one named by `--env`. Needs Next.js with `app/` or `src/app/`. Adds the `--origin` host (default `http://localhost:3000`) to the allowed redirect domains of that same environment, and with `--env` writes its slug to `NEXT_PUBLIC_USERBOX_ENVIRONMENT` (always updated, even without `--force`) so `<UserboxProvider environment>` names it on hosted sign-in. Creates an API key with `access:check`, `memberships:read`, `workspaces:read` (plus `workspaces:write` with `--workspaces-write`, or when you answer yes to "Will your backend create a workspace per customer?" at a terminal) unless `.env.local` already has one, merges the five variables into `.env.local` without touching existing values (`--force` replaces them), makes sure `.env.local` is git-ignored, installs `@userbox/react@alpha` and `@userbox/node@alpha` (`--skip-install` skips it), and writes `providers.tsx`, `auth/callback/page.tsx` and `api/auth/refresh/route.ts` if they do not exist. It wraps `{children}` in the root layout with `<Providers>` when that edit is unambiguous. |
| `apply` | Reads `userbox.yaml`, creates missing permissions, and makes every declared role in the environment's role catalogue (default environment, or `--env`) hold exactly its listed permissions. A declared role that already exists in the console is taken over by the file. Permissions and roles that are not in the file are reported ("exists only in the console (kept)"), never deleted. Removing a permission from a role needs a human at a terminal, even with `--yes`. |
| `dev seed` | Creates (or reuses) the workspace `dev` in the default environment or the one named by `--env`, syncs `userbox.yaml` into the environment's role catalogue and gives you its `admin` role. `--invite email[:role]` invites more users by email (role defaults to `member`). Warns when that environment is a production environment. |
| `doctor` | Checks the project, SDK versions, auth files, `.env.local`, secrets in `NEXT_PUBLIC_*`, `.gitignore`, the API and JWKS, the API key's tenant and `access:check` scope, and, when logged in, the redirect domain of the environment the project names (`NEXT_PUBLIC_USERBOX_ENVIRONMENT`, else the default one) and the sign-up mode of the default environment. It warns when `.env.local` names an environment that the Providers file does not pass, and fails when the tenant has no such environment. `--go-live` also checks the production environment: it warns about `localhost` / `127.0.0.1` redirect domains and about the `dev` workspace that `dev seed` creates. Exits 1 when a check fails; warnings do not fail. |

## Environments

A new tenant has one environment, production, and it is the default: `init`,
`apply` and `dev seed` use it unless you pass `--env`, so the first run works
with no setup. To keep the API key, roles and dev data out of production,
create a development or staging environment in the console and pass its slug,
name or type:

```bash
npx @userbox/cli init --env development       # API key and localhost in development
npx @userbox/cli apply --env development
npx @userbox/cli dev seed --env development
```

`init --env development` adds `localhost` to **development's** redirect
domains and writes `NEXT_PUBLIC_USERBOX_ENVIRONMENT=development`; the
scaffolded `providers.tsx` passes it as `<UserboxProvider environment>`.
Hosted sign-in then checks the return address against development's list, so
production's list can stay free of `localhost`. Sign-in, users and tokens stay
tenant-wide. A `providers.tsx` written by an older CLI lacks the prop: `init`
and `doctor` say so; add
`environment={process.env.NEXT_PUBLIC_USERBOX_ENVIRONMENT}` by hand. Needs
`@userbox/react` with the `environment` option.

Limits for now:

- Permission keys are unique per tenant, not per environment: `apply --env`
  reuses a permission that already exists in another environment.
- `init --env` reuses an existing `USERBOX_API_KEY` in `.env.local` unless you
  pass `--force`, and warns that it may belong to another environment.
- `init --force` replaces the API key and leaves the replaced one active. At a
  terminal it asks whether to revoke the replaced key. With `--json` or without
  a terminal it never revokes: it warns and reports the key in `replacedApiKey`
  (`id`, `name`, `prefix`, `revoked`). Revoke it in the console once nothing
  uses it.

Before going live, `npx @userbox/cli doctor --go-live` lists what the
default flow left in production: `localhost` redirect domains and the `dev`
workspace. Removing `localhost` from production does not affect a project set
up with `init --env development`; a local app that names no environment uses
the default environment's list and stops signing in once it is gone.

## `userbox.yaml`

```yaml
permissions: [projects.read, projects.create, projects.delete]
roles:
  admin:  [projects.*]
  member: [projects.read, projects.create]
```

Permission keys have 2 to 5 lowercase segments separated by dots. `prefix.*`
expands to every declared permission with that prefix.

Roles live in the environment's role catalogue and every workspace uses them,
so a new workspace needs no `apply`. Role names match the console
case-insensitively. Roles declared here are marked as managed by
`userbox.yaml`; `apply` keeps their platform (internal) permissions as they
are.

## License

Apache-2.0
