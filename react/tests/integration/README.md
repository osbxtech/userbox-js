# Integration tests

These tests exercise the SDK against a running Userbox API. They are
**skipped by default**. Set the following environment variables to opt in:

- `USERBOX_API_URL`: base URL of the API.
- `USERBOX_TEST_TENANT_SLUG`: the slug of a tenant that holds synthetic data only.
- `USERBOX_TEST_USER_EMAIL` / `USERBOX_TEST_USER_PASSWORD`: a synthetic test
  user that can sign in through `/v1/auth/login` and obtain a refresh token.
- `USERBOX_TEST_ADMIN_TOKEN` (optional): enables the session-revocation test.

## In CI

The `integration` workflow runs this suite on every push to `main` and inside
every release, against the dedicated `sdk-ci` tenant on the Userbox test
platform. The values come from the `integration` GitHub environment, which only
`main` can use: pull requests, including those from forks, never see them.
CI sets `USERBOX_INTEGRATION_REQUIRED=1`, so a missing variable fails the run
instead of skipping every test.

## Against a local stack

The same variables point the suite anywhere, for example a local API:

```bash
USERBOX_API_URL=http://localhost:8000 \
USERBOX_TEST_TENANT_SLUG=acme-test \
USERBOX_TEST_USER_EMAIL=… \
USERBOX_TEST_USER_PASSWORD=… \
pnpm test:integration
```

## Rules

- Never use a real person's account or a production tenant.
- Never print a token, key, password or request header. A failed request is
  reported by HTTP status and error code only (`errorCode()` in
  `fixtures.ts`), and tokens are compared as booleans, so a failing assertion
  cannot print them.
