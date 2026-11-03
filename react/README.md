# @userbox/react

> **Alpha.** The API may change before 1.0.0. Install the alpha channel explicitly:
>
>     npm install @userbox/react@alpha
>
> Docs: https://docs.test.userbox.app · Source: https://github.com/osbxtech/userbox-js/tree/main/react
>
> `test` is the only live environment today: use `https://api.test.userbox.app` as `baseUrl`.

The official TypeScript/React frontend SDK for Userbox. Provides session
management, permission-gated UI hooks, and a thin Next.js App Router
integration.

> **Frontend permission checks are UI hints only.** Every destructive action
> MUST be authorised server-side. The SDK exposes no primitive that grants
> authoritative access; it surfaces what the server told it the user could
> see. Treat `usePermission` output strictly as "should I render this
> button?" — never as "is this safe to do?".

---

## Install

```bash
pnpm add @userbox/react@alpha
# Peer deps (already required by your app)
pnpm add react react-dom
# Optional: only if you use the Next.js integration
pnpm add next
```

## Quick start (React)

```tsx
import { UserboxProvider, useSession, usePermission } from "@userbox/react";

function App() {
  return (
    <UserboxProvider
      tenantSlug="acme"
      baseUrl="https://api.test.userbox.app"
      tokenStorage="cookie"  // recommended; see decision matrix below
      refreshUrl="/api/auth/refresh"  // your tenant backend proxy
    >
      <Dashboard />
    </UserboxProvider>
  );
}

function Dashboard() {
  const session = useSession();
  if (!session.isLoaded) return <p>Loading…</p>;
  if (!session.isSignedIn) return <SignInButton />;
  return <SignedInDashboard userId={session.user.id} />;
}

function DeleteButton({ workspaceId }: { workspaceId: string }) {
  const { allowed, isLoaded } = usePermission(workspaceId, "items.delete");
  if (!isLoaded) return null;          // fail-closed
  if (!allowed) return null;            // hide — but the API still enforces
  return <button onClick={...}>Delete</button>;
}
```

## Storage-strategy decision matrix

| Strategy | Where refresh token lives | Requires tenant backend? | Survives hard refresh? | Recommended for |
|---|---|---|---|---|
| `cookie` (default-ish) | httpOnly cookie set by your tenant backend | Yes — a `refreshUrl` proxy | ✅ | Full-stack apps with Next.js / Express / Django |
| `memory` | JS closure (`MemoryStore`) | No | ❌ | Pure SPAs with no backend; demo/dogfood |

**Pick `cookie` unless you literally have no server.** The memory strategy
trades survival across reloads for zero-backend deploys.

**Configuration consistency — do not mix:**
- Under `tokenStorage: "memory"`, do NOT install `userboxMiddleware`. The
  middleware looks for a refresh cookie, finds none, and warns.
- Under `tokenStorage: "cookie"` in Next.js, the middleware is REQUIRED for
  Server Components to see a signed-in session.

## Quick start (Next.js App Router)

Supports Next.js 14, 15 and 16. Next 16 calls the middleware file `proxy.ts`
(export `proxy`); Next 14 and 15 call it `middleware.ts` (export `middleware`).
`userboxMiddleware()` works unchanged under both, on the Edge and Node runtimes.

```ts
// proxy.ts (Next 16), next to app/ (project root, or src/). On Next 14/15: middleware.ts, export `middleware`
import { userboxMiddleware } from "@userbox/react/nextjs";

export const proxy = userboxMiddleware({
  tenantSlug: "acme",
  baseUrl: "https://api.test.userbox.app",
});

export const config = {
  // Every page that calls getUnverifiedSession(). Leave out API routes,
  // including your refresh route, and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

```tsx
// app/dashboard/page.tsx — Server Component
import { Suspense } from "react";
import { getUnverifiedSession } from "@userbox/react/nextjs";

export default function Page() {
  // getUnverifiedSession() reads request headers. With `cacheComponents: true`
  // (the create-next-app default on Next 16) that must happen inside <Suspense>.
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Greeting />
    </Suspense>
  );
}

