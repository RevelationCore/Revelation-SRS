import { numeric, timestamp, uuid, text } from 'drizzle-orm/pg-core';

import { v } from './event-ledger.js';

export const markReceipt = v.table('vle_mark_receipt', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull(),
  sourceReference:      text('source_reference').notNull(),
  moduleRegistrationId: uuid('module_registration_id').notNull(),
  assessmentComponentId: uuid('assessment_component_id').notNull(),
  markId:               uuid('mark_id'),
  rawMark:              numeric('raw_mark').notNull(),
  submittedAt:          timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});
