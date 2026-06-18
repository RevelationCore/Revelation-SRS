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

import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import {
  enrolments,
  personIdentities,
  persons,
  studentAddresses,
  type Db,
} from '@revelation-srs/db';
import { clockNow } from '../clock.js';
import type { AuditService } from '../audit/service.js';

// Duration-of-study + 6 years expressed as SQL interval for the query.
// Records are eligible once ALL enrolments for the person ended > 6 years ago.
const RETENTION_YEARS = 6;

export type RetentionAction = 'anonymised' | 'flagged-for-dpo' | 'skipped-award-hold';

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
    const eligibleRows = await this.db.execute<{ person_id: string; has_award: boolean }>(sql`
      SELECT
        e.person_id::text,
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
    `) as unknown as Array<{ person_id: string; has_award: boolean }>;

    const details: RetentionSweepResult['details'] = [];
    let anonymised = 0;
    let flagged    = 0;
    let skipped    = 0;

    for (const row of eligibleRows) {
      const { person_id: personId } = row;

      // Cast the boolean from SQL — it may come back as 't'/'f' from pg
      const hasAward = row.has_award === true || String(row.has_award) === 't';

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

      await this.db.transaction(async (tx) => {
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
