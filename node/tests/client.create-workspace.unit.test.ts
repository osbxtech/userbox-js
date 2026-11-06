import { afterEach, describe, expect, it, vi } from "vitest";
import { UserboxClient } from "../src/client";
import {
  UserboxAuthError,
  UserboxConflictError,
  UserboxError,
  UserboxNotFoundError,
} from "../src/errors";

const ARGS = {
  name: "Acme Inc",
  externalId: "company_42",
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  ownerRole: "Admin",
};

const WORKSPACE = {
  id: "00000000-0000-4000-8000-0000000000aa",
  tenant_id: "00000000-0000-4000-8000-0000000000bb",
  name: "Acme Inc",
  slug: "acme-inc",
  external_id: "company_42",
  status: "active",
  created: true,
};

function client(): UserboxClient {
  return new UserboxClient({ apiKey: "fake_api_key_for_xx", tenantId: "tenant-1" });
}

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("createWorkspace", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs /v1/workspaces with the owner and returns created: true on 201", async () => {
    const fetchSpy = respond(201, WORKSPACE);
    const result = await client().createWorkspace({ ...ARGS, slug: "acme-inc" });

    expect(result).toEqual({ id: WORKSPACE.id, slug: "acme-inc", externalId: "company_42", created: true });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/workspaces$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Acme Inc",
      slug: "acme-inc",
      external_id: "company_42",
      owner: { user_id: ARGS.ownerUserId, role: "Admin" },
    });
  });

  it("omits slug and external_id when they are not given", async () => {
    const fetchSpy = respond(201, { ...WORKSPACE, external_id: null });
    const result = await client().createWorkspace({ name: "Acme", ownerUserId: ARGS.ownerUserId, ownerRole: "admin" });

    expect(result.externalId).toBeNull();
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toEqual({
      name: "Acme",
      owner: { user_id: ARGS.ownerUserId, role: "admin" },
    });
  });

  it("returns created: false on 200 (identical retry)", async () => {
    respond(200, { ...WORKSPACE, created: false });
    expect((await client().createWorkspace(ARGS)).created).toBe(false);
  });

  it("returns created: false on 200 even when the body has no created field", async () => {
    const { created: _ignored, ...body } = WORKSPACE;
    respond(200, body);
    expect((await client().createWorkspace(ARGS)).created).toBe(false);
  });

  it.each(["WS_EXTERNAL_ID_CONFLICT", "WS_SLUG_CONFLICT"])(
    "maps 409 %s to UserboxConflictError with existingWorkspaceId",
    async (code) => {
      respond(409, { code, error: "conflict", existing_workspace_id: WORKSPACE.id });
      const err = await client().createWorkspace(ARGS).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserboxConflictError);
      expect(err).toBeInstanceOf(UserboxError);
      expect(err).toMatchObject({ name: "UserboxConflictError", status: 409, code, existingWorkspaceId: WORKSPACE.id });
    },
  );

  it("leaves existingWorkspaceId undefined when the conflict is in another environment", async () => {
    respond(409, { code: "WS_EXTERNAL_ID_CONFLICT", error: "conflict" });
    const err = await client().createWorkspace(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxConflictError);
    expect((err as UserboxConflictError).existingWorkspaceId).toBeUndefined();
  });

  it.each(["USER_NOT_FOUND", "ROLE_NOT_FOUND"])("maps 404 %s to UserboxNotFoundError", async (code) => {
    respond(404, { code, error: "not found" });
    const err = await client().createWorkspace(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxNotFoundError);
    expect(err).toMatchObject({ status: 404, code });
  });

  it("maps 403 (missing workspaces:write) to UserboxAuthError", async () => {
    respond(403, { code: "INSUFFICIENT_SCOPE", error: "API key lacks workspaces:write" });
    const err = await client().createWorkspace(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserboxAuthError);
    expect(err).toMatchObject({ status: 403, code: "INSUFFICIENT_SCOPE" });
  });
});
