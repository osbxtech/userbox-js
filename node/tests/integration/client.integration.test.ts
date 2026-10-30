import { beforeAll, describe, expect, it } from "vitest";
import { UserboxClient } from "../../src/client";
import { API_KEY, API_URL, TENANT_SLUG, integrationEnabled } from "./fixtures";
import { currentUserId, expectOk, expectUserboxError, loginAccessToken } from "./safe-assert";

// Runs against the dedicated sdk-ci tenant on the test platform (synthetic data
// only). The API key holds exactly access:check, users:read, workspaces:read and
// memberships:read; the synthetic user holds userbox.audit_logs.read in sdk-ci.
// Comparisons below are on ids and booleans only, never on credentials.
describe.skipIf(!integrationEnabled)("integration: @userbox/node against a live tenant", () => {
  const client = new UserboxClient({ apiKey: API_KEY, tenantId: TENANT_SLUG, baseUrl: API_URL });
  let accessToken = "";
  let userId = "";
  let workspaceId = "";
  let permissions: string[] = [];

  beforeAll(async () => {
    accessToken = await loginAccessToken();
    userId = await currentUserId(accessToken);
    const page = await expectOk(client.getUserMemberships({ userId }), "getUserMemberships()");
    const membership = page.data.find((m) => m.status === "active") ?? page.data[0];
    if (!membership) throw new Error("setup: the synthetic user has no membership in the tenant");
    workspaceId = membership.workspace_id;
  });

  it("getUser() returns the synthetic user", async () => {
    const user = await expectOk(client.getUser(userId), "getUser()");
    expect(user.id).toBe(userId);
  });

  it("getUserMemberships() returns a page with the user's memberships", async () => {
    const page = await expectOk(client.getUserMemberships({ userId, perPage: 5 }), "getUserMemberships()");
    expect(page.page).toBe(1);
    expect(page.per_page).toBe(5);
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(page.data.some((m) => m.workspace_id === workspaceId)).toBe(true);
  });

  it("getWorkspace() returns the membership's workspace", async () => {
    const workspace = await expectOk(client.getWorkspace(workspaceId), "getWorkspace()");
    expect(workspace.id).toBe(workspaceId);
  });

  it("getUserPermissions() returns the user's permission keys", async () => {
    permissions = await expectOk(client.getUserPermissions({ userId, workspaceId }), "getUserPermissions()");
    expect(Array.isArray(permissions)).toBe(true);
    expect(permissions.length).toBeGreaterThan(0);
  });

  it("can() allows a granted permission and denies an unknown one", async () => {
    const granted = permissions[0];
    if (!granted) throw new Error("setup: the synthetic user has no permission in its workspace");
    const allowed = await expectOk(client.can({ userId, workspaceId, permission: granted }), "can(granted)");
    expect(allowed).toBe(true);
    const denied = await expectOk(
      client.can({ userId, workspaceId, permission: "sdkci.never.granted" }),
      "can(unknown)",
    );
    expect(denied).toBe(false);
  });

  it("getAuditLogs() refuses the API key with 403 INSUFFICIENT_SCOPE (JWT-only)", async () => {
    await expectUserboxError(client.getAuditLogs(), "getAuditLogs() with the API key", {
      status: 403,
      code: "INSUFFICIENT_SCOPE",
    });
  });

  it("getAuditLogs() answers 200 with the synthetic user's JWT", async () => {
    const asUser = new UserboxClient({ apiKey: accessToken, tenantId: TENANT_SLUG, baseUrl: API_URL });
    const page = await expectOk(asUser.getAuditLogs({ perPage: 1 }), "getAuditLogs() with the user's JWT");
    expect(page.page).toBe(1);
    expect(Array.isArray(page.data)).toBe(true);
  });
});
