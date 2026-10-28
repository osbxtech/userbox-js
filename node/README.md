# @userbox/node

> **Alpha.** The API may change before 1.0.0. Install the alpha channel explicitly:
>
>     npm install @userbox/node@alpha
>
> Docs: https://docs.userbox.dev · Source: https://github.com/osbxtech/userbox-js/tree/main/node

TypeScript SDK for the Userbox identity & authorization platform. Six methods, one client, zero runtime dependencies, Node 18+, dual ESM + CJS.

If you can get from `npm install` to a typed `boolean` returned by `client.can(...)` in under fifteen minutes you have used the SDK correctly.

---

## Install

```bash
npm install @userbox/node@alpha
# or:  pnpm add @userbox/node@alpha
# or:  yarn add @userbox/node@alpha
```

Zero runtime dependencies. The SDK uses Node-global `fetch`, `URL`, and `Headers` — nothing else is pulled in.

---

## Prerequisites

- Node 18+
- A Userbox **tenant ID** (UUID) — visible in the console under *Tenant settings*
- A Userbox **API key** with the scopes you need:
  - `users:read` for `getUser(...)`
  - `workspaces:read` for `getWorkspace(...)`
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

Trailing slashes on `baseUrl` are tolerated. Omit `baseUrl` to target the Userbox cloud at `https://api.userbox.app`.

---

## All six methods

```ts
// 1. Identity — GET /v1/users/{id}
const user = await client.getUser("01HX…");
// → UserResponse { id, email, full_name, status, ... }

// 2. Workspace — GET /v1/workspaces/{id}
const workspace = await client.getWorkspace("01HY…");
// → WorkspaceResponse { id, name, slug, status, ... }

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

Every non-2xx HTTP response and every `fetch` rejection surfaces as a thrown `UserboxError`. No other error type comes out of the SDK.

```ts
import { UserboxClient, UserboxError } from "@userbox/node";

try {
  await client.can({ userId, workspaceId, permission });
} catch (err) {
  if (err instanceof UserboxError) {
    if (err.status === 0) {
      // Network failure (DNS, connection reset, abort)
    } else if (err.status === 422 && err.code === "VALIDATION_ERROR") {
      // Bad input — fix your call
    } else if (err.status === 403) {
      // INSUFFICIENT_SCOPE (API key) or INSUFFICIENT_PERMISSION (JWT)
    } else {
      // Some other platform rejection
    }
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
- **No `console.*` output** — the production build emits zero log calls
- **No browser support** — Node 18+ only; a browser SDK is a future spec
- **No streaming / WebSockets** — request/response only
- **No webhook signature helpers** — separate spec
- **No per-call credential override** — instantiate a new `UserboxClient` per credential
- **No runtime field validation** — the SDK trusts the platform's 2xx response shapes

---

## License

See the repository root.
