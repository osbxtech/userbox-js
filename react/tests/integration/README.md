# Integration tests

These tests exercise the SDK against a running Userbox API (and, for the cookie
strategy, an optional tenant backend proxy). They are **skipped by default**.
Set the following environment variables to opt in:

- `USERBOX_API_URL`: base URL of the API (e.g. `http://localhost:8000`).
- `USERBOX_TEST_TENANT_SLUG`: a tenant slug seeded for tests (e.g. `acme-test`).
- `USERBOX_TEST_USER_EMAIL` / `USERBOX_TEST_USER_PASSWORD`: a synthetic test
  user that can sign in through `/v1/auth/login` and obtain a refresh token.

Run:

```bash
USERBOX_API_URL=http://localhost:8000 \
USERBOX_TEST_TENANT_SLUG=acme-test \
USERBOX_TEST_USER_EMAIL=… \
USERBOX_TEST_USER_PASSWORD=… \
pnpm test:integration
```

Never use a real person's account or a production tenant.
