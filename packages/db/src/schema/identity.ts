import { boolean, date, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Root identity record — one row per person, non-bitemporal.
 *
 * Personal data changes are recorded in person_identity (bitemporal).
 * student_number is institution-assigned and unique per tenant; generated
 * from the platform sequence student_number_seq.
 */
export const persons = pgTable('person', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  studentNumber:   text('student_number').notNull(),
  hesaId:          text('hesa_id'),
  personStatusCode: text('person_status_code').notNull().default('prospective'),
  sourceSystem:    text('source_system'),     // 'ucas' | 'direct' | 'manual'
  sourceReference: text('source_reference'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  retentionAnonymisedAt: timestamp('retention_anonymised_at', { withTimezone: true }),
});

export type Person    = typeof persons.$inferSelect;
export type NewPerson = typeof persons.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal personal data — legal name, demographics, contact details.
 * Special-category fields (ethnicity_code) are stored here; read audit applies.
 */
export const personIdentities = pgTable('person_identity', {
  ...bitemporalColumns,
  tenantId:           uuid('tenant_id').notNull().references(() => tenants.id),
  personId:           uuid('person_id').notNull().references(() => persons.id),
  legalFirstName:     text('legal_first_name').notNull(),
  legalFamilyName:    text('legal_family_name').notNull(),
  preferredName:      text('preferred_name'),
  dateOfBirth:        date('date_of_birth'),
  genderCode:         text('gender_code'),
  nationalityCode:    text('nationality_code'),
  domicileCode:       text('domicile_code'),
  ethnicityCode:      text('ethnicity_code'),  // special-category
  emailInstitutional:      text('email_institutional'),
  emailPersonal:           text('email_personal'),
  phoneMobile:             text('phone_mobile'),
  preferredPronouns:       text('preferred_pronouns'),         // self-declared, free text e.g. 'they/them'
  communicationLocaleCode: text('communication_locale_code'),  // BCP-47, e.g. 'en-GB'
  preferredTimeZone:       text('preferred_time_zone'),        // IANA, e.g. 'Europe/London'
});

export type PersonIdentity    = typeof personIdentities.$inferSelect;
export type NewPersonIdentity = typeof personIdentities.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal address history.  Multiple addresses per person (home, term,
 * correspondence) can be current simultaneously.
 */
export const studentAddresses = pgTable('student_address', {
  ...bitemporalColumns,
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  personId:        uuid('person_id').notNull().references(() => persons.id),
  addressTypeCode: text('address_type_code').notNull(), // 'home' | 'term' | 'correspondence'
  line1:           text('line1').notNull(),
  line2:           text('line2'),
  city:            text('city'),
  postcode:        text('postcode'),
  countryCode:     text('country_code'),                // ISO 3166-1 alpha-2
});

export type StudentAddress    = typeof studentAddresses.$inferSelect;
export type NewStudentAddress = typeof studentAddresses.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal contact methods (email, phone) — supplements person_identity
 * with verified status and primary-flag per type.
 */
export const studentContactMethods = pgTable('student_contact_method', {
  ...bitemporalColumns,
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  personId:        uuid('person_id').notNull().references(() => persons.id),
  contactTypeCode: text('contact_type_code').notNull(),
  contactValue:    text('contact_value').notNull(),
  isPrimary:       boolean('is_primary').notNull().default(false),
  verifiedAt:      timestamp('verified_at', { withTimezone: true }),
});

export type StudentContactMethod    = typeof studentContactMethods.$inferSelect;
export type NewStudentContactMethod = typeof studentContactMethods.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal disability declarations.  Special-category data; read audit applies.
 * HESA disability category codes, plus declaration status lifecycle.
 */
export const disabilityDeclarations = pgTable('disability_declaration', {
  ...bitemporalColumns,
  tenantId:                uuid('tenant_id').notNull().references(() => tenants.id),
  personId:                uuid('person_id').notNull().references(() => persons.id),
  disabilityCategoryCode:  text('disability_category_code').notNull(),
  declarationStatusCode:   text('declaration_status_code').notNull().default('declared'),
  declaredAt:              timestamp('declared_at', { withTimezone: true }).notNull().defaultNow(),
  notes:                   text('notes'),
});

export type DisabilityDeclaration    = typeof disabilityDeclarations.$inferSelect;
export type NewDisabilityDeclaration = typeof disabilityDeclarations.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bitemporal Online Identity Verification (OIV) outcomes.
 * Fraud flag is sensitive; stored separately from personal identity data.
 */
export const identityVerificationChecks = pgTable('identity_verification_check', {
  ...bitemporalColumns,
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  personId:          uuid('person_id').notNull().references(() => persons.id),
  statusCode:        text('status_code').notNull(),  // 'requested' | 'verified' | 'failed' | 'fraud-flagged'
  confidenceScore:   smallint('confidence_score'),
  fraudFlag:         boolean('fraud_flag').notNull().default(false),
  providerReference: text('provider_reference'),
  requestedAt:       timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:       timestamp('completed_at', { withTimezone: true }),
});

export type IdentityVerificationCheck    = typeof identityVerificationChecks.$inferSelect;
export type NewIdentityVerificationCheck = typeof identityVerificationChecks.$inferInsert;
