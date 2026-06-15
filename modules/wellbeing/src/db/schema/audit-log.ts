import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { w } from './wellbeing-case.js';

/**
 * Audit log — append-only record of read, write, and export operations on
 * special-category wellbeing data.  Required for Equality Act compliance and
 * data-protection audit obligations.
 *
 * Never updated or deleted.  Retained according to the institutional
 * data-retention schedule (see Phase 7 retention policy).
 */
export const auditLog = w.table('audit_log', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  actorId:      text('actor_id').notNull(),
  actionCode:   text('action_code').notNull(),    // read | write | export
  resourceType: text('resource_type').notNull(),  // disability-case | dsa-entitlement | evidence
  resourceId:   uuid('resource_id').notNull(),
  personId:     uuid('person_id').notNull(),
  context:      jsonb('context').notNull().$type<Record<string, unknown>>().default({}),
  recordedAt:   timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLogEntry    = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
