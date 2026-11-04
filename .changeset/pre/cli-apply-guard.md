---
"@userbox/cli": patch
---

`apply` and `dev seed` stop with `NEEDS_HUMAN` when the plan removes permissions
from an existing role and there is no terminal; `--yes` only skips the
confirmation for purely additive plans.
