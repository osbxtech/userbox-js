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
```

## For coding agents

Every command takes `--json` and exits non-zero with `{ "ok": false, "error": { "code", "message", "hint" } }`.
Secrets never pass through the model:

- `login` refuses to run without an interactive terminal. If a command fails
  with `NOT_LOGGED_IN`, `SESSION_EXPIRED` or `NEEDS_HUMAN`, ask the human to
  run `npx @userbox/cli login` in their own terminal.
- `init` writes the API key straight to `.env.local` and never prints it.
- `apply` without `--yes` only prints the plan when there is no terminal: show
  it to the human, then run `apply --yes`. A plan that removes permissions from
  an existing role fails with `NEEDS_HUMAN` even with `--yes`: the human runs
  `npx @userbox/cli apply` in their own terminal.

## Commands

| Command | What it does |
|---|---|
| `login` | Logs in as a tenant admin (a user with console access). Stores the session in `~/.config/userbox/credentials.json`, mode 600. `--api-url` picks another API. |
| `logout` / `whoami` | Forget / show the login. |
| `init` | Needs Next.js with `app/` or `src/app/`. Adds the `--origin` host (default `http://localhost:3000`) to the allowed redirect domains, creates an API key with `access:check`, `memberships:read`, `workspaces:read` unless `.env.local` already has one, merges the five variables into `.env.local` without touching existing values (`--force` replaces them), makes sure `.env.local` is git-ignored, installs `@userbox/react@alpha` and `@userbox/node@alpha` (`--skip-install` skips it), and writes `providers.tsx`, `auth/callback/page.tsx` and `api/auth/refresh/route.ts` if they do not exist. It wraps `{children}` in the root layout with `<Providers>` when that edit is unambiguous. |
| `apply` | Reads `userbox.yaml`, creates missing permissions, and makes every declared role in every active workspace hold exactly its listed permissions. Permissions and roles that are not in the file are reported, never deleted. Removing a permission from an existing role needs a human at a terminal, even with `--yes`. |
| `dev seed` | Creates (or reuses) the workspace `dev`, syncs `userbox.yaml` into it and gives you the `admin` role. `--invite email[:role]` invites more users by email (role defaults to `member`). Warns when the default environment is a production environment. |
| `doctor` | Checks the project, SDK versions, auth files, `.env.local`, secrets in `NEXT_PUBLIC_*`, `.gitignore`, the API and JWKS, the API key's tenant and `access:check` scope, and, when logged in, the redirect domain and sign-up mode. Exits 1 when a check fails. |

## `userbox.yaml`

```yaml
permissions: [projects.read, projects.create, projects.delete]
roles:
  admin:  [projects.*]
  member: [projects.read, projects.create]
```

Permission keys have 2 to 5 lowercase segments separated by dots. `prefix.*`
expands to every declared permission with that prefix. Roles live in
workspaces: run `userbox apply` again after creating a workspace.

## License

Apache-2.0
