import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Append-only, immutable audit trail.
 *
 * No RLS - readable only by the system-administrator PostgreSQL role
 * (BYPASSRLS).  Application roles access audit records via a scoped
 * service API, never by direct SELECT.
 *
 * See docs/architecture/security-architecture.md sectionAudit of Security Events.
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
  // BPR-D19 (Stage 9, migration 0004_business_process_foundations): hash chain proving no row was
  // inserted, altered or deleted out of sequence since the previous write
  // in the same chain (scoped by tenant_id; NULL-tenant system rows chain
  // separately). Pre-migration rows have previous_record_hash/record_hash
  // = NULL and are treated as a sealed legacy range — no retroactive
  // tamper evidence is claimed for them.
  previousRecordHash: text('previous_record_hash'),
  recordHash:         text('record_hash'),
});

export type AuditRecord    = typeof auditRecords.$inferSelect;
export type NewAuditRecord = typeof auditRecords.$inferInsert;

/** Valid values for the actionType column. */
export type AuditActionType = 'create' | 'update' | 'delete' | 'read';
/** Valid values for the actorType column. */
export type AuditActorType  = 'user' | 'system' | 'integration';

// ─────────────────────────────────────────────────────────────────────────────
// BPR-D19 — audit hardening & review (Stage 9, migration 0004_business_process_foundations).

export const auditPartitionSeals = pgTable('audit_partition_seal', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  rangeStart:   timestamp('range_start', { withTimezone: true }).notNull(),
  rangeEnd:     timestamp('range_end', { withTimezone: true }).notNull(),
  sealHash:     text('seal_hash').notNull(), // hash of the last record_hash in the sealed range
  sealedAt:     timestamp('sealed_at', { withTimezone: true }).notNull().defaultNow(),
  sealedBy:     text('sealed_by').notNull(),
});

export type AuditPartitionSeal    = typeof auditPartitionSeals.$inferSelect;
export type NewAuditPartitionSeal = typeof auditPartitionSeals.$inferInsert;

/** Review case — extends the shared business_case primitive via businessCaseId. */
export const auditReviewCases = pgTable('audit_review_case', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  businessCaseId: uuid('business_case_id').notNull(), // FK -> business_case.id (logical)
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditReviewCase    = typeof auditReviewCases.$inferSelect;
export type NewAuditReviewCase = typeof auditReviewCases.$inferInsert;

export const auditReviewFindings = pgTable('audit_review_finding', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  auditReviewCaseId: uuid('audit_review_case_id').notNull().references(() => auditReviewCases.id),
  auditRecordId:     uuid('audit_record_id').notNull(), // FK -> audit_record.id
  findingTypeCode:   text('finding_type_code').notNull(), // no-concern | policy-breach | tamper-suspected | investigation-required
  description:       text('description'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditReviewFinding    = typeof auditReviewFindings.$inferSelect;
export type NewAuditReviewFinding = typeof auditReviewFindings.$inferInsert;