async function Greeting() {
  const session = await getUnverifiedSession();
  if (!session) return <SignInLink />;
  return <h1>Hello {session.user.id}</h1>;
}
```

The middleware refreshes the session from the `ub_refresh` cookie and forwards
the new access token to Server Components in the `x-userbox-access-token`
request header. It **always deletes that header from the incoming request
first**, so a client cannot inject a token: the header is present only when this
request's refresh succeeded.

⚠️ **`getUnverifiedSession()` does not verify the token.** It decodes the claims
of the token the middleware forwarded. Use it to render UI on routes the
middleware matches. On a route outside the `matcher`, the header comes straight
from the client. **Never authorize with it.** Authorization happens on your
server: verify the `Authorization: Bearer` token against the Userbox JWKS
(`https://api.test.userbox.app/.well-known/jwks.json`, `RS256` only), check
that its `tid` is your tenant, then check permissions with
[`@userbox/node`](https://www.npmjs.com/package/@userbox/node) `can()`.

⚠️ **`ServerSession` carries the bearer `accessToken`.** Do NOT pass the
returned `session` as a prop to a Client Component — Next.js will serialise
the token into the client bundle. Pass `session.user` instead.

## API surface

The exported TypeScript types are the authoritative reference. Quick
reference:

- `<UserboxProvider>` — mount once at the root; configures the SDK.
- `useSession()` — discriminated union; `{ isLoaded, isSignedIn, user }`.
- `usePermissions(workspaceId)` — `ReadonlySet<string>`, one fetch per workspace.
- `usePermission(workspaceId, key)` — synchronous boolean derivation. **UI hints only.**
- `useSignIn() / useSignUp()` — navigate to the hosted auth surface.
- `useSignOut()` — clears in-memory state + calls `/v1/auth/logout`.
- `<UserboxCallback>` — consumes credentials from the URL fragment.
- `userboxMiddleware(config)` + `getUnverifiedSession()` from `@userbox/react/nextjs`
  (`getSession()` was renamed in `1.0.0-alpha.2`; it never verified the token).

## Auth-surface assumptions

Sign-in/sign-up navigation defaults to `https://{slug}.auth.<parent of baseUrl's host>/{login,signup}?return_to=<url>&state=<nonce>&flow_id=<flow>`
(with `baseUrl: "https://api.test.userbox.app"`: `https://{slug}.auth.test.userbox.app`).

- Override the host with the `baseAuthUrl` provider prop for local dev (e.g.
  `http://acme.userbox.localhost:3000`).
- `return_to` is validated to be same-origin with the calling app **on the
  client**. Defence-in-depth: the auth surface itself MUST also allowlist
  return URLs server-side before redirecting. The SDK's check is a UX
  safeguard, not the authoritative boundary.

## Known limitations

- **Refresh-token rotation race on crash**: if the browser
  crashes between the refresh server having rotated the token and the SDK
  receiving the response, the in-memory rotated token is lost. The user
  needs to sign in again. The window is small but real.
- **External-tenant `<UserboxCallback>`** depends on the auth surface
  emitting credentials via URL fragment to external return URLs — a
  prerequisite tracked separately (see plan Complexity Tracking). The
  parser in this package is built against the future contract; same-origin
  `*.userbox.app` flows work today.
- **The middleware refreshes on every matched request.** Each refresh rotates
  the single-use refresh token, so concurrent matched requests (for example
  link prefetches) can race. Keep the `matcher` to pages that need a server
  session.
- **No `<UserboxGate>` declarative wrapper.** Use `usePermission` directly.
- **No Vue / Svelte adapters in V1.** `core/` is framework-agnostic and
  could host them later (no commitment).
- **API slug regex parity**: the SDK rejects 1-2 char slugs
  that the API accepts; this is the safe direction (SDK stricter) but a
  consumer using a single-char slug will see `misconfigured` errors.

## Versioning

Strict semver post-GA. See `CHANGELOG.md`. The shapes documented in the
contract are the public surface; any breaking change is a major release.

## Security

See [`SECURITY.md`](./SECURITY.md) for the security model, threat coverage,
and the responsible-disclosure email.
