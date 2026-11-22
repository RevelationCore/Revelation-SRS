/**
 * Retention Enforcement Service — NFR-PRIV-003
 *
 * Identifies person records that have passed their data retention deadline
 * (per the Data Subject Register: duration of study + 6 years for most
 * categories; permanent for award/transcript records).
 *
 * Disposal takes two people (BL-327):
 *   dry run:  identify eligible persons, make no changes (runRetentionSweep).
 *   prepare:  a DPO stores the dry run's anonymisations as a plan.
 *   approve:  a different person holding retention:approve approves it.
 *   execute:  only an approved plan is applied, only if every person in it
 *             is still eligible, and each disposal gets a certificate.
 *
 * Anonymisation is irreversible.  The service records every action to the
 * audit trail and flags persons that require DPO review (where a lawful hold
 * prevents automated anonymisation — e.g. ongoing litigation, FOI request).
 *
 * Retention policy source: docs/requirements/data-subject-register.md
 */

import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';
import {
  personIdentities,
  persons,
  recordDispositions,
  retentionDisposalPlanItems,
  retentionDisposalPlans,
  studentAddresses,
  withTenantContext,
  type Db,
  type RetentionDisposalPlan,
  type TenantScopedDb,
} from '@revelation-srs/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@revelation-srs/domain';

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
   * Dry run: who the sweep would anonymise, flag for the DPO or skip, and
   * why. Makes no changes. Disposal itself goes through an approved plan
   * (preparePlan, approvePlan, executePlan); dryRun=false is refused.
   */
  async runRetentionSweep(tenantId: string, dryRun = true): Promise<RetentionSweepResult> {
    if (!dryRun) {
      throw new ConflictError('Retention disposal needs an approved plan (BL-327): prepare one with POST /admin/retention/plans, have a second person approve it, then execute it');
    }
    const { checkedAt, eligible, details } = await this.#evaluate(tenantId);
    return {
      tenantId,
      dryRun: true,
      checkedAt: checkedAt.toISOString(),
      eligible,
      anonymised: details.filter((d) => d.action === 'anonymised').length,
      flagged:    details.filter((d) => d.action === 'flagged-for-dpo').length,
      skipped:    details.filter((d) => d.action.startsWith('skipped')).length,
      details,
    };
  }

  /** Stores the dry run's anonymisations as a plan for a second person to approve. */
  async preparePlan(tenantId: string, actorId: string): Promise<RetentionPlanDto> {
    const { details } = await this.#evaluate(tenantId);
    const personIds = details.filter((d) => d.action === 'anonymised').map((d) => d.personId).sort();
    if (personIds.length === 0) throw new ValidationError('No one is due for disposal, so there is nothing to plan');
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(retentionDisposalPlans).values({
        id, tenantId: tenantId as Uuid, statusCode: 'prepared', preparedBy: actorId, preparedAt: clockNow(), planHash: planHash(personIds),
      });
      await tx.insert(retentionDisposalPlanItems).values(personIds.map((personId) => ({
        tenantId: tenantId as Uuid, planId: id, personId: personId as Uuid, actionCode: 'anonymised',
      })));
    });
    for (const d of details.filter((x) => x.action === 'flagged-for-dpo')) {
      await this.audit.record({
        tenantId, entityType: 'person', entityId: d.personId, actionType: 'update', actorType: 'user', actorId,
        reasonCode: 'retention-dpo-flag',
        reasonText: 'Person has award record — retention deadline passed; flagged for DPO review rather than auto-anonymised.',
      });
    }
    await this.#auditPlan(tenantId, id, actorId, 'retention-plan-prepared', `Disposal plan prepared for ${personIds.length} person(s)`);
    return this.getPlan(tenantId, id);
  }

  async getPlan(tenantId: string, planId: string): Promise<RetentionPlanDto> {
    const { plan, personIds } = await this.#loadPlan(tenantId, planId);
    return toPlanDto(plan, personIds);
  }

  async listPlans(tenantId: string): Promise<RetentionPlanDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(retentionDisposalPlans).where(eq(retentionDisposalPlans.tenantId, tenantId as Uuid)).orderBy(asc(retentionDisposalPlans.preparedAt)));
    return Promise.all(rows.map((p) => this.getPlan(tenantId, p.id)));
  }

  /** A second person approves; the preparer never can. */
  async approvePlan(tenantId: string, planId: string, actorId: string): Promise<RetentionPlanDto> {
    const { plan } = await this.#loadPlan(tenantId, planId);
    if (plan.preparedBy === actorId) throw new ForbiddenError('A disposal plan is approved by someone other than the person who prepared it');
    const updated = await withTenantContext(this.db, tenantId, (tx) => tx.update(retentionDisposalPlans)
      .set({ statusCode: 'approved', approvedBy: actorId, approvedAt: clockNow() })
      .where(and(eq(retentionDisposalPlans.id, planId as Uuid), eq(retentionDisposalPlans.statusCode, 'prepared')))
      .returning({ id: retentionDisposalPlans.id }));
    if (updated.length === 0) throw new ConflictError(`Only a prepared plan can be approved; this one is ${plan.statusCode}`);
    await this.#auditPlan(tenantId, planId, actorId, 'retention-plan-approved', 'Disposal plan approved');
    return this.getPlan(tenantId, planId);
  }

  async rejectPlan(tenantId: string, planId: string, actorId: string, reason: string): Promise<RetentionPlanDto> {
    const { plan } = await this.#loadPlan(tenantId, planId);
    if (plan.preparedBy === actorId) throw new ForbiddenError('A disposal plan is rejected by someone other than the person who prepared it');
    const updated = await withTenantContext(this.db, tenantId, (tx) => tx.update(retentionDisposalPlans)
      .set({ statusCode: 'rejected', rejectedBy: actorId, rejectedAt: clockNow(), rejectionReason: reason })
      .where(and(eq(retentionDisposalPlans.id, planId as Uuid), eq(retentionDisposalPlans.statusCode, 'prepared')))
      .returning({ id: retentionDisposalPlans.id }));
    if (updated.length === 0) throw new ConflictError(`Only a prepared plan can be rejected; this one is ${plan.statusCode}`);
    await this.#auditPlan(tenantId, planId, actorId, 'retention-plan-rejected', reason);
    return this.getPlan(tenantId, planId);
  }

  /**
   * Applies an approved plan, all or nothing: refused if anyone in it is no
   * longer eligible (a hold, restriction, request or new enrolment since it
   * was prepared). Each person gets a record_disposition with a certificate
   * reference. A plan executes once.
   */
  async executePlan(tenantId: string, planId: string, actorId: string): Promise<RetentionExecutionResult> {
    const { plan, personIds } = await this.#loadPlan(tenantId, planId);
    if (plan.statusCode !== 'approved') throw new ConflictError(`Only an approved plan can be executed; this one is ${plan.statusCode}`);
    if (planHash(personIds) !== plan.planHash) throw new ConflictError('The plan\'s contents no longer match what was approved');

    const { details } = await this.#evaluate(tenantId, personIds);
    const stillDue = new Set(details.filter((d) => d.action === 'anonymised').map((d) => d.personId));
    const changed = personIds.filter((id) => !stillDue.has(id)).map((personId) =>
      `${personId} (${details.find((d) => d.personId === personId)?.reason ?? 'no longer past retention'})`);
    if (changed.length > 0) {
      throw new ConflictError(`Eligibility changed since the plan was prepared, so nothing was disposed of; prepare a new plan. Changed: ${changed.join(', ')}`);
    }

    const executedAt = clockNow();
    const certificates: Array<{ personId: string; certificateRef: string }> = [];
    await withTenantContext(this.db, tenantId, async (tx) => {
      // Claim the plan first, so two executions cannot both run it.
      const claimed = await tx.update(retentionDisposalPlans)
        .set({ statusCode: 'executed', executedBy: actorId, executedAt })
        .where(and(eq(retentionDisposalPlans.id, planId as Uuid), eq(retentionDisposalPlans.statusCode, 'approved')))
        .returning({ id: retentionDisposalPlans.id });
      if (claimed.length === 0) throw new ConflictError('The plan was executed or changed by someone else');
      for (const [i, personId] of personIds.entries()) {
        await anonymise(tx, tenantId, personId, executedAt);
        const certificateRef = `RDC-${planId.slice(0, 8).toUpperCase()}-${String(i + 1).padStart(4, '0')}`;
        await tx.insert(recordDispositions).values({
          tenantId: tenantId as Uuid, personId: personId as Uuid, disposalPlanId: planId as Uuid, certificateRef,
          dispositionTypeCode: 'anonymised', executedAt, executedBy: actorId,
          evidenceRef: `retention-disposal-plan:${planId}`,
        });
        certificates.push({ personId, certificateRef });
      }
    });

    for (const c of certificates) {
      await this.audit.record({
        tenantId, entityType: 'person', entityId: c.personId, actionType: 'update', actorType: 'user', actorId,
        reasonCode: 'retention-anonymised',
        reasonText: `Personal data anonymised under disposal plan ${planId} (certificate ${c.certificateRef}), prepared by ${plan.preparedBy} and approved by ${plan.approvedBy ?? ''}; retention period (${RETENTION_YEARS} years post-study) expired.`,
      });
    }
    await this.#auditPlan(tenantId, planId, actorId, 'retention-plan-executed', `Disposal plan executed for ${certificates.length} person(s)`);
    return { planId, executedAt: executedAt.toISOString(), anonymised: certificates.length, certificates };
  }

  async #loadPlan(tenantId: string, planId: string): Promise<{ plan: RetentionDisposalPlan; personIds: string[] }> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const [plan] = await tx.select().from(retentionDisposalPlans)
        .where(and(eq(retentionDisposalPlans.id, planId as Uuid), eq(retentionDisposalPlans.tenantId, tenantId as Uuid)));
      if (!plan) throw new NotFoundError('Retention disposal plan', planId);
      const items = await tx.select({ personId: retentionDisposalPlanItems.personId }).from(retentionDisposalPlanItems)
        .where(eq(retentionDisposalPlanItems.planId, planId as Uuid));
      return { plan, personIds: items.map((i) => i.personId).sort() };
    });
  }

  async #auditPlan(tenantId: string, planId: string, actorId: string, reasonCode: string, reasonText: string): Promise<void> {
    await this.audit.record({
      tenantId, entityType: 'retention_disposal_plan', entityId: planId, actionType: 'update', actorType: 'user', actorId, reasonCode, reasonText,
    });
  }

  /** Who is past retention, and what the sweep may do with each (no changes). */
  async #evaluate(tenantId: string, onlyPersonIds?: string[]): Promise<{ checkedAt: Date; eligible: number; details: RetentionSweepResult['details'] }> {
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
        ${onlyPersonIds ? sql`AND e.person_id IN (${sql.join(onlyPersonIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
      GROUP BY e.person_id, e.tenant_id
    `)) as unknown as EligibleRow[];

    const flag = (v: unknown) => v === true || String(v) === 't';
    const details: RetentionSweepResult['details'] = eligibleRows.map((row) => {
      const personId = row.person_id;
      if (flag(row.has_hold)) return { personId, action: 'skipped-hold', reason: 'active-record-hold' };
      if (flag(row.has_restriction)) return { personId, action: 'skipped-restriction', reason: 'active-processing-restriction' };
      if (flag(row.has_open_request)) return { personId, action: 'skipped-open-request', reason: 'open-rights-request' };
      if (flag(row.schedule_not_due)) return { personId, action: 'skipped-schedule', reason: 'retention-schedule-not-due' };
      // Award/transcript data is permanently retained — flag for DPO review.
      if (flag(row.has_award)) return { personId, action: 'flagged-for-dpo', reason: 'has-award-record' };
      return { personId, action: 'anonymised' };
    });
    return { checkedAt, eligible: eligibleRows.length, details };
  }
}

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface RetentionPlanDto {
  planId:          string;
  statusCode:      string;
  preparedBy:      string;
  preparedAt:      string;
  approvedBy:      string | null;
  approvedAt:      string | null;
  rejectedBy:      string | null;
  rejectionReason: string | null;
  executedBy:      string | null;
  executedAt:      string | null;
  personIds:       string[];
}

