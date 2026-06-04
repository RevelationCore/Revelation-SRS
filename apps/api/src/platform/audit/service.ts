import { auditRecords } from '@revelation-srs/db';
import type { AuditActionType, AuditActorType, Db } from '@revelation-srs/db';

export interface AuditEntry {
  tenantId?:           string;
  entityType:          string;
  entityId:            string;
  fieldName?:          string;
  beforeValue?:        unknown;
  afterValue?:         unknown;
  actionType:          AuditActionType;
  actorType:           AuditActorType;
  actorId:             string;
  actorDisplayName?:   string;
  correlationId?:      string;
  workflowInstanceId?: string;
  reasonCode?:         string;
  reasonText?:         string;
}

/**
 * Appends an audit record.
 *
 * Must be called for every write operation and for reads of sensitive /
 * special-category data as defined by the data subject register.
 *
 * The audit table has no RLS - it is written by the application role using
 * a dedicated INSERT privilege, and read only by the system-administrator
 * role (BYPASSRLS).
 */
export class AuditService {
  constructor(private readonly db: Db) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditRecords).values({
      tenantId:           entry.tenantId ?? null,
      entityType:         entry.entityType,
      entityId:           entry.entityId as `${string}-${string}-${string}-${string}-${string}`,
      fieldName:          entry.fieldName ?? null,
      beforeValue:        entry.beforeValue ?? null,
      afterValue:         entry.afterValue ?? null,
      actionType:         entry.actionType,
      actorType:          entry.actorType,
      actorId:            entry.actorId,
      actorDisplayName:   entry.actorDisplayName ?? null,
      correlationId:      entry.correlationId as `${string}-${string}-${string}-${string}-${string}` | null ?? null,
      workflowInstanceId: entry.workflowInstanceId ?? null,
      reasonCode:         entry.reasonCode ?? null,
      reasonText:         entry.reasonText ?? null,
    });
  }
}
