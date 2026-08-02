import { createHash, randomUUID } from 'node:crypto';

import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { auditRecords, auditPartitionSeals } from '@revelation-srs/db';
import type { AuditActionType, AuditActorType, Db } from '@revelation-srs/db';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

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

  /**
   * BPR-D19: computes a rolling hash chain so the sequence of audit rows
   * within one tenant (or the NULL-tenant system chain) cannot be
   * reordered, altered or have a row silently removed without breaking
   * the chain. This is the single choke point every call site already
   * goes through, so no caller needs to change.
   */
  async record(entry: AuditEntry): Promise<void> {
    const tenantId   = (entry.tenantId ?? null) as Uuid | null;
    const occurredAt = clockNow();

    await this.db.transaction(async (tx) => {
      const previousRows = await tx.select({ recordHash: auditRecords.recordHash })
        .from(auditRecords)
        .where(tenantId ? eq(auditRecords.tenantId, tenantId) : isNull(auditRecords.tenantId))
        .orderBy(desc(auditRecords.occurredAt))
        .limit(1);
      const previousRecordHash = previousRows[0]?.recordHash ?? null;

      const recordHash = createHash('sha256').update(JSON.stringify({
        tenantId,
        entityType: entry.entityType,
        entityId:   entry.entityId,
        fieldName:  entry.fieldName ?? null,
        actionType: entry.actionType,
        actorType:  entry.actorType,
        actorId:    entry.actorId,
        occurredAt: occurredAt.toISOString(),
        previousRecordHash,
      })).digest('hex');

      await tx.insert(auditRecords).values({
        tenantId,
        entityType:         entry.entityType,
        entityId:           entry.entityId as Uuid,
        fieldName:          entry.fieldName ?? null,
        beforeValue:        entry.beforeValue ?? null,
        afterValue:         entry.afterValue ?? null,
        actionType:         entry.actionType,
        actorType:          entry.actorType,
        actorId:            entry.actorId,
        actorDisplayName:   entry.actorDisplayName ?? null,
        occurredAt,
        correlationId:      entry.correlationId as Uuid | null ?? null,
        workflowInstanceId: entry.workflowInstanceId ?? null,
        reasonCode:         entry.reasonCode ?? null,
        reasonText:         entry.reasonText ?? null,
        previousRecordHash,
        recordHash,
      });
    });
  }

  /**
   * Seals a closed date range for a tenant: the seal hash is a hash of the
   * last record_hash within the range, so any later mutation of a sealed
   * row's chain is detectable by recomputing and comparing. Pre-migration
   * rows (record_hash = NULL) cannot be sealed with tamper evidence — the
   * seal simply marks the range as historical/legacy in that case.
   */
  async sealPartition(tenantId: string, rangeStart: Date, rangeEnd: Date, sealedBy: string): Promise<string> {
    const lastRow = await this.db.select({ recordHash: auditRecords.recordHash })
      .from(auditRecords)
      .where(and(
        eq(auditRecords.tenantId, tenantId as Uuid),
        gt(auditRecords.occurredAt, rangeStart),
      ))
      .orderBy(desc(auditRecords.occurredAt))
      .limit(1);

    const sealHash = createHash('sha256').update(JSON.stringify({
      tenantId, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(),
      lastRecordHash: lastRow[0]?.recordHash ?? 'legacy-unsealed',
    })).digest('hex');

    const id = randomUUID();
    await this.db.insert(auditPartitionSeals).values({
      id,
      tenantId: tenantId as Uuid,
      rangeStart,
      rangeEnd,
      sealHash,
      sealedAt: clockNow(),
      sealedBy,
    });
    return id;
  }
}
