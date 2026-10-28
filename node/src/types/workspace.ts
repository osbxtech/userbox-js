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
