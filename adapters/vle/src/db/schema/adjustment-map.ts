import { numeric, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { v } from './event-ledger.js';

export const adjustmentMap = v.table('vle_adjustment_map', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull(),
  adjustmentId:       uuid('adjustment_id').notNull(),
  distributionId:     uuid('distribution_id').notNull(),
  personId:           uuid('person_id').notNull(),
  enrolmentId:        uuid('enrolment_id').notNull(),
  adjustmentTypeCode: text('adjustment_type_code').notNull(),
  scopeCode:          text('scope_code').notNull(),
  validFrom:          timestamp('valid_from', { withTimezone: true }).notNull(),
  validTo:            timestamp('valid_to',   { withTimezone: true }),
  amountValue:        numeric('amount_value', { precision: 8, scale: 2 }),
  amountUnitCode:     text('amount_unit_code'),
  statusCode:         text('status_code').notNull().default('pending'), // pending | applied | acknowledged | failed | withdrawn
  appliedAt:          timestamp('applied_at',      { withTimezone: true }),
  acknowledgedAt:     timestamp('acknowledged_at', { withTimezone: true }),
  errorDetail:        text('error_detail'),
  withdrawnAt:              timestamp('withdrawn_at',               { withTimezone: true }),
  withdrawalAcknowledgedAt: timestamp('withdrawal_acknowledged_at', { withTimezone: true }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
