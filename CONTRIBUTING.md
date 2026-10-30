# Contributing

Thanks for helping improve the Userbox SDKs.

## Setup

```bash
nvm use            # Node 24, from .nvmrc
corepack enable    # pnpm, pinned in package.json
pnpm install
```

## Checks

Every pull request must pass:

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm check:pack
pnpm check:contract && pnpm test:scripts
```

CI runs the same commands on every pull request, including pull requests from
forks, plus the changeset rule below. CI never has access to secrets. The
integration suite, which needs a test-tenant credential, runs only on `main`
(see `react/tests/integration/README.md` and `node/tests/integration/README.md`).

## Rules

- **Changesets are required.** A pull request that changes `react/src/` or
  `node/src/` records the change and its bump type with a changeset
  (`pnpm changeset`). CI fails such a pull request without one. A change that
  releases nothing can use an empty changeset (`pnpm changeset --empty`). See
  [.changeset/README.md](.changeset/README.md).
- **The SDK author contract is non-negotiable.** Read
  [docs/sdk-author-contract.md](docs/sdk-author-contract.md) before changing
  token handling, refresh, errors or HTTP conventions.
- **New HTTP calls go into `contract/calls.json`.** An architectural test fails
  when an SDK calls a `/v1/...` path that the manifest does not list, and
  `pnpm check:contract` fails when a listed call does not match the tenant API
  description in `contract/tenant-openapi.json`.
- **No new runtime dependencies** without an issue that discusses why.
- **No real credentials anywhere**, including tests and examples. Use obviously
  fake values.

A Developer Certificate of Origin sign-off is not required.

## Reporting security issues

Never in a public issue or pull request. See [SECURITY.md](SECURITY.md).
