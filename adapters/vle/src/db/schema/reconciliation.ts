import { integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { v } from './event-ledger.js';

export const reconciliationRun = v.table('vle_reconciliation_run', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  runType:      text('run_type').notNull(), // roster | adjustments | marks
  startedAt:    timestamp('started_at',   { withTimezone: true }).notNull().defaultNow(),
  completedAt:  timestamp('completed_at', { withTimezone: true }),
  driftCount:   integer('drift_count').notNull().default(0),
  repairedCount: integer('repaired_count').notNull().default(0),
  errorDetail:  text('error_detail'),
});
