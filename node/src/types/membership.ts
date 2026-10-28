export interface MembershipResponse {
  id: string;
  user_id: string | null;
  workspace_id: string;
  external_id: string | null;
  public_metadata: Record<string, unknown> | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MembershipPage {
  data: MembershipResponse[];
  total: number;
  page: number;
  per_page: number;
}

export interface GetUserMembershipsArgs {
  userId: string;
  page?: number;
  perPage?: number;
}
