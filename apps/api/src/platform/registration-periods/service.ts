import { randomUUID } from 'node:crypto';

import {
  enrolments,
  feeLiabilities,
  progressionDecisions,
  reenrolmentConfirmations,
  reenrolmentPeriods,
  tenants,
  type Db,
  type ReenrolmentConfirmation,
  type ReenrolmentPeriod,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, EVENT_TYPES, NotFoundError, ValidationError, type StudentReEnrolledV1Payload } from '@revelation-srs/domain';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { clockNow } from '../clock.js';
import { type EnrolmentSubject, subjectsForEnrolments } from '../enrolment/subjects.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Something that stops a student registering, from a connected system such
 * as finance (D-8). The SRS holds no debt facts itself, so by default nothing
 * blocks; an institution can plug in a provider under its own policy.
 */
export interface RegistrationBlocker { code: string; message: string }
export interface RegistrationBlockerProvider {
  blockersFor(tenantId: string, enrolmentId: string, academicYear: string): Promise<RegistrationBlocker[]>;
}
export const noRegistrationBlockers: RegistrationBlockerProvider = { blockersFor: () => Promise.resolve([]) };

export interface OpenPeriodInput {
  academicYear: string;
  programmeId?: string;
  opensAt: string;
  closesAt: string;
  reminderAt?: string;
  periodTypeCode?: 'annual' | 'initial';
}

export interface PeriodDto extends ReenrolmentPeriod { counts: { pending: number; confirmed: number; lapsed: number } }
export interface ConfirmationDto extends ReenrolmentConfirmation { subject: EnrolmentSubject | undefined }
export interface MyRegistrationDto {
  confirmation: ReenrolmentConfirmation;
  period: ReenrolmentPeriod;
  enrolment: { enrolmentId: string; programmeId: string | null; programmeCode: string | null; programmeName: string | null; modeOfStudyCode: string; statusCode: string };
  /** Why the student cannot confirm now; empty when they can. */
  blockers: RegistrationBlocker[];
  termsVersion: string | null;
}

/**
 * Annual re-registration and the initial registration of new entrants
 * (BP-02-010; D-8, D-10). Opening a period gives each eligible enrolment a
 * pending confirmation; the student (or the registry on their behalf)
 * confirms it, accepting the current terms; closing the period lapses the
 * rest. Confirming never changes an annual enrolment's status: the
 * confirmation is the record that the student is registered for the year.
 */
