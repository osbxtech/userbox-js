import { existsSync } from "node:fs";
import { join } from "node:path";

import { Session } from "../api.js";
import type { Flags } from "../bin.js";
import type { Output } from "../output.js";
import {
  assignRole,
  createWorkspace,
  inviteMember,
  listMemberships,
  listRoles,
  listWorkspaces,
  resolveEnvironment,
} from "../userbox.js";
import { confirmRevokes, executeSync, loadManifest, syncManifest } from "./apply.js";

const SLUG = "dev";

// A dev workspace where the logged-in admin holds the `admin` role, plus
// optional invited members. The API has no "create user with password"
// route, so other users join by invitation email.

export async function devSeed(flags: Flags, out: Output): Promise<void> {
  const session = Session.load();
  const env = await resolveEnvironment(session, flags.env);
  // A new tenant's default environment has type "production"; on the alpha
  // platform that is still test data, so warn instead of refusing.
  if (env.type === "production") {
    out.warn(
      flags.env
        ? `The environment "${env.name}" is a production environment; the dev workspace is created there.`
        : `The default environment "${env.name}" is a production environment; the dev workspace is created there. Pass --env <name> to use another environment; \`userbox doctor --go-live\` reminds you to remove it before launch.`,
    );
  }

  const workspaces = await listWorkspaces(session, env);
  let ws = workspaces.find((w) => w.slug === SLUG);
  if (ws) out.step(`Workspace ${SLUG} exists`);
  else {
    ws = await createWorkspace(session, env, "Dev workspace", SLUG);
    out.step(`Created workspace ${SLUG}`);
  }

  if (existsSync(join(process.cwd(), "userbox.yaml"))) {
    const sync = await syncManifest(session, env, loadManifest(process.cwd()), [ws]);
    if (await confirmRevokes(sync, flags, "dev seed")) {
      await executeSync(session, env, sync);
      out.step("Synced userbox.yaml roles into the workspace");
    } else {
      out.warn("Skipped the userbox.yaml sync: nothing was removed from the roles.");
    }
  } else {
    out.warn("No userbox.yaml: the workspace has no roles yet. Add one and run `userbox apply`.");
  }

  const roles = new Map((await listRoles(session, env, ws.id)).map((r) => [r.name, r.id]));
  const memberships = await listMemberships(session, ws.id);
  const mine = memberships.find((m) => m.user_id === session.userId);
  let adminAssigned = false;
  const adminRole = roles.get("admin");
  if (mine && adminRole) {
    await assignRole(session, mine.id, adminRole);
    adminAssigned = true;
    out.step(`You (${session.email}) have the admin role in ${SLUG}`);
  } else if (!adminRole) {
    out.warn("No `admin` role in userbox.yaml, so your membership has no role.");
  } else {
    out.warn("You have no membership in the dev workspace; it was created by another user.");
  }

  const invited: { email: string; role: string | null }[] = [];
  for (const spec of flags.invite) {
    const [email, roleName = "member"] = spec.split(":");
    if (!email) continue;
    const already = memberships.find((m) => m.email?.toLowerCase() === email.toLowerCase());
    const membership = already ?? (await inviteMember(session, ws.id, email));
    const roleId = roles.get(roleName);
    if (roleId) await assignRole(session, membership.id, roleId);
    else out.warn(`No role "${roleName}" for ${email}; invited without a role.`);
    invited.push({ email, role: roleId ? roleName : null });
    out.step(already ? `${email} is already a member` : `Invited ${email} as ${roleName}`);
  }

  out.done(
    { workspace: { id: ws.id, slug: SLUG }, environment: { id: env.id, name: env.name, slug: env.slug ?? null, type: env.type }, adminAssigned, invited },
    [
      `Dev workspace: ${ws.id} (environment ${env.name})`,
      "Sign in to your app with your Userbox login; you are admin in this workspace.",
      ...(flags.invite.length === 0
        ? [`Add a second user with \`userbox dev seed${flags.env ? ` --env ${flags.env}` : ""} --invite someone@example.com:member\` (they get an email).`]
        : []),
    ],
  );
}
