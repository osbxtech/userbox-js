---
"@userbox/cli": patch
---

`login` no longer says the login "lasts 7 days of inactivity". It reads the default environment's session duration and says the login expires after that long without use (24 hours by default; the API caps it at 7 days). If the setting cannot be read, the message names no number.