export interface RetentionExecutionResult {
  planId:       string;
  executedAt:   string;
  anonymised:   number;
  certificates: Array<{ personId: string; certificateRef: string }>;
}

function planHash(personIds: readonly string[]): string {
  return createHash('sha256').update([...personIds].sort().join('\n')).digest('hex');
}

function toPlanDto(p: RetentionDisposalPlan, personIds: string[]): RetentionPlanDto {
  return {
    planId: p.id, statusCode: p.statusCode, preparedBy: p.preparedBy, preparedAt: p.preparedAt.toISOString(),
    approvedBy: p.approvedBy, approvedAt: p.approvedAt?.toISOString() ?? null,
    rejectedBy: p.rejectedBy, rejectionReason: p.rejectionReason,
    executedBy: p.executedBy, executedAt: p.executedAt?.toISOString() ?? null, personIds,
  };
}

/** Anonymise one person's identity and contact data in place (irreversible). */
async function anonymise(tx: TenantScopedDb, tenantId: string, personId: string, at: Date): Promise<void> {
  const anonToken = `ANON-${personId.slice(0, 8).toUpperCase()}`;
  await tx.update(personIdentities)
    .set({
      legalFirstName: anonToken, legalFamilyName: anonToken, preferredName: null, dateOfBirth: null, genderCode: null,
      nationalityCode: null, domicileCode: null, ethnicityCode: null, emailInstitutional: null, emailPersonal: null, phoneMobile: null,
    })
    .where(and(eq(personIdentities.tenantId, tenantId as Uuid), eq(personIdentities.personId, personId as Uuid)));
  await tx.update(studentAddresses)
    .set({ line1: anonToken, line2: null, city: null, postcode: null, countryCode: null })
    .where(and(eq(studentAddresses.tenantId, tenantId as Uuid), eq(studentAddresses.personId, personId as Uuid)));
  await tx.update(persons)
    .set({ retentionAnonymisedAt: at })
    .where(and(eq(persons.tenantId, tenantId as Uuid), eq(persons.id, personId as Uuid)));
}
