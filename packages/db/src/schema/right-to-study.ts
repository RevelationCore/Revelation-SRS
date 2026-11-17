import { date, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { tenants } from './tenant.js';

/**
 * Right to study (Phase 3 D-17; BP-02-002): who checked, on what basis, by
 * which method, and when the permission expires. Separate from identity
 * verification. A specialist decision or a recheck is a new version.
 */
export const rightToStudyChecks = pgTable('right_to_study_check', {
  ...bitemporalColumns,
  tenantId:                    uuid('tenant_id').notNull().references(() => tenants.id),
  personId:                    uuid('person_id').notNull(),
  enrolmentId:                 uuid('enrolment_id'),
  casCaseId:                   uuid('cas_case_id'),
  basisCode:                   text('basis_code'),
  methodCode:                  text('method_code'),
  outcomeCode:                 text('outcome_code').notNull(), // pending | eligible | not-eligible | referred | recheck-required
  checkedBy:                   text('checked_by').notNull(),
  checkedAt:                   timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  permissionExpiresOn:         date('permission_expires_on'),
  ukEntryDate:                 date('uk_entry_date'),
  restrictionCode:             text('restriction_code'),
  evidenceRef:                 text('evidence_ref'),
  identityVerificationCheckId: uuid('identity_verification_check_id'),
  recheckDueOn:                date('recheck_due_on'),
  /** A View and Prove share code the student submitted; cleared once the check is completed. */
  shareCode:                   text('share_code'),
  note:                        text('note'),
  expiryWarningSentAt:         timestamp('expiry_warning_sent_at', { withTimezone: true }),
});

export type RightToStudyCheck = typeof rightToStudyChecks.$inferSelect;
