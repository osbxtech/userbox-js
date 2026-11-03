---
"@userbox/react": patch
---

`userboxMiddleware` deletes the incoming access-token header on every path before
forwarding the request, so a client can no longer inject a token into Server
Components. `getSession()` is renamed `getUnverifiedSession()` (it decodes, never
verifies), returns `null` for expired tokens, and accepts `{ accessTokenHeader }`.
`peerDependencies.next` accepts `^16.0.0`; the README documents Next 16 `proxy.ts`
and the live `test` URLs.
