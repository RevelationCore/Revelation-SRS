import { and, desc, eq, gt } from 'drizzle-orm';
import { auditRecords } from '@revelation-srs/db';
import type { AuditActionType, AuditActorType, Db } from '@revelation-srs/db';

export interface AuditLogEntryDto {
  id:                 string;
  tenantId:           string | null;
  entityType:         string;
  entityId:           string;
  fieldName:          string | null;
  beforeValue:        unknown;
  afterValue:         unknown;
  actionType:         string;
  actorType:          string;
  actorId:            string;
  actorDisplayName:   string | null;
  occurredAt:         string;
  correlationId:      string | null;
  workflowInstanceId: string | null;
  reasonCode:         string | null;
  reasonText:         string | null;
}

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

  async listByEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<AuditLogEntryDto[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const rows = await this.db
      .select()
      .from(auditRecords)
      .where(
        and(
          eq(auditRecords.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(auditRecords.entityType, entityType),
          eq(auditRecords.entityId,   entityId as `${string}-${string}-${string}-${string}-${string}`),
          ...(opts.before ? [gt(auditRecords.occurredAt, new Date(opts.before))] : []),
        ),
      )
      .orderBy(desc(auditRecords.occurredAt))
      .limit(limit);

    return rows.map((r) => ({
      id:                 r.id,
      tenantId:           r.tenantId,
      entityType:         r.entityType,
      entityId:           r.entityId,
      fieldName:          r.fieldName,
      beforeValue:        r.beforeValue,
      afterValue:         r.afterValue,
      actionType:         r.actionType,
      actorType:          r.actorType,
      actorId:            r.actorId,
      actorDisplayName:   r.actorDisplayName,
      occurredAt:         r.occurredAt.toISOString(),
      correlationId:      r.correlationId,
      workflowInstanceId: r.workflowInstanceId,
      reasonCode:         r.reasonCode,
      reasonText:         r.reasonText,
    }));
  }

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
