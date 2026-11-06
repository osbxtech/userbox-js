export interface WorkspaceResponse {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  external_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateWorkspaceArgs {
  /** Display name. */
  name: string;
  /**
   * Your own id for the customer (e.g. your `companies.id`). An identical
   * retry with the same `externalId`, owner and role returns the existing
   * workspace with `created: false` instead of creating a second one.
   */
  externalId?: string;
  /** URL slug; the platform derives one from `name` when omitted. */
  slug?: string;
  /** Userbox user id of the customer's first member. */
  ownerUserId: string;
  /** Role from the environment's role catalogue, matched case-insensitively. */
  ownerRole: string;
}

export interface CreatedWorkspace {
  id: string;
  slug: string;
  externalId: string | null;
  /** `false` when an identical retry returned the existing workspace. */
  created: boolean;
}
