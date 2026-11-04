---
"@userbox/node": patch
---

Adds `verifyRequest()` / `verifyAccessToken()` (RS256 access-token verification
against the tenant JWKS with Web Crypto, tenant bound by `tid`, never throws)
and a deny-on-error `can()`. `UserboxClient` fields fall back to
`USERBOX_API_KEY`, `USERBOX_TENANT_ID` and `USERBOX_API_URL` /
`NEXT_PUBLIC_USERBOX_API_URL`. No new runtime dependency.
