/**
 * Verbatim mirror of the platform's `UserDetailResponse`. `tenant_id` is
 * intentionally NOT exposed by the SDK — the caller's tenant is implicit
 * in the API key.
 */
export interface UserResponse {
  id: string;
  email: string;
  email_verified_at: string | null;
  full_name: string | null;
  avatar_url: string | null;
  status: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
