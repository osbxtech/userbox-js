---
"@userbox/cli": patch
---

`userbox login` failures now point to founder sign-up: on `INVALID_CREDENTIALS` (unknown email, wrong password or unknown tenant slug, all reported the same way) the hint and the `--json` output include `signup_url`, taken from `GET /v1/founder-signup/status` with a fallback to `https://auth.<base>/create-account`.
