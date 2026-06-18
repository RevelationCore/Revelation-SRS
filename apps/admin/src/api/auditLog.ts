import { api } from './client.js';

export interface AuditEntry {
  id:           string;
  tenantId:     string;
  entityType:   string;
  entityId:     string;
  eventType:    string;
  actorId:      string;
  actorType:    string;
  changes:      Record<string, unknown> | null;
  recordedAt:   string;
}

export function getAuditLog(entityType: string, entityId: string): Promise<AuditEntry[]> {
  return api.get<AuditEntry[]>(
    `/api/v1/audit-log?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
  );
}
