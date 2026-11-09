---
"@userbox/cli": minor
---

`init --env <name>` now adds the redirect domain to that environment instead of the default one, and writes its slug to `NEXT_PUBLIC_USERBOX_ENVIRONMENT` in `.env.local`; the scaffolded `providers.tsx` passes it as `<UserboxProvider environment>`. It warns when an existing Providers file lacks the prop, and when `.env.local` names an environment but `init` ran without `--env`. `doctor` checks the redirect domain in the environment the project names (sign-up mode still from the default one), warns when the Providers file does not pass it, and fails when the tenant has no such environment. `doctor --go-live` no longer says that removing `localhost` from production breaks local sign-in for a project on another environment.
