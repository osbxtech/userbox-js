# Contract

- `calls.json` lists every HTTP call each SDK makes to the Userbox API. It is
  the SDKs' side of the contract with the platform.
- `tenant-openapi.json` is the platform's side: the tenant-facing API
  description, vendored from the deployed platform. `info.x-userbox-platform-commit`
  names the platform commit it came from. Never edit it by hand.

Each entry:

| Field | Meaning |
|-------|---------|
| `package` | `react` or `node`: the SDK that makes the call. |
| `operation` | `<METHOD> <path>`, with path parameters named as the API names them (e.g. `{user_id}`). |
| `sends` | The body or query properties the SDK always sends. Path parameters are implicit. |
| `reads` | The 2xx response fields the SDK relies on. A field the SDK reads only optionally, with a fallback, is not listed. |

## Checks

- **Presence** (now): each package has an architectural test,
  `<package>/tests/architectural/contract-calls.test.ts`. It collects every
  string and template literal in `<package>/src` that contains `/v1/` or
  `/.well-known/`, normalises interpolated path segments to `{param}`, and
  fails when no `calls.json` entry for that package matches the path. A new
  call therefore cannot ship without a manifest entry.
- **Compatibility**: `pnpm check:contract` (`scripts/check-contract.mjs`)
  checks every entry against a tenant API description: the operation exists,
  every required parameter and body property is in `sends`, and every field in
  `reads` is in a 2xx response schema (`$ref` and `allOf` resolved). A problem
  prints `<package> <operation>: <problem>` and exits 1.

| Where | Description checked | Network |
|-------|---------------------|---------|
| `ci.yml`, every pull request | the vendored `tenant-openapi.json` | none |
| `release.yml`, before every release | the deployed one (`USERBOX_TENANT_OPENAPI_URL`) | https only |
| `contract-sync.yml`, daily | the deployed one, when it differs from the vendored copy | https only |

When you add or change a call, update `calls.json` in the same pull request.

## Syncing the vendored description

`contract-sync` opens (or updates) one issue, "contract: sync tenant API
description", when the deployed description differs from the vendored copy,
and fails when the difference breaks a call. It never opens a pull request. A
maintainer syncs by hand:

```bash
USERBOX_TENANT_OPENAPI_URL=https://… pnpm contract:sync   # rewrites tenant-openapi.json
pnpm check:contract
```

and opens a pull request with the new file.
