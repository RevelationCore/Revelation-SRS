/**
 * Retention Enforcement Service — NFR-PRIV-003
 *
 * Identifies person records that have passed their data retention deadline
 * (per the Data Subject Register: duration of study + 6 years for most
 * categories; permanent for award/transcript records).
 *
 * The service operates in two modes:
 *   dry-run: identify flagged persons, return count, make no changes.
 *   apply:   anonymise in-scope non-permanent personal data for flagged persons.
 *
 * Anonymisation is irreversible.  The service records every action to the
 * audit trail and flags persons that require DPO review (where a lawful hold
 * prevents automated anonymisation — e.g. ongoing litigation, FOI request).
 *
 * Retention policy source: docs/requirements/data-subject-register.md
 */

import { and, eq, sql } from 'drizzle-orm';
import {
  personIdentities,
  persons,
  studentAddresses,
  withTenantContext,
  type Db,
} from '@revelation-srs/db';

import { clockNow } from '../clock.js';
import type { AuditService } from '../audit/service.js';

// Duration-of-study + 6 years expressed as SQL interval for the query.
// Records are eligible once ALL enrolments for the person ended > 6 years ago.
const RETENTION_YEARS = 6;

export type RetentionAction =
  | 'anonymised' | 'flagged-for-dpo' | 'skipped-award-hold'
  // BL-284: anonymisation is irreversible, so anything that says the record
  // must be kept, or is in use for the person's own rights, stops it.
  | 'skipped-hold' | 'skipped-restriction' | 'skipped-open-request' | 'skipped-schedule';

export interface RetentionSweepResult {
  tenantId:   string;
  dryRun:     boolean;
  checkedAt:  string;
  eligible:   number;
  anonymised: number;
  flagged:    number;
  skipped:    number;
  details:    Array<{ personId: string; action: RetentionAction; reason?: string }>;
}

type EligibleRow = {
  person_id:        string;
  has_award:        boolean;
  has_hold:         boolean;
  has_restriction:  boolean;
  has_open_request: boolean;
  schedule_not_due: boolean;
};

