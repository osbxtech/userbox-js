import { describe, expect, it } from "vitest";

import type { Flags } from "../src/bin.js";
import { confirmRevokes } from "../src/commands/apply.js";
import { type Plan, planApply } from "../src/manifest.js";

const flags: Flags = { json: true, yes: true, force: false, skipInstall: false, invite: [], goLive: false };

function syncWith(plan: Plan) {
  return {
    createdPermissions: plan.createPermissions,
    plans: [{ workspace: { id: "w1", name: "Dev", slug: "dev", status: "active" }, plan, roleIds: new Map() }],
    permissionIds: new Map<string, string>(),
  };
}

const manifest = { permissions: ["projects.read", "projects.delete"], roles: { admin: ["projects.read", "projects.delete"] } };

describe("confirmRevokes", () => {
  it("lets a purely additive plan through with --yes and no terminal", async () => {
    const plan = planApply(manifest, { permissions: ["projects.read"], roles: { admin: ["projects.read"] } });
    await expect(confirmRevokes(syncWith(plan), flags, "apply")).resolves.toBe(true);
  });

  it("stops a plan that removes a grant with NEEDS_HUMAN, even with --yes", async () => {
    const plan = planApply(
      { permissions: manifest.permissions, roles: { admin: ["projects.read"] } },
      { permissions: manifest.permissions, roles: { admin: ["projects.read", "projects.delete"] } },
    );
    await expect(confirmRevokes(syncWith(plan), flags, "apply")).rejects.toMatchObject({
      code: "NEEDS_HUMAN",
      message: expect.stringContaining("admin → projects.delete"),
    });
  });
});
