# @userbox/node

> **Alpha.** The API may change before 1.0.0. Install the alpha channel explicitly:
>
>     npm install @userbox/node@alpha
>
> Docs: https://docs.test.userbox.app · Source: https://github.com/osbxtech/userbox-js/tree/main/node
>
> `test` is the only live environment today: use `https://api.test.userbox.app` as `baseUrl`.

TypeScript SDK for the Userbox identity & authorization platform. Six methods, one client, two server helpers (`verifyRequest()` and a deny-on-error `can()`), zero runtime dependencies, Node 18+ (Node 20+ for `verifyRequest()`), dual ESM + CJS.

If you can get from `npm install` to a typed `boolean` returned by `client.can(...)` in under fifteen minutes you have used the SDK correctly.

---

## Install

```bash
npm install @userbox/node@alpha
# or:  pnpm add @userbox/node@alpha
# or:  yarn add @userbox/node@alpha
```

Zero runtime dependencies. The SDK uses the global `fetch`, `URL`, `Headers` and, for token verification, Web Crypto (`crypto.subtle`) — nothing else is pulled in. You do not need `jose`.

---

## Prerequisites

- Node 18+ (Node 20+ for `verifyRequest()`, which needs the global Web Crypto API)
- A Userbox **tenant ID** (UUID) — visible in the console under *Tenant settings*
- A Userbox **API key** with the scopes you need:
  - `users:read` for `getUser(...)`
  - `workspaces:read` for `getWorkspace(...)`
  - `workspaces:write` for `createWorkspace(...)`
  - `memberships:read` for `getUserMemberships(...)`
  - `access:check` for `can(...)` and `getUserPermissions(...)`
  - For `getAuditLogs(...)` you need a JWT, **not** an API key (see [JWT-bearing client](#jwt-bearing-client))

Mint an API key via `POST /v1/api-keys` or via the console. The plaintext key is shown exactly once at creation — store it in a secret manager.

---

## First call

```ts
import { UserboxClient } from "@userbox/node";

const client = new UserboxClient({
  apiKey: process.env.USERBOX_API_KEY!,    // ub_live_…
  tenantId: process.env.USERBOX_TENANT_ID!,
  baseUrl: "https://api.test.userbox.app",
});

const allowed = await client.can({
  userId: "01HX…",
  workspaceId: "01HY…",
  permission: "finance.payables.approve",
});

console.log(allowed); // true | false
```

That is the entire integration. No `fetch` plumbing, no header construction, no error parsing.

---

## Server helpers: authenticate and authorize a request

Two functions cover what every protected route needs. Both read their
configuration from the environment, so a route handler needs no setup file:

| Variable | Used by |
|---|---|
| `USERBOX_API_URL`, or `NEXT_PUBLIC_USERBOX_API_URL` | both (`https://api.test.userbox.app` today) |
| `USERBOX_TENANT_ID` (the tenant **UUID**) | both |
| `USERBOX_API_KEY` (scope `access:check`) | `can()` |

```ts
// app/api/workspaces/[workspaceId]/projects/[projectId]/route.ts (Next.js App Router)
import { can, verifyRequest } from "@userbox/node";

export async function DELETE(req: Request, ctx: { params: Promise<{ workspaceId: string; projectId: string }> }) {
  const user = await verifyRequest(req);
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { workspaceId } = await ctx.params;
  if (!(await can({ userId: user.userId, workspaceId, permission: "projects.delete" }))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  // ...
}
```

### `verifyRequest(req, options?)` → `Promise<VerifiedUser | null>`

Reads `Authorization: Bearer <access token>` from a `Request` (or a `Headers`
object, such as `await headers()` in a Server Component) and verifies it:

- the signature is **RS256 only**, against `{apiUrl}/.well-known/jwks.json`.
  The algorithm is fixed in code; a token whose header says anything else is
  rejected before a key is used;
- `exp` (required) and `nbf` (if present), with 5 seconds of clock tolerance;
- `sub` and `tid` are required, and `tid` must equal `USERBOX_TENANT_ID`.
  Userbox tokens carry no `iss`/`aud`: `tid` is the tenant binding.

It returns `{ userId, tenantId, expiresAt }`, or `null` for a missing header or
any failure. **It never throws.** The key set is cached per API URL for
10 minutes; a token with an unknown `kid` refetches it at most once every
30 seconds (key rotation).

`verifyAccessToken(token, options?)` does the same for a token you already hold.

Options: `apiUrl`, `tenantId`, `clockToleranceSec`, and `onError(err)`, which
receives the reason a present token was rejected (`TOKEN_EXPIRED`,
`INVALID_SIGNATURE`, `TENANT_MISMATCH`, `UNKNOWN_KEY`, …). Without `onError`,
only problems that are not the caller's fault are printed with `console.warn`:
`CONFIG_ERROR` (a missing variable) and `JWKS_UNAVAILABLE`.

### `can({ userId, workspaceId, permission }, options?)` → `Promise<boolean>`

The deny-on-error permission check. It returns `true` only when Userbox answers
`allowed: true`. **Every error returns `false`**: a missing variable, a bad API
key or scope (401/403), an unknown workspace (404), an invalid permission key
(422), a rate limit, a server error, a network failure or an unexpected
response. Empty arguments return `false` without a request. It never throws.

Each error-caused denial is reported once through `options.onError(err)`, or by
default with a `console.warn` line that holds the error code, the status and
the platform message (never the API key). Pass `options.client` to use your own
`UserboxClient`; otherwise one client is built from the environment.

Use `client.can()` instead when your code must tell "denied" from "the check
failed" (it throws `UserboxError`).

### Environment defaults for `UserboxClient`

Every constructor field is optional: `new UserboxClient()` reads
`USERBOX_API_KEY`, `USERBOX_TENANT_ID` and `USERBOX_API_URL` /
`NEXT_PUBLIC_USERBOX_API_URL`. A missing key or tenant id throws `UserboxError`
`CONFIG_ERROR` from the constructor.

---

## CommonJS

The same package, the same types, dual emit:

```js
const { UserboxClient } = require("@userbox/node");

const client = new UserboxClient({
  apiKey: process.env.USERBOX_API_KEY,
  tenantId: process.env.USERBOX_TENANT_ID,
});
```

---

## Self-hosted

```ts
const client = new UserboxClient({
  apiKey: "...",
  tenantId: "...",
  baseUrl: "https://userbox.internal.acme.com",
});
```

Trailing slashes on `baseUrl` are tolerated. The default `baseUrl` is the future production API, `https://api.userbox.app`, which is not live yet: set `baseUrl: "https://api.test.userbox.app"` for now.

---

## All seven methods

```ts
// 1. Identity — GET /v1/users/{id}
const user = await client.getUser("01HX…");
// → UserResponse { id, email, full_name, status, ... }

// 2. Workspace — GET /v1/workspaces/{id}
const workspace = await client.getWorkspace("01HY…");
// → WorkspaceResponse { id, name, slug, status, ... }

// 2b. Workspace for a new customer — POST /v1/workspaces (scope workspaces:write)
//     Creates the workspace and its first member in one call. Safe to retry:
//     the same externalId, owner and role return the existing workspace.
const ws = await client.createWorkspace({
  name: "Acme Inc",
  externalId: company.id,          // your own id for the customer
  ownerUserId: "01HX…",            // Userbox user id of the first member
  ownerRole: "admin",              // a role from the environment catalogue
});
// → { id, slug, externalId, created }   created: false on an identical retry

// 3. Membership listing — GET /v1/memberships?user_id=…
const page = await client.getUserMemberships({
  userId: "01HX…",
  page: 1,
  perPage: 50,
});
// → MembershipPage { data: [...], total, page, per_page }

// 4. Resolved permission set — GET /v1/access/permissions
//    One call replaces N can() loops.
const perms = await client.getUserPermissions({
  userId: "01HX…",
  workspaceId: "01HY…",
});
// → ["finance.payables.approve", "finance.reports.view", ...]

// 5. Single access check — POST /v1/access/check
const allowed = await client.can({
  userId: "01HX…",
  workspaceId: "01HY…",
  permission: "finance.payables.approve",
});
// → true | false

// 6. Audit logs — GET /v1/audit-logs (JWT-only, see below)
const audit = await client.getAuditLogs({
  action: "api_key.created",
  from: "2026-04-01T00:00:00Z",
  to: "2026-05-01T00:00:00Z",
});
// → AuditLogPage { data: [...], total, page, per_page }
```

Method argument keys are camelCase (`perPage`, `targetType`, `userId`). The SDK translates to the platform's snake_case query keys at the wire boundary; response field names inside each item are forwarded verbatim from the platform (snake_case).

---

## Error handling

Every non-2xx HTTP response and every `fetch` rejection surfaces as a thrown `UserboxError`. It is the base class of the shared taxonomy, so `instanceof UserboxError` catches all of them:

| Class | When |
|-------|------|
| `UserboxAuthError` | 401, 403 (`INSUFFICIENT_SCOPE`, invalid key or token) |
| `UserboxNotFoundError` | 404 (`USER_NOT_FOUND`, `ROLE_NOT_FOUND`, …) |
| `UserboxConflictError` | 409 (`WS_EXTERNAL_ID_CONFLICT`, `WS_SLUG_CONFLICT`; `existingWorkspaceId` when that workspace is in the key's environment) |
| `UserboxRateLimitError` | 429 |
| `UserboxServerError` | 5xx |
| `UserboxNetworkError` | `fetch` rejected (status 0) |
| `UserboxConfigError` | missing API key or tenant id (status 0) |
| `UserboxError` | anything else: 400, 422, an unexpected response shape |

```ts
import { UserboxClient, UserboxConflictError, UserboxError } from "@userbox/node";

try {
  await client.createWorkspace({ name, externalId, ownerUserId, ownerRole: "admin" });
} catch (err) {
  if (err instanceof UserboxConflictError && err.existingWorkspaceId) {
    // This externalId already belongs to another owner: link to err.existingWorkspaceId
  } else if (err instanceof UserboxError) {
    // err.status, err.code, err.message
  } else {
    throw err;
  }
}
```

`UserboxError` shape:

```ts
{
  status: number;   // HTTP status, or 0 for NETWORK_ERROR
  code: string;     // platform code ("INSUFFICIENT_SCOPE", …) or "UNKNOWN_ERROR" / "NETWORK_ERROR"
  message: string;  // human-readable; NEVER contains apiKey or tenantId
}
```

The SDK does not retry, back off, or rate-limit. One method call ⇒ one fetch ⇒ one resolved promise.

---

## JWT-bearing client

`getAuditLogs(...)` is administrator-grade. The platform endpoint accepts JWTs only — any API-key caller receives `403 INSUFFICIENT_SCOPE`. Pass the JWT in the `apiKey` slot:

```ts
const adminClient = new UserboxClient({
  apiKey: jwtFromAdminLogin,   // not "ub_live_..." — a JWT
  tenantId: "01HZ…",
});

const audit = await adminClient.getAuditLogs({
  action: "api_key.created",
});
```

The constructor field is named `apiKey` for ergonomics; the SDK forwards the value verbatim in the `Authorization: Bearer …` header and does not inspect the format. The platform enforces the JWT requirement — calling `getAuditLogs` with an API-key-bearing client surfaces the platform's `403` as a thrown `UserboxError`.

---

## TypeScript

The SDK is shipped with first-class `.d.ts` and assumes you have:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "Bundler",  // or "NodeNext"
    "target": "ES2022"
  }
}
```

With `strict: true` the SDK rejects at compile time:

- Calls with missing required arguments
- Calls with wrong-typed arguments
- Access to non-existent fields on response shapes

No `any` leaks from the SDK's public surface.

---

## Tree-shaking

`@userbox/node` declares `"sideEffects": false`. ESM consumers using a tree-shaking bundler (Vite, esbuild, Rollup, webpack 5+) only pay for the symbols they actually `import`. Importing only `UserboxError` excludes the client class.

---

## What the SDK does NOT do (V1)

- **No retry / backoff** — wrap your own logic if you need it
- **No telemetry** — the SDK never phones home
- **No `console.*` output from the client** — only `can()` and `verifyRequest()` print a `console.warn` line, for errors that deny a request, unless you pass `onError`
- **No browser support** — Node 18+ only; a browser SDK is a future spec
- **No streaming / WebSockets** — request/response only
- **No webhook signature helpers** — separate spec
- **No per-call credential override** — instantiate a new `UserboxClient` per credential
- **No runtime field validation** — the SDK trusts the platform's 2xx response shapes

---

## License

See the repository root.
