# End-to-end tests (Playwright)

This directory holds the cross-subdomain auth-flow coverage for
`@userbox/react`. The suite needs a running Userbox stack (the API and the
hosted auth surface) plus `e2e/sample-next-app/`, a minimal Next.js consumer.
It is not part of `pnpm test` and does not run in this repository's CI.

## Running

```bash
pnpm --filter @userbox/react build
pnpm --dir e2e/sample-next-app dev &
pnpm --filter @userbox/react exec playwright test
```

The Playwright config expects `acme-test.userbox.localhost` to serve the auth
surface and `app.userbox.localhost:3001` to serve the sample app, so that the
flows cross subdomains as they do in production. `.localhost` names resolve to
the loopback address in most browsers; otherwise add them to `/etc/hosts`:

```
127.0.0.1 acme-test.userbox.localhost
127.0.0.1 app.userbox.localhost
```

`USERBOX_E2E_APP_URL` overrides the sample app's URL.
