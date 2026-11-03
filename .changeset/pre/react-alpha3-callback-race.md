---
"@userbox/react": patch
---

Cookie mode: a session adopted by `<UserboxCallback>` is no longer cleared by
the provider's mount-time refresh that 401s before the refresh cookie exists.
The provider skips or ignores that stale refresh, and `<UserboxCallback>` waits
for the cookie `init` request before `onSuccess` (`onError` only on failure).
