---
"@userbox/cli": minor
---

`init --workspaces-write` (or answering yes to "Will your backend create a workspace per customer?" at a terminal) adds the `workspaces:write` scope to the API key it creates, for a backend that calls `createWorkspace()` from `@userbox/node`; agents (`--json`, no terminal) are never asked, and the `--json` result has `apiKeyScopes`. `dev seed` takes role ids from the environment's role catalogue (`GET /v1/roles`) and assigns them to memberships directly; it no longer creates or reads roles per workspace, so the CLI makes no calls to the deprecated `/v1/workspaces/{id}/roles` routes.
