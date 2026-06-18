import { bigint, date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

export const demoStatus = pgTable('demo_status', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  scenarioSlug:  text('scenario_slug').notNull(),
  scenarioName:  text('scenario_name').notNull(),
  schemaVersion: text('schema_version').notNull(),
  referenceDate: date('reference_date').notNull(),
  clockOffsetMs: bigint('clock_offset_ms', { mode: 'number' }).notNull(),
  loadedAt:      timestamp('loaded_at', { withTimezone: true }).notNull().defaultNow(),
  nextResetAt:   timestamp('next_reset_at', { withTimezone: true }),
});

export const demoLoadCheckpoints = pgTable('demo_load_checkpoint', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  scenarioSlug: text('scenario_slug').notNull(),
  phaseName:    text('phase_name').notNull(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DemoStatus            = typeof demoStatus.$inferSelect;
export type NewDemoStatus         = typeof demoStatus.$inferInsert;
export type DemoLoadCheckpoint    = typeof demoLoadCheckpoints.$inferSelect;
export type NewDemoLoadCheckpoint = typeof demoLoadCheckpoints.$inferInsert;
