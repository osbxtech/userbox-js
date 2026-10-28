# sample-next-app (Playwright fixture)

Minimal Next.js 14 App Router consumer of `@userbox/react`. Used only by the
Playwright suite — not part of the npm distribution.

When fully scaffolded this app will contain:

- `app/layout.tsx` mounting `<UserboxProvider>` with cookie storage and the
  shared `refreshUrl: "/api/auth/refresh"` route.
- `app/page.tsx` showing `useSession()` and a sign-in button.
- `app/dashboard/page.tsx` Server Component using `getSession()`.
- `middleware.ts` re-exporting `userboxMiddleware` from `@userbox/react/nextjs`.
- `app/api/auth/refresh/route.ts` (tenant-backend refresh proxy stub).
