import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * One row per institution.  All user-data tables carry tenant_id FK to this table.
 * No RLS on this table - it is read by system administrator role only.
 */
export const tenants = pgTable('tenant', {
  id:            uuid('id').primaryKey().defaultRandom(),
  code:          text('code').notNull().unique(),
  name:          text('name').notNull(),
  configuration: jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  active:        boolean('active').notNull().default(true),
});

export type Tenant       = typeof tenants.$inferSelect;
export type NewTenant    = typeof tenants.$inferInsert;
