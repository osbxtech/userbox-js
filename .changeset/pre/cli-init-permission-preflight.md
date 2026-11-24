---
"@userbox/cli": patch
---

`init` checks your console permissions before it changes anything. When your login lacks one that this run needs (`userbox.console.access` to read the redirect domains, `userbox.tenant.manage` to add one, `userbox.api_keys.manage` to create the API key), it lists every missing permission with what it is for, says to ask a tenant owner to tick it in Console → Users → Edit, and exits with `MISSING_PERMISSIONS` without writing anything (with `--json`: `missing_permissions: [{key, purpose, description}]`). Reading your own permissions needs `userbox.users.read`; without it `init` goes on as before. Every command now names the missing permission in a 403 `INSUFFICIENT_PERMISSION`, says what it is needed for and adds the same hint, and reads API errors shaped `{detail: {code, error}}` as well as `{code, error}`.
