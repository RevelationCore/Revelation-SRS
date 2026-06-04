import { boolean, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Named catalogue of valid value lists.
 *
 * Platform-managed sets are pre-seeded from statutory coding manuals
 * (HESA, UCAS, SLC) and SRS-internal enumerations. Tenant-extensible
 * sets allow institutions to add their own codes alongside platform values.
 *
 * See docs/architecture/configuration-rules-framework.md sectionValid Values.
 */
export const valueSets = pgTable('value_set', {
  id:            uuid('id').primaryKey().defaultRandom(),
  setCode:       text('set_code').notNull().unique(),
  displayName:   text('display_name').notNull(),
  source:        text('source').notNull(),          // 'hesa' | 'ucas' | 'slc' | 'srs-internal'
  sourceVersion: text('source_version'),            // e.g. '2024-25' for HESA annual sets
  description:   text('description'),
  isExtensible:  boolean('is_extensible').notNull().default(false),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Individual values within a value set.
 *
 * tenant_id IS NULL    -> platform value, visible to all tenants.
 * tenant_id IS NOT NULL -> tenant extension, visible only to that tenant.
 *
 * active_to IS NULL    -> currently valid.
 * active_to set        -> retired (preserved for historical reconstruction).
 *
 * Unique constraints (in migration DDL):
 *   - UNIQUE (value_set_id, code) WHERE tenant_id IS NULL
 *   - UNIQUE (value_set_id, tenant_id, code) WHERE tenant_id IS NOT NULL
 * RLS: tenant_id IS NULL OR tenant_id = current_tenant
 */
export const valueSetMembers = pgTable('value_set_member', {
  id:             uuid('id').primaryKey().defaultRandom(),
  valueSetId:     uuid('value_set_id').notNull().references(() => valueSets.id),
  tenantId:       uuid('tenant_id').references(() => tenants.id), // null = platform
  code:           text('code').notNull(),
  displayLabel:   text('display_label').notNull(),
  description:    text('description'),
  sortOrder:      smallint('sort_order').notNull().default(0),
  activeFrom:     timestamp('active_from', { withTimezone: true }).notNull().defaultNow(),
  activeTo:       timestamp('active_to',   { withTimezone: true }), // null = still active
  sourceMetadata: jsonb('source_metadata'), // { specVersion, fieldCode, notes, etc. }
  createdAt:      timestamp('created_at',  { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Links a data-model field to the value set that governs its valid codes.
 *
 * The UI queries this table to discover which value set to load for a
 * given field before rendering a dropdown or validating user input.
 * Application services use it to validate _code columns on write.
 *
 * Example: entity_name='enrolment', field_name='status_code'
 *          -> value_set_code='enrolment-status-code'
 */
export const fieldValueSets = pgTable('field_value_set', {
  id:           uuid('id').primaryKey().defaultRandom(),
  entityName:   text('entity_name').notNull(),  // drizzle table name, e.g. 'enrolment'
  fieldName:    text('field_name').notNull(),   // column name, e.g. 'status_code'
  valueSetCode: text('value_set_code').notNull().references(() => valueSets.setCode),
  description:  text('description'),
});
// UNIQUE (entity_name, field_name) enforced in migration DDL

export type ValueSet       = typeof valueSets.$inferSelect;
export type ValueSetMember = typeof valueSetMembers.$inferSelect;
export type FieldValueSet  = typeof fieldValueSets.$inferSelect;
export type NewValueSetMember = typeof valueSetMembers.$inferInsert;
