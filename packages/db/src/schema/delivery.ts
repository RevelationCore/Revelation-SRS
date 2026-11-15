import { integer, jsonb, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Platform delivery ledger for outbound flows to adjacent systems
 * (migration 0029). Reasonable adjustments keep their own ledger
 * (adjustment_distribution) with a withdrawal lifecycle; every other outbound
 * reference-model flow uses this one.
 */
export const deliveryFlowConfigs = pgTable('delivery_flow_config', {
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  flowCode:            text('flow_code').notNull(),
  fulfilmentModeCode:  text('fulfilment_mode_code').notNull(), // connected | manual | file | not-used
  ownerDescription:    text('owner_description'),
  alertAfterHours:     integer('alert_after_hours').notNull().default(72),
  notifyEmail:         text('notify_email'),
  lastOverdueNoticeAt: timestamp('last_overdue_notice_at', { withTimezone: true }),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy:           text('updated_by').notNull(),
}, (table) => [primaryKey({ columns: [table.tenantId, table.flowCode] })]);

export const deliveryItems = pgTable('delivery_item', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  flowCode:           text('flow_code').notNull(),
  targetSystem:       text('target_system').notNull(),
  subjectType:        text('subject_type').notNull(),
  subjectId:          uuid('subject_id').notNull(),
  personId:           uuid('person_id'),
  idempotencyKey:     text('idempotency_key').notNull(),
  payload:            jsonb('payload').notNull().$type<Record<string, unknown>>().default({}),
  summary:            text('summary').notNull(),
  fulfilmentModeCode: text('fulfilment_mode_code').notNull(),
  statusCode:         text('status_code').notNull().default('pending'), // pending | delivered | failed | superseded
  failureReason:      text('failure_reason'),
  requestEventId:     uuid('request_event_id').notNull().defaultRandom(),
  requestPublishedAt: timestamp('request_published_at', { withTimezone: true }),
  deliveredAt:        timestamp('delivered_at', { withTimezone: true }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique().on(table.tenantId, table.flowCode, table.idempotencyKey)]);

export type DeliveryItem       = typeof deliveryItems.$inferSelect;
export type DeliveryFlowConfig = typeof deliveryFlowConfigs.$inferSelect;
