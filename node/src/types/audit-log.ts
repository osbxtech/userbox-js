export interface AuditLogRecord {
  id: string;
  action: string;
  actor_id: string | null;
  actor_type: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}

export interface AuditLogPage {
  data: AuditLogRecord[];
  total: number;
  page: number;
  per_page: number;
}

export interface GetAuditLogsArgs {
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}