export class RetentionEnforcementService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * Run a retention sweep for the given tenant.
   *
   * @param dryRun  If true, identify eligible persons but make no changes.
   */
  async runRetentionSweep(tenantId: string, dryRun = true): Promise<RetentionSweepResult> {
    const checkedAt  = clockNow();
    const cutoffDate = new Date(checkedAt);
    cutoffDate.setFullYear(cutoffDate.getFullYear() - RETENTION_YEARS);

    // Find persons whose last active enrolment ended more than RETENTION_YEARS ago.
    // "ended" means the enrolment status is withdrawn or graduated AND the
    // actual_end_date (or valid_from of the terminal status row) is before the cutoff.
    // Persons with an award record are flagged for DPO review instead of auto-anonymised
    // (award/transcript data is permanently retained per the data subject register).
    const today = checkedAt.toISOString().slice(0, 10);
    const eligibleRows = await withTenantContext(this.db, tenantId, (tx) => tx.execute<EligibleRow>(sql`
      SELECT
        e.person_id::text,
        -- A legal hold on the person or any of their enrolments.
        EXISTS (
          SELECT 1 FROM record_hold h
          JOIN retention_assignment ra ON ra.id = h.retention_assignment_id
          WHERE ra.tenant_id = e.tenant_id AND h.lifted_at IS NULL
            AND (ra.entity_id = e.person_id
                 OR ra.entity_id IN (SELECT e3.id FROM enrolment e3 WHERE e3.person_id = e.person_id AND e3.tenant_id = e.tenant_id))
        ) AS has_hold,
        -- A processing restriction (UK GDPR art. 18): the data may only be stored.
        EXISTS (
          SELECT 1 FROM processing_restriction r
          WHERE r.tenant_id = e.tenant_id AND r.person_id = e.person_id AND r.lifted_at IS NULL
        ) AS has_restriction,
        -- A rights request still being handled: destroying the data could be an
        -- offence (DPA 2018 s.173).
        EXISTS (
          SELECT 1 FROM individual_rights_request q
          JOIN business_case bc ON bc.id = q.business_case_id AND bc.tenant_id = q.tenant_id
          WHERE q.tenant_id = e.tenant_id AND q.person_id = e.person_id
            AND bc.status_code NOT IN ('closed', 'withdrawn')
        ) AS has_open_request,
        -- A configured retention schedule that is not yet due overrides the default.
        EXISTS (
          SELECT 1 FROM retention_assignment ra
          WHERE ra.tenant_id = e.tenant_id AND ra.entity_id = e.person_id
            AND ra.scheduled_disposal_date > ${today}::date
        ) AS schedule_not_due,
        EXISTS (
          SELECT 1 FROM award a
          WHERE a.person_id  = e.person_id
            AND a.tenant_id  = e.tenant_id
            AND a.recorded_until IS NULL
        ) AS has_award
      FROM enrolment e
      WHERE e.tenant_id       = ${tenantId}::uuid
        AND e.recorded_until  IS NULL
        AND e.status_code     IN ('withdrawn', 'graduated')
        AND e.actual_end_date IS NOT NULL
        AND e.actual_end_date < ${cutoffDate.toISOString().slice(0, 10)}
        AND NOT EXISTS (
          SELECT 1 FROM enrolment e2
          WHERE e2.person_id     = e.person_id
            AND e2.tenant_id     = e.tenant_id
            AND e2.recorded_until IS NULL
            AND e2.status_code   IN ('enrolled', 'intermitting', 'suspended')
        )
        AND NOT EXISTS (
          SELECT 1 FROM person p2
          WHERE p2.id         = e.person_id
            AND p2.tenant_id  = e.tenant_id
            AND p2.retention_anonymised_at IS NOT NULL
        )
      GROUP BY e.person_id, e.tenant_id
    `)) as unknown as EligibleRow[];

    const details: RetentionSweepResult['details'] = [];
    let anonymised = 0;
    let flagged    = 0;
    let skipped    = 0;

    for (const row of eligibleRows) {
      const { person_id: personId } = row;

      // Cast the boolean from SQL — it may come back as 't'/'f' from pg
      const flag = (v: unknown) => v === true || String(v) === 't';
      const hasAward = flag(row.has_award);

      const skip = flag(row.has_hold) ? ['skipped-hold', 'active-record-hold'] as const
        : flag(row.has_restriction) ? ['skipped-restriction', 'active-processing-restriction'] as const
        : flag(row.has_open_request) ? ['skipped-open-request', 'open-rights-request'] as const
        : flag(row.schedule_not_due) ? ['skipped-schedule', 'retention-schedule-not-due'] as const
        : null;
      if (skip) {
        details.push({ personId, action: skip[0], reason: skip[1] });
        skipped++;
        continue;
      }

      if (hasAward) {
        // Award/transcript data is permanently retained — flag for DPO review
        details.push({ personId, action: 'flagged-for-dpo', reason: 'has-award-record' });
        flagged++;

        if (!dryRun) {
          await this.audit.record({
            tenantId,
            entityType: 'person',
            entityId:   personId,
            actionType: 'update',
            actorType:  'system',
            actorId:    'retention-enforcement-service',
            reasonCode: 'retention-dpo-flag',
            reasonText: 'Person has award record — retention deadline passed; flagged for DPO review rather than auto-anonymised.',
          });
        }
        continue;
      }

      if (dryRun) {
        details.push({ personId, action: 'anonymised' });
        anonymised++;
        continue;
      }

      // Apply: anonymise personal identity data in place.
      // Award records (progression_decision.outcome_code = 'award') are preserved.
      // Identity/contact fields are replaced with anonymised tokens.
      const anonToken = `ANON-${personId.slice(0, 8).toUpperCase()}`;

      await withTenantContext(this.db, tenantId, async (tx) => {
        // Anonymise all person_identity versions for this person
        await tx
          .update(personIdentities)
          .set({
            legalFirstName:  anonToken,
            legalFamilyName: anonToken,
            preferredName:    null,
            dateOfBirth:      null,
            genderCode:       null,
            nationalityCode:  null,
            domicileCode:     null,
            ethnicityCode:    null,
            emailInstitutional: null,
            emailPersonal:      null,
            phoneMobile:        null,
          })
          .where(
            and(
              eq(personIdentities.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
              eq(personIdentities.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            ),
          );

        // Anonymise all student addresses
        await tx
          .update(studentAddresses)
          .set({
            line1:       anonToken,
            line2:       null,
            city:        null,
            postcode:    null,
            countryCode: null,
          })
          .where(
            and(
              eq(studentAddresses.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
              eq(studentAddresses.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            ),
          );

        // Mark person record as anonymised
        await tx
          .update(persons)
          .set({ retentionAnonymisedAt: clockNow() })
          .where(
            and(
              eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
              eq(persons.id,       personId as `${string}-${string}-${string}-${string}-${string}`),
            ),
          );
      });

      await this.audit.record({
        tenantId,
        entityType: 'person',
        entityId:   personId,
        actionType: 'update',
        actorType:  'system',
        actorId:    'retention-enforcement-service',
        reasonCode: 'retention-anonymised',
        reasonText: `Personal data anonymised — retention period (${RETENTION_YEARS} years post-study) expired.`,
      });

      details.push({ personId, action: 'anonymised' });
      anonymised++;
    }

    return {
      tenantId,
      dryRun,
      checkedAt: checkedAt.toISOString(),
      eligible:  eligibleRows.length,
      anonymised,
      flagged,
      skipped,
      details,
    };
  }
}
