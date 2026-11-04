import { beforeAll, describe, expect, it } from "vitest";
import { UserboxClient, can, verifyAccessToken, verifyRequest } from "../../src/index";
import { API_KEY, API_URL, TENANT_SLUG, integrationEnabled } from "./fixtures";
import { currentUserId, expectOk, loginAccessToken } from "./safe-assert";

function tenantIdOf(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { tid?: unknown };
  if (typeof payload.tid !== "string") throw new Error("setup: the access token has no tid claim");
  return payload.tid;
}

// Verifies real tokens against the live JWKS of the test platform. The tenant
// UUID is read from the token's own tid: the signature check is what is under
// test, and the wrong-tenant case proves tid is enforced.
describe.skipIf(!integrationEnabled)("integration: verifyRequest() and can() against a live tenant", () => {
  const client = new UserboxClient({ apiKey: API_KEY, tenantId: TENANT_SLUG, baseUrl: API_URL });
  let accessToken = "";
  let tenantId = "";
  let userId = "";
  let workspaceId = "";
  let granted = "";

  beforeAll(async () => {
    accessToken = await loginAccessToken();
    tenantId = tenantIdOf(accessToken);
    userId = await currentUserId(accessToken);
    const page = await expectOk(client.getUserMemberships({ userId }), "getUserMemberships()");
    workspaceId = (page.data.find((m) => m.status === "active") ?? page.data[0])?.workspace_id ?? "";
    const permissions = await expectOk(client.getUserPermissions({ userId, workspaceId }), "getUserPermissions()");
    granted = permissions[0] ?? "";
    if (!workspaceId || !granted) throw new Error("setup: the synthetic user needs a workspace with a permission");
  });

  it("verifyRequest() accepts a fresh access token", async () => {
    const req = new Request("http://localhost/", { headers: { authorization: `Bearer ${accessToken}` } });
    const user = await verifyRequest(req, { apiUrl: API_URL, tenantId });
    expect(user?.userId).toBe(userId);
  });

  it("verifyAccessToken() rejects the same token for another tenant", async () => {
    const codes: string[] = [];
    const user = await verifyAccessToken(accessToken, {
      apiUrl: API_URL,
      tenantId: "00000000-0000-4000-8000-000000000000",
      onError: (e) => codes.push(e.code),
    });
    expect(user).toBeNull();
    expect(codes).toEqual(["TENANT_MISMATCH"]);
  });

  it("verifyAccessToken() rejects a token with a flipped signature byte", async () => {
    const [h, p, s] = accessToken.split(".") as [string, string, string];
    const flipped = s.slice(0, 10) + (s[10] === "A" ? "B" : "A") + s.slice(11);
    expect(await verifyAccessToken(`${h}.${p}.${flipped}`, { apiUrl: API_URL, tenantId })).toBeNull();
  });

  it("can() allows a granted permission and denies an unknown one", async () => {
    expect(await can({ userId, workspaceId, permission: granted }, { client })).toBe(true);
    expect(await can({ userId, workspaceId, permission: "sdkci.never.granted" }, { client })).toBe(false);
  });

  it("can() denies when the API key is wrong", async () => {
    const bad = new UserboxClient({ apiKey: "fake_wrong_key_for_integration", tenantId: TENANT_SLUG, baseUrl: API_URL });
    const codes: string[] = [];
    expect(await can({ userId, workspaceId, permission: granted }, { client: bad, onError: (e) => codes.push(e.code) })).toBe(false);
    expect(codes.length).toBe(1);
  });
});
