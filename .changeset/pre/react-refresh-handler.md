---
"@userbox/react": patch
---

Adds `createRefreshHandler()` to `@userbox/react/nextjs`: the cookie-mode
refresh route (`export const { POST } = createRefreshHandler();`) with the same
CSRF, cookie and rotation behaviour as the snippet in the docs.
