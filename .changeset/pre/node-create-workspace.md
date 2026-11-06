---
"@userbox/node": minor
---

`createWorkspace({ name, externalId?, slug?, ownerUserId, ownerRole })` creates a customer's workspace and its first member in one call (`POST /v1/workspaces`, scope `workspaces:write`) and returns `{ id, slug, externalId, created }`; an identical retry returns the existing workspace with `created: false`. Errors now use the shared taxonomy, all subclasses of `UserboxError`: `UserboxAuthError` (401/403), `UserboxNotFoundError` (404), `UserboxConflictError` (409, with `existingWorkspaceId`), `UserboxRateLimitError` (429), `UserboxServerError` (5xx), `UserboxNetworkError` and `UserboxConfigError`. `err.name` is now the subclass name; `instanceof UserboxError` keeps working. The vendored tenant API description is synced to platform commit `bc8b256`.
