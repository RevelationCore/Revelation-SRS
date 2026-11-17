import { boolean, date, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenant.js';

/** An award document a student is entitled to (BPR-D15; BP-06-004). */
export const studentDocuments = pgTable('student_document', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  awardId:          uuid('award_id').notNull(),
  enrolmentId:      uuid('enrolment_id').notNull(),
  personId:         uuid('person_id').notNull(),
  documentTypeCode: text('document_type_code').notNull(),
  createdBy:        text('created_by').notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type StudentDocument = typeof studentDocuments.$inferSelect;

/** One issue of a document: numbered, with its content snapshot, hash and verification code. */
export const documentIssues = pgTable('document_issue', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull().references(() => tenants.id),
  studentDocumentId: uuid('student_document_id').notNull().references(() => studentDocuments.id),
  issueNumber:       smallint('issue_number').notNull(),
  issueTypeCode:     text('issue_type_code').notNull(),
  contentSnapshot:   jsonb('content_snapshot').notNull().$type<Record<string, unknown>>(),
  contentHash:       text('content_hash').notNull(),
  verificationCode:  text('verification_code').notNull(),
  channelCode:       text('channel_code').notNull(),
  statusCode:        text('status_code').notNull().default('issued'), // issued | superseded | revoked
  issuedBy:          text('issued_by').notNull(),
  issuedAt:          timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  // Rendering and signing (Phase 3 D-20).
  renderedDocumentId: uuid('rendered_document_id'),
  templateCode:       text('template_code'),
  templateVersion:    text('template_version'),
  pdfSha256:          text('pdf_sha256'),
  signingKeyId:       text('signing_key_id'),
  signatureJws:       text('signature_jws'),
});
export type DocumentIssue = typeof documentIssues.$inferSelect;

/** Append-only revocation of an issue. */
export const documentRevocations = pgTable('document_revocation', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  documentIssueId: uuid('document_issue_id').notNull().references(() => documentIssues.id),
  reasonCode:      text('reason_code').notNull(),
  reasonText:      text('reason_text').notNull(),
  revokedBy:       text('revoked_by').notNull(),
  revokedAt:       timestamp('revoked_at', { withTimezone: true }).notNull().defaultNow(),
});
export type DocumentRevocation = typeof documentRevocations.$inferSelect;

/** Each verification check and its outcome. */
export const documentVerifications = pgTable('document_verification', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenantId:         uuid('tenant_id').notNull().references(() => tenants.id),
  documentIssueId:  uuid('document_issue_id'),
  verificationCode: text('verification_code').notNull(),
  requestedBy:      text('requested_by').notNull(),
  requesterNote:    text('requester_note'),
  outcomeCode:      text('outcome_code').notNull(), // valid | revoked | superseded | not-found
  // Phase 3 D-21: how it was checked, a salted hash of a public requester's IP, and a staff lookup's consent.
  methodCode:         text('method_code').notNull().default('code'), // code | file | staff-lookup
  requesterIpHash:    text('requester_ip_hash'),
  consentEvidenceRef: text('consent_evidence_ref'),
  checkedAt:        timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
});
export type DocumentVerification = typeof documentVerifications.$inferSelect;

/** A graduation cycle (BP-06-005). */
export const graduationCycles = pgTable('graduation_cycle', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenantId:   uuid('tenant_id').notNull().references(() => tenants.id),
  cycleCode:  text('cycle_code').notNull(),
  title:      text('title').notNull(),
  awardsFrom: date('awards_from').notNull(),
  awardsTo:   date('awards_to').notNull(),
  statusCode: text('status_code').notNull().default('open'), // open | frozen | closed
  createdBy:  text('created_by').notNull(),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  frozenAt:   timestamp('frozen_at', { withTimezone: true }),
});
export type GraduationCycle = typeof graduationCycles.$inferSelect;

export const graduationCeremonies = pgTable('graduation_ceremony', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  cycleId:      uuid('cycle_id').notNull().references(() => graduationCycles.id),
  ceremonyCode: text('ceremony_code').notNull(),
  startsAt:     timestamp('starts_at', { withTimezone: true }).notNull(),
  venue:        text('venue').notNull(),
  capacity:     integer('capacity').notNull(),
  guestLimit:   smallint('guest_limit').notNull().default(2),
});
export type GraduationCeremony = typeof graduationCeremonies.$inferSelect;

export const graduationInvitations = pgTable('graduation_invitation', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull().references(() => tenants.id),
  cycleId:               uuid('cycle_id').notNull().references(() => graduationCycles.id),
  awardId:               uuid('award_id').notNull(),
  personId:              uuid('person_id').notNull(),
  responseCode:          text('response_code').notNull().default('invited'), // invited | attending | in-absentia | deferred | declined
  guestCount:            smallint('guest_count').notNull().default(0),
  accessibilityRequired: boolean('accessibility_required').notNull().default(false),
  respondedAt:           timestamp('responded_at', { withTimezone: true }),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export type GraduationInvitation = typeof graduationInvitations.$inferSelect;

export const ceremonyAllocations = pgTable('ceremony_allocation', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  invitationId:         uuid('invitation_id').notNull().references(() => graduationInvitations.id),
  ceremonyId:           uuid('ceremony_id').notNull().references(() => graduationCeremonies.id),
  presentationOrder:    integer('presentation_order'),
  attendanceCode:       text('attendance_code').notNull().default('allocated'), // allocated | attended | absent
  allocatedBy:          text('allocated_by').notNull(),
  allocatedAt:          timestamp('allocated_at', { withTimezone: true }).notNull().defaultNow(),
  attendanceRecordedAt: timestamp('attendance_recorded_at', { withTimezone: true }),
});
export type CeremonyAllocation = typeof ceremonyAllocations.$inferSelect;

/** The institution's public document-signing keys (Phase 3 D-20), published at its JWKS endpoint. */
export const documentSigningKeys = pgTable('document_signing_key', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  keyId:         text('key_id').notNull(),
  algorithm:     text('algorithm').notNull().default('ES256'),
  publicKeyPem:  text('public_key_pem').notNull(),
  providerCode:  text('provider_code').notNull(), // local-key | openbao-transit
  statusCode:    text('status_code').notNull().default('active'), // active | retired | compromised
  registeredBy:  text('registered_by').notNull(),
  registeredAt:  timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  retiredAt:     timestamp('retired_at', { withTimezone: true }),
  compromisedAt: timestamp('compromised_at', { withTimezone: true }),
});

export type DocumentSigningKey = typeof documentSigningKeys.$inferSelect;
