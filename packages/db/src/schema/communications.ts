import { boolean, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Communication template — one row per (template_key, channel_code, locale_code, tenant_id).
 *
 * NULL tenant_id = system-level default. Tenant-specific overrides take
 * precedence in CommunicationService locale resolution.
 *
 * body_template supports {key} placeholder substitution.
 * subject_template is used only for the email channel.
 */
export const communicationTemplates = pgTable('communication_template', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').references(() => tenants.id),
  templateKey:     text('template_key').notNull(),
  channelCode:     text('channel_code').notNull(),
  localeCode:      text('locale_code').notNull().default('en-GB'),
  subjectTemplate: text('subject_template'),
  bodyTemplate:    text('body_template').notNull(),
  version:         integer('version').notNull().default(1),
  active:          boolean('active').notNull().default(true),
  createdBy:       text('created_by').notNull().default('system'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CommunicationTemplate    = typeof communicationTemplates.$inferSelect;
export type NewCommunicationTemplate = typeof communicationTemplates.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Communication dispatch log — append-only audit trail.
 *
 * Every dispatch attempt is recorded regardless of outcome (dispatched,
 * suppressed by channel flag, or failed). This is the evidence base for
 * "communications are workflow-triggered and auditable".
 *
 * status_code values:
 *   dispatched  — the channel was active; message sent / event published
 *   suppressed  — the channel flag was off; suppression_reason explains which flag
 *   failed      — an error occurred during dispatch; suppression_reason carries the error
 */
export const communicationDispatchLog = pgTable('communication_dispatch_log', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenantId:            uuid('tenant_id').notNull().references(() => tenants.id),
  templateKey:         text('template_key').notNull(),
  channelCode:         text('channel_code').notNull(),
  localeCode:          text('locale_code').notNull(),
  subjectEntityType:   text('subject_entity_type').notNull(),
  subjectEntityId:     uuid('subject_entity_id').notNull(),
  recipientRef:        text('recipient_ref'),
  payload:             jsonb('payload').notNull().default('{}'),
  workflowInstanceId:  uuid('workflow_instance_id'),
  statusCode:          text('status_code').notNull().default('dispatched'),
  suppressionReason:   text('suppression_reason'),
  dispatchedAt:        timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
  dispatchedBy:        text('dispatched_by').notNull(),
});

export type CommunicationDispatchLogEntry    = typeof communicationDispatchLog.$inferSelect;
export type NewCommunicationDispatchLogEntry = typeof communicationDispatchLog.$inferInsert;
