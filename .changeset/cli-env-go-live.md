---
"@userbox/cli": patch
---

`--env <name>` on `init`, `apply`, `dev seed` and `doctor` targets another environment (slug, name or type, e.g. `development`) for the API key, the redirect domain, the synced roles and the `dev` workspace; the default environment stays the default. An unknown name fails with `UNKNOWN_ENVIRONMENT` and lists the available environments. `doctor --go-live` warns about `localhost` / `127.0.0.1` redirect domains and the `dev` workspace in the production environment, and adds `goLive` to the `--json` result.
