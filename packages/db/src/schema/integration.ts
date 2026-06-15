import { boolean, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/**
 * Platform catalogue of supported integration contracts.
 * One row per contract ID - shared across all tenants.
 * No RLS (read by all authenticated roles; written by system administrator).
 */
export const integrationContracts = pgTable('integration_contract', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  contractId:             text('contract_id').notNull().unique(),
  displayName:            text('display_name').notNull(),
  ownerModuleCode:        text('owner_module_code').notNull(),
  directionCode:          text('direction_code').notNull(),
  patternType:            text('pattern_type').notNull(),
  currentContractVersion: text('current_contract_version').notNull(),
  dataClassificationCode: text('data_classification_code').notNull(),
  deprecatedAt:           timestamp('deprecated_at',            { withTimezone: true }),
  minimumSupportedVersion: text('minimum_supported_version'),
  createdAt:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tenant-specific enabled adapter and endpoint configuration for a contract.
 * Subject to RLS - each tenant only sees its own registrations.
 */
export const integrationRegistrations = pgTable('integration_registration', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  tenantId:                uuid('tenant_id').notNull().references(() => tenants.id),
  integrationContractId:   uuid('integration_contract_id').notNull().references(() => integrationContracts.id),
  integrationCode:         text('integration_code').notNull(),
  displayName:             text('display_name').notNull(),
  contractVersion:         text('contract_version').notNull(),
  transportCode:           text('transport_code').notNull(),
  subjectFilter:           text('subject_filter'),
  consumerGroup:           text('consumer_group'),
  endpointUrl:             text('endpoint_url'),
  fileSchedule:            text('file_schedule'),
  secretRef:               text('secret_ref'),
  replaySupported:         boolean('replay_supported').notNull().default(false),
  retryPolicy:             jsonb('retry_policy').$type<{
    maxAttempts:        number;
    backoffCoefficient: number;
    initialInterval:    string;
    deadLetterSubject:  string;
  }>(),
  enabled:                  boolean('enabled').notNull().default(false),
  configuration:            jsonb('configuration').notNull().$type<Record<string, unknown>>().default({}),
  lastHealthCheckAt:        timestamp('last_health_check_at',         { withTimezone: true }),
  healthStatusCode:         text('health_status_code'),
  lastSuccessfulExchangeAt: timestamp('last_successful_exchange_at',  { withTimezone: true }),
  registeredAt:             timestamp('registered_at',  { withTimezone: true }).notNull().defaultNow(),
  lastUpdatedAt:            timestamp('last_updated_at', { withTimezone: true }).notNull().defaultNow(),
});
// Note: the previous UNIQUE (tenant_id, integration_code) was dropped in 0020_phase7_contract_deprecation.sql
// Tenants may hold multiple registrations for the same contract type (multiple VLE instances, etc.)

/**
 * Append-only inbound/outbound exchange ledger for idempotency, retry,
 * replay, and reconciliation.  One row per exchange attempt.
 * Subject to RLS.
 */
export const integrationExchanges = pgTable('integration_exchange', {
  id:                         uuid('id').primaryKey().defaultRandom(),
  tenantId:                   uuid('tenant_id').notNull().references(() => tenants.id),
  integrationRegistrationId:  uuid('integration_registration_id').notNull().references(() => integrationRegistrations.id),
  contractId:                 text('contract_id').notNull(),
  directionCode:              text('direction_code').notNull(),
  exchangeTypeCode:           text('exchange_type_code').notNull(),
  idempotencyKey:             text('idempotency_key').notNull(),
  correlationId:              uuid('correlation_id'),
  sourceReference:            text('source_reference'),
  statusCode:                 text('status_code').notNull(),
  attemptCount:               smallint('attempt_count').notNull().default(0), // was TEXT - fixed P3-006
  lastAttemptAt:              timestamp('last_attempt_at', { withTimezone: true }),
  lastError:                  text('last_error'),
  payloadHash:                text('payload_hash'),
  payloadSummary:             jsonb('payload_summary'),
  receivedAt:                 timestamp('received_at', { withTimezone: true }),
  sentAt:                     timestamp('sent_at',     { withTimezone: true }),
  createdAt:                  timestamp('created_at',  { withTimezone: true }).notNull().defaultNow(),
});
// UNIQUE (tenant_id, integration_registration_id, idempotency_key) enforced in migration DDL

export type IntegrationContract        = typeof integrationContracts.$inferSelect;
export type IntegrationRegistration    = typeof integrationRegistrations.$inferSelect;
export type IntegrationExchange        = typeof integrationExchanges.$inferSelect;
export type NewIntegrationExchange     = typeof integrationExchanges.$inferInsert;
