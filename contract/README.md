# Contract manifest

`calls.json` lists every HTTP call each SDK makes to the Userbox API. It is the
SDKs' side of the contract with the platform.

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
- **Compatibility** (coming with the release gates): a script compares every
  entry with the published tenant API description: the operation exists, the
  required parameters are sent, and the fields read are in the 2xx schema.

When you add or change a call, update `calls.json` in the same pull request.
