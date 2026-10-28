# Security policy — `@userbox/node`

## Threat model summary

- **Server-side only.** The client authenticates with a Userbox API key (or a
  JWT for audit logs). Never ship it to a browser bundle: an API key in client
  code is a leaked key.
- **Credentials are never logged.** The client has no logging. Error messages,
  `UserboxError` objects and their serialised forms never contain the API key,
  the tenant ID header value or the request headers. A unit test
  (`tests/credentials-not-logged.unit.test.ts`) asserts this for every API-key
  prefix, and asserts that the source contains no `console.*` call.
- **Zero runtime dependencies.** The client uses the runtime's global `fetch`,
  `URL` and `Headers`. Nothing is pulled in at install time.
- **Fail closed.** `can()` returns `true` only when the API answers
  `allowed: true`. Any error throws; it never resolves to `true`.
- **Response shape guard.** 2xx bodies are checked at the top level before use.
  A malformed body raises an error instead of being trusted.
- **Server authority.** Permission decisions are made by the Userbox API on
  every call. The client caches nothing.

## Reporting a vulnerability

See the repository [security policy](../SECURITY.md). Report privately through
GitHub private vulnerability reporting or **security@osbxtech.nl**, never in a
public issue.
