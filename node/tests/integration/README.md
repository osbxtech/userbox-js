# Integration tests

`client.integration.test.ts` calls every `UserboxClient` method against a live
Userbox API. The suite is **skipped by default**. It runs when all of these are
set:

| Variable | Value |
|----------|-------|
| `USERBOX_API_URL` | base URL of the API |
| `USERBOX_TEST_TENANT_SLUG` | a tenant that holds synthetic data only |
| `USERBOX_TEST_USER_EMAIL` | a synthetic user in that tenant |
| `USERBOX_TEST_USER_PASSWORD` | that user's password |
| `USERBOX_TEST_API_KEY` | an API key of that tenant |

```bash
pnpm --filter @userbox/node test:integration
```

## What the tenant must hold

The suite discovers ids at run time and needs no other configuration:

- the user has at least one membership, and at least one permission in that
  membership's workspace;
- the API key has **exactly** these scopes, and no write scope:
  - `access:check` for `can()` and `getUserPermissions()`;
  - `users:read` for `getUser()`;
  - `workspaces:read` for `getWorkspace()`;
  - `memberships:read` for `getUserMemberships()`;
- the user holds `userbox.audit_logs.read` in that tenant only.

`getAuditLogs()` is JWT-only: no API-key scope exists for it. The suite asserts
that the API key gets `403 INSUFFICIENT_SCOPE` (which also proves the key is
least-privilege) and that the user's own JWT gets `200`.

## In CI

The `integration` workflow runs the suite on every push to `main` and inside
every release, against the dedicated `sdk-ci` tenant on the Userbox test
platform. The values come from the `integration` GitHub environment, which only
`main` can use: pull requests, including those from forks, never see them. CI
sets `USERBOX_INTEGRATION_REQUIRED=1`, so a missing variable fails the run
instead of skipping it.

## Rules

- Never use a real person's account or a production tenant.
- A failure prints the HTTP status and the error code only, never a header, a
  token, a key, a response body or an SDK error message (`safe-assert.ts`).
  `tests/credentials-not-logged.unit.test.ts` keeps proving that the SDK itself
  never puts the key in an error.