export class RegistrationPeriodService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly blockers: RegistrationBlockerProvider = noRegistrationBlockers,
  ) {}

  async openPeriod(tenantId: string, input: OpenPeriodInput, actorId: string): Promise<PeriodDto> {
    if (!/^\d{4}-\d{2}$/.test(input.academicYear)) throw new ValidationError('The academic year looks like 2027-28');
    if (new Date(input.closesAt) <= new Date(input.opensAt)) throw new ValidationError('A period must close after it opens');
    if (!(await this.termsVersion(tenantId))) {
      throw new ValidationError('Set the registration terms version (tenant configuration registrationTermsVersion) before opening a period');
    }
    const [period] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(reenrolmentPeriods).values({
      tenantId: tenantId as Uuid, academicYear: input.academicYear, programmeId: (input.programmeId ?? null) as Uuid | null,
      opensAt: new Date(input.opensAt), closesAt: new Date(input.closesAt), reminderAt: input.reminderAt ? new Date(input.reminderAt) : null,
      periodTypeCode: input.periodTypeCode ?? 'annual', openedBy: actorId,
    }).returning());
    await this.refreshPeriod(tenantId, period!.id);
    return this.getPeriod(tenantId, period!.id);
  }

  /**
   * Gives every eligible enrolment without one a pending confirmation. Safe to
   * repeat: it adds students who became eligible since the period opened.
   * Annual: enrolled students who entered before the year and have not passed
   * their expected end. Initial: new entrants in pre-registration for the year.
   */
  async refreshPeriod(tenantId: string, periodId: string): Promise<number> {
    const period = await this.#period(tenantId, periodId);
    if (period.closedAt) throw new ConflictError('This period is closed');
    const yearStart = `${period.academicYear.slice(0, 4)}-08-01`;
    return withTenantContext(this.db, tenantId, async (tx) => {
      const eligible = await tx.select({ id: enrolments.id }).from(enrolments).where(and(
        eq(enrolments.tenantId, tenantId as Uuid), isNull(enrolments.recordedUntil), isNull(enrolments.validTo),
        ...(period.programmeId ? [eq(enrolments.programmeId, period.programmeId)] : []),
        ...(period.periodTypeCode === 'initial'
          ? [eq(enrolments.statusCode, 'pre-registration'), eq(enrolments.academicYearOfEntry, period.academicYear)]
          : [eq(enrolments.statusCode, 'enrolled'), lt(enrolments.academicYearOfEntry, period.academicYear),
            or(isNull(enrolments.expectedEndDate), sql`${enrolments.expectedEndDate} >= ${yearStart}`)]),
      ));
      if (eligible.length === 0) return 0;
      const existing = await tx.select({ enrolmentId: reenrolmentConfirmations.enrolmentId }).from(reenrolmentConfirmations).where(and(
        eq(reenrolmentConfirmations.tenantId, tenantId as Uuid), eq(reenrolmentConfirmations.reenrolmentPeriodId, period.id),
        isNull(reenrolmentConfirmations.recordedUntil),
      ));
      const have = new Set(existing.map((e) => e.enrolmentId));
      const now = clockNow();
      const rows = eligible.filter((e) => !have.has(e.id)).map((e) => ({
        versionId: randomUUID(), id: randomUUID(), tenantId: tenantId as Uuid, enrolmentId: e.id,
        reenrolmentPeriodId: period.id, statusCode: 'pending', validFrom: now, recordedAt: now,
      }));
      if (rows.length > 0) await tx.insert(reenrolmentConfirmations).values(rows);
      return rows.length;
    });
  }

  async listPeriods(tenantId: string): Promise<PeriodDto[]> {
    const periods = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(reenrolmentPeriods)
      .where(eq(reenrolmentPeriods.tenantId, tenantId as Uuid)).orderBy(desc(reenrolmentPeriods.opensAt)));
    return Promise.all(periods.map((p) => this.#withCounts(tenantId, p)));
  }

  async getPeriod(tenantId: string, periodId: string): Promise<PeriodDto> {
    return this.#withCounts(tenantId, await this.#period(tenantId, periodId));
  }

  async listConfirmations(tenantId: string, periodId: string, statusCode?: string): Promise<ConfirmationDto[]> {
    await this.#period(tenantId, periodId);
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(reenrolmentConfirmations).where(and(
      eq(reenrolmentConfirmations.tenantId, tenantId as Uuid), eq(reenrolmentConfirmations.reenrolmentPeriodId, periodId as Uuid),
      isNull(reenrolmentConfirmations.recordedUntil), ...(statusCode ? [eq(reenrolmentConfirmations.statusCode, statusCode)] : []),
    )));
    const subjects = await withTenantContext(this.db, tenantId, (tx) => subjectsForEnrolments(tx, tenantId, rows.map((r) => r.enrolmentId)));
    return rows.map((r) => ({ ...r, subject: subjects.get(r.enrolmentId) }));
  }

  /** A student's registrations: what they can confirm now, and what they already have. */
  async registrationsForPerson(tenantId: string, personId: string): Promise<MyRegistrationDto[]> {
    const termsVersion = await this.termsVersion(tenantId);
    return withTenantContext(this.db, tenantId, async (tx) => {
      const mine = await tx.select().from(enrolments).where(and(
        eq(enrolments.tenantId, tenantId as Uuid), eq(enrolments.personId, personId as Uuid), isNull(enrolments.recordedUntil), isNull(enrolments.validTo),
      ));
      if (mine.length === 0) return [];
      const rows = await tx.select({ confirmation: reenrolmentConfirmations, period: reenrolmentPeriods }).from(reenrolmentConfirmations)
        .innerJoin(reenrolmentPeriods, eq(reenrolmentPeriods.id, reenrolmentConfirmations.reenrolmentPeriodId))
        .where(and(
          eq(reenrolmentConfirmations.tenantId, tenantId as Uuid), isNull(reenrolmentConfirmations.recordedUntil),
          inArray(reenrolmentConfirmations.enrolmentId, mine.map((e) => e.id)),
        )).orderBy(desc(reenrolmentPeriods.opensAt));
      const out: MyRegistrationDto[] = [];
      for (const { confirmation, period } of rows) {
        const e = mine.find((x) => x.id === confirmation.enrolmentId)!;
        out.push({
          confirmation, period, termsVersion,
          enrolment: { enrolmentId: e.id, programmeId: e.programmeId, programmeCode: null, programmeName: null, modeOfStudyCode: e.modeOfStudyCode, statusCode: e.statusCode },
          blockers: confirmation.statusCode === 'pending' ? await this.#blockers(tenantId, e.id, period, termsVersion) : [],
        });
      }
      return out;
    });
  }

  /**
   * Confirms a registration, by the student in the portal or by the registry
   * on their behalf (with a reason). The student accepts the current terms
   * version. Creates the year's fee liability (once) and publishes
   * srs.student.re-enrolled. A lapsed confirmation can be confirmed only by the
   * registry, as a late registration.
   */
  async confirm(tenantId: string, confirmationId: string, input: {
    acceptedTermsVersion: string; channel: 'portal' | 'assisted'; assistedReasonCode?: string;
  }, actorId: string): Promise<ReenrolmentConfirmation> {
    const current = await this.#confirmation(tenantId, confirmationId);
    const period = await this.#period(tenantId, current.reenrolmentPeriodId);
    if (current.statusCode === 'confirmed') throw new ConflictError('This registration is already confirmed');
    if (input.channel === 'assisted') {
      if (!input.assistedReasonCode) throw new ValidationError('An assisted registration needs a reason');
      if (!(await this.valueSets.validateFieldValue('reenrolment_confirmation', 'assisted_reason_code', input.assistedReasonCode, tenantId))) {
        throw new ValidationError(`Invalid assisted registration reason '${input.assistedReasonCode}'`);
      }
      if (current.statusCode === 'lapsed' && input.assistedReasonCode !== 'late') {
        throw new ConflictError('A lapsed registration is confirmed only as a late registration');
      }
    } else if (current.statusCode !== 'pending' || period.closedAt || clockNow() > period.closesAt) {
      throw new ConflictError('This registration period has closed: contact the registry');
    }
    const termsVersion = await this.termsVersion(tenantId);
    if (!termsVersion || input.acceptedTermsVersion !== termsVersion) {
      throw new ConflictError(`The terms have changed: please read and accept version ${termsVersion ?? '(not set)'}`);
    }
    const blockers = await this.#blockers(tenantId, current.enrolmentId, period, termsVersion);
    if (blockers.length > 0) throw new ConflictError(blockers.map((b) => b.message).join('; '));

    const now = clockNow();
    const updated = await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(reenrolmentConfirmations).set({ recordedUntil: now }).where(and(
        eq(reenrolmentConfirmations.versionId, current.versionId), isNull(reenrolmentConfirmations.recordedUntil),
      ));
      const [row] = await tx.insert(reenrolmentConfirmations).values({
        versionId: randomUUID(), id: current.id, tenantId: tenantId as Uuid, enrolmentId: current.enrolmentId,
        reenrolmentPeriodId: current.reenrolmentPeriodId, statusCode: 'confirmed', confirmedAt: now, confirmedBy: actorId,
        channelCode: input.channel, termsVersion, assistedReasonCode: input.channel === 'assisted' ? input.assistedReasonCode! : null,
        validFrom: now, recordedAt: now,
      }).returning();
      const [enrolment] = await tx.select().from(enrolments).where(and(eq(enrolments.id, current.enrolmentId), isNull(enrolments.recordedUntil))).limit(1);
      if (enrolment) {
        await tx.insert(feeLiabilities).values({
          tenantId: tenantId as Uuid, enrolmentId: enrolment.id, personId: enrolment.personId, academicYear: period.academicYear,
          feeBandCode: enrolment.feeBandCode ?? null, fundingSourceCode: enrolment.fundingSourceCode ?? null, statusCode: 'generated', generatedAt: now,
        }).onConflictDoNothing();
      }
      return { row: row!, personId: enrolment?.personId ?? null };
    });

    if (updated.personId && this.eventBus.isConnected()) {
      const payload: StudentReEnrolledV1Payload = {
        personId: updated.personId, enrolmentId: current.enrolmentId, academicYear: period.academicYear,
        periodType: period.periodTypeCode, channel: input.channel, confirmedAt: now.toISOString(),
      };
      await this.eventBus.publish(EVENT_TYPES.STUDENT_RE_ENROLLED, '1.0.0', tenantId, actorId, 'personal', payload);
    }
    return updated.row;
  }

  /** Closes a period after it ends: every pending confirmation lapses. Never changes an enrolment. */
  async closePeriod(tenantId: string, periodId: string, actorId: string): Promise<{ period: PeriodDto; lapsed: ReenrolmentConfirmation[] }> {
    const period = await this.#period(tenantId, periodId);
    if (period.closedAt) throw new ConflictError('This period is already closed');
    if (clockNow() < period.closesAt) throw new ConflictError(`This period closes on ${period.closesAt.toISOString().slice(0, 10)}; it cannot be closed before then`);
    const now = clockNow();
    const lapsed = await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.update(reenrolmentPeriods).set({ closedAt: now, closedBy: actorId }).where(eq(reenrolmentPeriods.id, period.id));
      const pending = await tx.select().from(reenrolmentConfirmations).where(and(
        eq(reenrolmentConfirmations.reenrolmentPeriodId, period.id), eq(reenrolmentConfirmations.statusCode, 'pending'), isNull(reenrolmentConfirmations.recordedUntil),
      ));
      if (pending.length === 0) return [];
      await tx.update(reenrolmentConfirmations).set({ recordedUntil: now })
        .where(inArray(reenrolmentConfirmations.versionId, pending.map((p) => p.versionId)));
      return tx.insert(reenrolmentConfirmations).values(pending.map((p) => ({
        versionId: randomUUID(), id: p.id, tenantId: p.tenantId, enrolmentId: p.enrolmentId, reenrolmentPeriodId: p.reenrolmentPeriodId,
        statusCode: 'lapsed', validFrom: now, recordedAt: now,
      }))).returning();
    });
    return { period: await this.getPeriod(tenantId, period.id), lapsed };
  }

  /** The person a confirmation belongs to, for ownership checks. */
  async personForConfirmation(tenantId: string, confirmationId: string): Promise<string> {
    const confirmation = await this.#confirmation(tenantId, confirmationId);
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ personId: enrolments.personId }).from(enrolments)
      .where(and(eq(enrolments.id, confirmation.enrolmentId), isNull(enrolments.recordedUntil))).limit(1));
    if (!row) throw new NotFoundError('Enrolment', confirmation.enrolmentId);
    return row.personId;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Why a student cannot confirm now: unratified results (A1), or anything a blocker provider reports. */
  async #blockers(tenantId: string, enrolmentId: string, period: ReenrolmentPeriod, termsVersion: string | null): Promise<RegistrationBlocker[]> {
    const found: RegistrationBlocker[] = [];
    if (!termsVersion) found.push({ code: 'terms-not-set', message: 'The registration terms have not been published yet' });
    const [latest] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ locked: progressionDecisions.locked }).from(progressionDecisions)
      .where(and(eq(progressionDecisions.tenantId, tenantId as Uuid), eq(progressionDecisions.enrolmentId, enrolmentId as Uuid),
        isNull(progressionDecisions.recordedUntil), lt(progressionDecisions.academicYear, period.academicYear)))
      .orderBy(desc(progressionDecisions.academicYear)).limit(1));
    if (latest && !latest.locked) found.push({ code: 'results-pending', message: 'Your results for last year are not yet confirmed by the exam board' });
    return [...found, ...(await this.blockers.blockersFor(tenantId, enrolmentId, period.academicYear))];
  }

  /** The terms version students accept now (tenant configuration registrationTermsVersion). */
  async termsVersion(tenantId: string): Promise<string | null> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const version = row?.configuration?.['registrationTermsVersion'];
    return typeof version === 'string' && version.trim() ? version : null;
  }

  async #withCounts(tenantId: string, period: ReenrolmentPeriod): Promise<PeriodDto> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ status: reenrolmentConfirmations.statusCode, n: sql<number>`count(*)::int` })
      .from(reenrolmentConfirmations).where(and(eq(reenrolmentConfirmations.reenrolmentPeriodId, period.id), isNull(reenrolmentConfirmations.recordedUntil)))
      .groupBy(reenrolmentConfirmations.statusCode));
    const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    return { ...period, counts: { pending: n('pending'), confirmed: n('confirmed'), lapsed: n('lapsed') } };
  }

  async #period(tenantId: string, periodId: string): Promise<ReenrolmentPeriod> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(reenrolmentPeriods)
      .where(and(eq(reenrolmentPeriods.id, periodId as Uuid), eq(reenrolmentPeriods.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('RegistrationPeriod', periodId);
    return row;
  }

  async #confirmation(tenantId: string, confirmationId: string): Promise<ReenrolmentConfirmation> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(reenrolmentConfirmations).where(and(
      eq(reenrolmentConfirmations.id, confirmationId as Uuid), eq(reenrolmentConfirmations.tenantId, tenantId as Uuid), isNull(reenrolmentConfirmations.recordedUntil),
    )).limit(1));
    if (!row) throw new NotFoundError('RegistrationConfirmation', confirmationId);
    return row;
  }
}

