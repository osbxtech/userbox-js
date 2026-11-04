import { describe, expect, it } from "vitest";

import { parseManifest, planApply, planIsEmpty } from "../src/manifest.js";

const YAML = `
permissions: [projects.read, projects.create, projects.delete, billing.view]
roles:
  admin: [projects.*, billing.view]
  member: [projects.read, projects.create]
`;

describe("parseManifest", () => {
  it("expands wildcards against declared permissions", () => {
    const m = parseManifest(YAML);
    expect(m.roles.admin).toEqual(["billing.view", "projects.create", "projects.delete", "projects.read"]);
  });

  it("rejects a role permission that is not declared", () => {
    expect(() => parseManifest("permissions: [a.b]\nroles:\n  x: [a.c]\n")).toThrow(/not under `permissions`/);
  });

  it("rejects an invalid key", () => {
    expect(() => parseManifest("permissions: [Projects]\n")).toThrow(/invalid permission key/);
  });
});

describe("planApply", () => {
  it("creates, grants and revokes; reports extras without deleting them", () => {
    const plan = planApply(parseManifest(YAML), {
      permissions: ["projects.read", "legacy.thing"],
      roles: { member: ["projects.read", "legacy.thing"], owner: [] },
    });
    expect(plan.createPermissions).toEqual(["billing.view", "projects.create", "projects.delete"]);
    expect(plan.createRoles).toEqual(["admin"]);
    expect(plan.grant).toContainEqual({ role: "member", permission: "projects.create" });
    expect(plan.revoke).toEqual([{ role: "member", permission: "legacy.thing" }]);
    expect(plan.extraPermissions).toEqual(["legacy.thing"]);
    expect(plan.extraRoles).toEqual(["owner"]);
  });

  it("is empty when the environment already matches", () => {
    const m = parseManifest(YAML);
    expect(planIsEmpty(planApply(m, { permissions: m.permissions, roles: m.roles }))).toBe(true);
  });
});
