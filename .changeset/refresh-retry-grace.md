---
"@userbox/cli": patch
"@userbox/react": patch
---

Retry a failed token refresh once, with the same refresh token, when the first attempt failed in transit (network error or 5xx). The Userbox API now replays the same rotated pair for a short grace window, so a response lost during a rollout no longer ends the session. Applies to the CLI login and to the Next.js refresh handler (`createRefreshHandler`). A 4xx is never retried.
