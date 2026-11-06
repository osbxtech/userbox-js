---
"@userbox/cli": patch
---

`--env <name>` on `init`, `apply` and `dev seed` targets another environment (slug, name or type, e.g. `development`) for the API key, the synced roles and the `dev` workspace; the default environment stays the default. An unknown name fails with `UNKNOWN_ENVIRONMENT` and lists the available environments. The redirect domain still goes to the default environment, the only one hosted sign-in reads, and `init` warns when that differs from `--env`. `doctor --go-live` warns about `localhost` / `127.0.0.1` redirect domains and the `dev` workspace in the production environment, and adds `goLive` to the `--json` result.
