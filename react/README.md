# @userbox/react

> **Alpha.** The API may change before 1.0.0. Install the alpha channel explicitly:
>
>     npm install @userbox/react@alpha
>
> Docs: https://docs.userbox.dev · Source: https://github.com/osbxtech/userbox-js/tree/main/react

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
      baseUrl="https://api.userbox.app"
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

```ts
// middleware.ts
export { userboxMiddleware as middleware } from "@userbox/react/nextjs";

// app/dashboard/page.tsx — Server Component
import { getSession } from "@userbox/react/nextjs";
export default async function Page() {
  const session = await getSession();
  if (!session) return <RedirectToSignIn />;
  return <h1>Hello {session.user.id}</h1>;
}
```

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
- `userboxMiddleware()` + `getSession()` from `@userbox/react/nextjs`.

## Auth-surface assumptions

Sign-in/sign-up navigation defaults to `https://{slug}.userbox.app/{login,signup}?return_to=<url>&state=<nonce>&flow_id=<flow>`.

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
