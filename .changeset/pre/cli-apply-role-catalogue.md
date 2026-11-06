---
"@userbox/cli": minor
---

`apply` syncs `userbox.yaml` into the environment's role catalogue (`/v1/roles`) instead of into each workspace. It lists the roles once, creates missing ones with `managed_by: "apply"`, takes over a declared role that was created in the console (matching the name case-insensitively and renaming it to the file's spelling), and converges each role's grants in one `PUT /v1/roles/{id}/permissions`, after creating the permissions. Platform (internal) permissions on a role are kept. Roles that exist only in the console are reported as "exists only in the console (kept)" and listed in `consoleOnlyRoles` in the `--json` result, which no longer has `workspaces`. `apply` never deletes a role, and removing a grant still needs a human at a terminal.
