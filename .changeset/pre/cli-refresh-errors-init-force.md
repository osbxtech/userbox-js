---
"@userbox/cli": patch
---

A failed token refresh no longer always reads as `SESSION_EXPIRED`. Only a refresh token the API rejects (401 `INVALID_REFRESH_TOKEN`: expired, revoked or already used) means the login is over. Any other 4xx keeps the API's code and message, with a hint that a new login will not fix it. `init --force` now finds the API key it replaces (by its public prefix; the secret is never sent) and, at a terminal, offers to revoke it. With `--json` or without a terminal it never revokes: it warns and reports the key in `replacedApiKey` (`id`, `name`, `prefix`, `revoked`).
