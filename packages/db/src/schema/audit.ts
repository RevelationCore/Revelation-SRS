import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Append-only, immutable audit trail.
 *
 * No RLS — readable only by the system-administrator PostgreSQL role
 * (BYPASSRLS).  Application roles access audit records via a scoped
 * service API, never by direct SELECT.
 *
 * See docs/architecture/security-architecture.md §Audit of Security Events.
 */
export const auditRecords = pgTable('audit_record', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id'),
  entityType:         text('entity_type').notNull(),
  entityId:           uuid('entity_id').notNull(),
  fieldName:          text('field_name'),
  beforeValue:        jsonb('before_value'),
  afterValue:         jsonb('after_value'),
  actionType:         text('action_type').notNull(),
  actorType:          text('actor_type').notNull(),
  actorId:            text('actor_id').notNull(),
  actorDisplayName:   text('actor_display_name'),
  occurredAt:         timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  correlationId:      uuid('correlation_id'),
  workflowInstanceId: text('workflow_instance_id'),
  reasonCode:         text('reason_code'),
  reasonText:         text('reason_text'),
});

export type AuditRecord    = typeof auditRecords.$inferSelect;
export type NewAuditRecord = typeof auditRecords.$inferInsert;

/** Valid values for the actionType column. */
export type AuditActionType = 'create' | 'update' | 'delete' | 'read';
/** Valid values for the actorType column. */
export type AuditActorType  = 'user' | 'system' | 'integration';
