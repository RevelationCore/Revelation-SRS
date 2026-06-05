import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  enrolmentDownstreamTriggers,
  enrolments,
  enrolmentStatusTransitions,
  feeLiabilities,
  persons,
  type Db,
  type TenantScopedDb,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError, EVENT_TYPES } from '@revelation-srs/domain';
import type {
  EnrolmentDownstreamTriggerCreatedV1Payload,
  EnrolmentFeeLiabilityGeneratedV1Payload,
  StudentEnrolledV1Payload,
  StudentStatusChangedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type EnrolmentStatusCode =
  | 'enrolled'
  | 'intermitting'
  | 'withdrawn'
  | 'suspended'
  | 'graduated';

export interface CreateEnrolmentInput {
  personId:            string;
  programmeId?:        string;
  modeOfStudyCode:     string;
  attendanceTypeCode?: string;
  academicYearOfEntry: string;
  startDate:           string;   // ISO date 'YYYY-MM-DD'
  expectedEndDate?:    string;
  feeBandCode?:        string;
  fundingSourceCode?:  string;
  slcReference?:       string;
  ucasPersonalId?:     string;
  ukviCasRequired?:    boolean;
}

export interface EnrolmentDto {
  enrolmentId:         string;
  personId:            string;
  programmeId:         string | null;
  statusCode:          string;
  modeOfStudyCode:     string;
  attendanceTypeCode:  string | null;
  academicYearOfEntry: string;
  startDate:           string;          // required at creation; never null
  expectedEndDate:     string | null;
  actualEndDate:       string | null;
  feeBandCode:         string | null;
  fundingSourceCode:   string | null;
  slcReference:        string | null;
  ucasPersonalId:      string | null;
  validFrom:           Date;
  recordedAt:          Date;
}

export interface EnrolmentHistoryDto extends EnrolmentDto {
  validTo:       Date | null;
  recordedUntil: Date | null;
}

export interface EnrolmentTransitionDto {
  transitionId:   string;
  enrolmentId:    string;
  fromStatusCode: string;
  toStatusCode:   string;
  reasonCode:     string | null;
  reasonText:     string | null;
  effectiveAt:    Date;
  actorId:        string;
  createdAt:      Date;
}

export interface FeeLiabilityDto {
  feeLiabilityId:   string;
  enrolmentId:      string;
  personId:         string;
  academicYear:     string;
  feeBandCode:      string | null;
  fundingSourceCode: string | null;
  amountPence:      number | null;
  statusCode:       string;
  generatedAt:      Date;
}

export interface DownstreamTriggerDto {
  triggerId:       string;
  enrolmentId:     string;
  triggerTypeCode: string;
  statusCode:      string;
  payloadSummary:  Record<string, unknown> | null;
  correlationId:   string | null;
  createdAt:       Date;
  sentAt:          Date | null;
}

export interface TransitionOptions {
  reasonCode?: string;
  reasonText?: string;
}

// Valid status transitions
const ALLOWED_TRANSITIONS: Record<EnrolmentStatusCode, EnrolmentStatusCode[]> = {
  enrolled:    ['intermitting', 'withdrawn', 'suspended', 'graduated'],
  intermitting: ['enrolled', 'withdrawn'],
  suspended:   ['enrolled', 'withdrawn'],
  withdrawn:   [],
  graduated:   [],
};

// ── Service ──────────────────────────────────────────────────────────────────

export class EnrolmentService {
  constructor(
    private readonly db:       Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
  ) {}

  async #validateFieldValue(
    tenantId: string,
    entityName: string,
    fieldName: string,
    value: string | null | undefined,
  ): Promise<void> {
    if (value === undefined || value === null || value === '') return;

    const isValid = await this.valueSets.validateFieldValue(entityName, fieldName, value, tenantId);
    if (isValid === false) {
      throw new ValidationError(
        `Invalid value '${value}' for ${entityName}.${fieldName}`,
        [{ field: fieldName, message: `Value '${value}' is not active in the configured value set` }],
      );
    }
  }

  async #ensurePersonExists(personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) {
      throw new NotFoundError('Person', personId);
    }
  }

  /**
   * Create a new enrolment.  Inserts a bitemporal row with status='enrolled'.
   * Publishes srs.student.enrolled event.
   */
  async createEnrolment(
    tenantId: string,
    input: CreateEnrolmentInput,
    actorId: string,
  ): Promise<string> {
    await this.#ensurePersonExists(input.personId, tenantId);
    await this.#validateFieldValue(tenantId, 'enrolment', 'mode_of_study_code', input.modeOfStudyCode);
    await this.#validateFieldValue(tenantId, 'enrolment', 'funding_source_code', input.fundingSourceCode);

    const enrolmentId = randomUUID();
    const now         = new Date();
    const createdFeeLiabilityIds: string[] = [];
    const createdTriggers: Array<{ id: string; triggerTypeCode: 'ucas-confirmation' | 'slc-confirmation' | 'ukvi-cas'; sourceReference?: string }> = [];

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(enrolments).values({
        versionId:           randomUUID(),
        id:                  enrolmentId,
        tenantId:            tenantId as `${string}-${string}-${string}-${string}-${string}`,
        personId:            input.personId as `${string}-${string}-${string}-${string}-${string}`,
        programmeId:         (input.programmeId ?? null) as (`${string}-${string}-${string}-${string}-${string}` | null),
        statusCode:          'enrolled',
        modeOfStudyCode:     input.modeOfStudyCode,
        attendanceTypeCode:  input.attendanceTypeCode ?? null,
        academicYearOfEntry: input.academicYearOfEntry,
        startDate:           input.startDate,
        expectedEndDate:     input.expectedEndDate     ?? null,
        actualEndDate:       null,
        feeBandCode:         input.feeBandCode        ?? null,
        fundingSourceCode:   input.fundingSourceCode  ?? null,
        slcReference:        input.slcReference       ?? null,
        ucasPersonalId:      input.ucasPersonalId     ?? null,
        validFrom:           now,
        validTo:             null,
        recordedAt:          now,
        recordedUntil:       null,
      });

      const feeLiabilityId = randomUUID();
      await tx.insert(feeLiabilities).values({
        id:                feeLiabilityId,
        tenantId:          tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId,
        personId:          input.personId as `${string}-${string}-${string}-${string}-${string}`,
        academicYear:      input.academicYearOfEntry,
        feeBandCode:       input.feeBandCode ?? null,
        fundingSourceCode: input.fundingSourceCode ?? null,
        amountPence:       null,
        statusCode:        'generated',
        generatedAt:       now,
      });
      createdFeeLiabilityIds.push(feeLiabilityId);

      const triggerInputs: Array<{ triggerTypeCode: 'ucas-confirmation' | 'slc-confirmation' | 'ukvi-cas'; sourceReference?: string }> = [];
      if (input.ucasPersonalId) {
        triggerInputs.push({ triggerTypeCode: 'ucas-confirmation', sourceReference: input.ucasPersonalId });
      }
      if (input.fundingSourceCode === 'slc' || input.slcReference) {
        triggerInputs.push({
          triggerTypeCode: 'slc-confirmation',
          ...(input.slcReference ? { sourceReference: input.slcReference } : {}),
        });
      }
      if (input.ukviCasRequired) {
        triggerInputs.push({ triggerTypeCode: 'ukvi-cas' });
      }

      for (const trigger of triggerInputs) {
        const triggerId = randomUUID();
        await tx.insert(enrolmentDownstreamTriggers).values({
          id:              triggerId,
          tenantId:        tenantId as `${string}-${string}-${string}-${string}-${string}`,
          enrolmentId,
          triggerTypeCode: trigger.triggerTypeCode,
          statusCode:      'pending',
          payloadSummary: {
            personId: input.personId,
            academicYear: input.academicYearOfEntry,
            sourceReference: trigger.sourceReference,
          },
          correlationId: null,
          createdAt:     now,
          sentAt:        null,
        });
        createdTriggers.push({ id: triggerId, ...trigger });
      }

      await this.#updatePersonStatusFromEnrolments(input.personId, tenantId, tx);
    });

    if (this.eventBus.isConnected()) {
      const payload: StudentEnrolledV1Payload = {
        personId:     input.personId,
        enrolmentId,
        programmeId:  input.programmeId,
        academicYear: input.academicYearOfEntry,
        modeOfStudy:  input.modeOfStudyCode,
        fundingSource: input.fundingSourceCode,
      };
      await this.eventBus.publish(
        EVENT_TYPES.STUDENT_ENROLLED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );

      for (const feeLiabilityId of createdFeeLiabilityIds) {
        const payload: EnrolmentFeeLiabilityGeneratedV1Payload = {
          personId: input.personId,
          enrolmentId,
          feeLiabilityId,
          academicYear: input.academicYearOfEntry,
          feeBandCode: input.feeBandCode,
          fundingSourceCode: input.fundingSourceCode,
        };
        await this.eventBus.publish(
          EVENT_TYPES.ENROLMENT_FEE_LIABILITY_GENERATED,
          '1.0.0',
          tenantId,
          actorId,
          'personal',
          payload,
        );
      }

      for (const trigger of createdTriggers) {
        const payload: EnrolmentDownstreamTriggerCreatedV1Payload = {
          personId: input.personId,
          enrolmentId,
          triggerId: trigger.id,
          triggerTypeCode: trigger.triggerTypeCode,
          sourceReference: trigger.sourceReference,
        };
        await this.eventBus.publish(
          EVENT_TYPES.ENROLMENT_DOWNSTREAM_TRIGGER_CREATED,
          '1.0.0',
          tenantId,
          actorId,
          trigger.triggerTypeCode === 'ukvi-cas' ? 'regulatory' : 'personal',
          payload,
        );
      }
    }

    return enrolmentId;
  }

  /**
   * Retrieve the current state of an enrolment.
   */
  async getEnrolment(enrolmentId: string, tenantId: string): Promise<EnrolmentDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) => {
      return tx
        .select()
        .from(enrolments)
        .where(
          and(
            eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(enrolments.recordedUntil),
          ),
        )
        .limit(1);
    });

    if (rows.length === 0) return null;
    return this.#toDto(rows[0]!);
  }

  /**
   * List current enrolments for a tenant, optionally filtered by status.
   */
  async listEnrolments(
    tenantId: string,
    opts: { statusCode?: string; limit?: number; offset?: number } = {},
  ): Promise<EnrolmentDto[]> {
    const limit  = opts.limit  ?? 20;
    const offset = opts.offset ?? 0;

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(enrolments)
        .where(
          and(
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(enrolments.recordedUntil),
            ...(opts.statusCode ? [eq(enrolments.statusCode, opts.statusCode)] : []),
          ),
        )
        .limit(limit)
        .offset(offset),
    );

    return rows.map((r) => this.#toDto(r));
  }

  /**
   * List current enrolments for a specific person.
   */
  async listPersonEnrolments(personId: string, tenantId: string): Promise<EnrolmentDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) => {
      return tx
        .select()
        .from(enrolments)
        .where(
          and(
            eq(enrolments.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(enrolments.recordedUntil),
          ),
        );
    });

    return rows.map((r) => this.#toDto(r));
  }

  /**
   * Transition enrolment status.
   * Validates the transition is legal, closes the current row, inserts a new
   * bitemporal version, and publishes the status-changed event.
   */
  async transitionStatus(
    enrolmentId: string,
    tenantId:    string,
    newStatus:   EnrolmentStatusCode,
    validFrom:   Date,
    actorId:     string,
    options:     TransitionOptions = {},
  ): Promise<void> {
    const current = await this.getEnrolment(enrolmentId, tenantId);
    if (!current) {
      throw new NotFoundError('Enrolment', enrolmentId);
    }

    const from = current.statusCode as EnrolmentStatusCode;
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new ValidationError(
        `Cannot transition enrolment from '${from}' to '${newStatus}'`,
      );
    }

    const now = new Date();

    await withTenantContext(this.db, tenantId, async (tx) => {
      // Close current row (both record-time and valid-time axes)
      await tx
        .update(enrolments)
        .set({ recordedUntil: now, validTo: validFrom })
        .where(
          and(
            eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(enrolments.recordedUntil),
          ),
        );

      // Insert new version
      await tx.insert(enrolments).values({
        versionId:           randomUUID(),
        id:                  enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId:            tenantId as `${string}-${string}-${string}-${string}-${string}`,
        personId:            current.personId as `${string}-${string}-${string}-${string}-${string}`,
        programmeId:         (current.programmeId ?? null) as (`${string}-${string}-${string}-${string}-${string}` | null),
        statusCode:          newStatus,
        modeOfStudyCode:     current.modeOfStudyCode,
        attendanceTypeCode:  current.attendanceTypeCode,
        academicYearOfEntry: current.academicYearOfEntry,
        startDate:           current.startDate,
        expectedEndDate:     current.expectedEndDate,
        actualEndDate:       newStatus === 'withdrawn' || newStatus === 'graduated'
                               ? validFrom.toISOString().slice(0, 10)
                               : current.actualEndDate,
        feeBandCode:       current.feeBandCode,
        fundingSourceCode: current.fundingSourceCode,
        slcReference:      current.slcReference,
        ucasPersonalId:    current.ucasPersonalId,
        validFrom,
        validTo:       null,
        recordedAt:    now,
        recordedUntil: null,
      });

      await tx.insert(enrolmentStatusTransitions).values({
        tenantId:       tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId:    enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        fromStatusCode: from,
        toStatusCode:   newStatus,
        reasonCode:     options.reasonCode ?? null,
        reasonText:     options.reasonText ?? null,
        effectiveAt:    validFrom,
        actorId,
        createdAt:      now,
      });

      await this.#updatePersonStatusFromEnrolments(current.personId, tenantId, tx);
    });

    if (this.eventBus.isConnected()) {
      const payload: StudentStatusChangedV1Payload = {
        personId:       current.personId,
        enrolmentId,
        previousStatus: from,
        newStatus,
        effectiveDate:  validFrom.toISOString(),
        reasonCode: options.reasonCode,
      };
      await this.eventBus.publish(
        EVENT_TYPES.STUDENT_STATUS_CHANGED,
        '1.0.0',
        tenantId,
        actorId,
        'personal',
        payload,
      );
    }
  }

  async getEnrolmentHistory(enrolmentId: string, tenantId: string): Promise<EnrolmentHistoryDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(enrolments)
        .where(
          and(
            eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(enrolments.recordedAt),
    );

    return rows.map((row) => ({
      ...this.#toDto(row),
      validTo:       row.validTo,
      recordedUntil: row.recordedUntil,
    }));
  }

  async listStatusTransitions(enrolmentId: string, tenantId: string): Promise<EnrolmentTransitionDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(enrolmentStatusTransitions)
        .where(
          and(
            eq(enrolmentStatusTransitions.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolmentStatusTransitions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(enrolmentStatusTransitions.createdAt),
    );

    return rows.map((row) => ({
      transitionId:   row.id,
      enrolmentId:    row.enrolmentId,
      fromStatusCode: row.fromStatusCode,
      toStatusCode:   row.toStatusCode,
      reasonCode:     row.reasonCode,
      reasonText:     row.reasonText,
      effectiveAt:    row.effectiveAt,
      actorId:        row.actorId,
      createdAt:      row.createdAt,
    }));
  }

  async listFeeLiabilities(enrolmentId: string, tenantId: string): Promise<FeeLiabilityDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(feeLiabilities)
        .where(
          and(
            eq(feeLiabilities.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(feeLiabilities.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(feeLiabilities.generatedAt),
    );

    return rows.map((row) => ({
      feeLiabilityId:   row.id,
      enrolmentId:      row.enrolmentId,
      personId:         row.personId,
      academicYear:     row.academicYear,
      feeBandCode:      row.feeBandCode,
      fundingSourceCode: row.fundingSourceCode,
      amountPence:      row.amountPence,
      statusCode:       row.statusCode,
      generatedAt:      row.generatedAt,
    }));
  }

  async listDownstreamTriggers(enrolmentId: string, tenantId: string): Promise<DownstreamTriggerDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(enrolmentDownstreamTriggers)
        .where(
          and(
            eq(enrolmentDownstreamTriggers.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolmentDownstreamTriggers.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(enrolmentDownstreamTriggers.createdAt),
    );

    return rows.map((row) => ({
      triggerId:       row.id,
      enrolmentId:     row.enrolmentId,
      triggerTypeCode: row.triggerTypeCode,
      statusCode:      row.statusCode,
      payloadSummary:  row.payloadSummary ?? null,
      correlationId:   row.correlationId,
      createdAt:       row.createdAt,
      sentAt:          row.sentAt,
    }));
  }

  /**
   * Derive the coarse person lifecycle status from the current set of enrolment
   * statuses and update person.person_status_code within the active transaction.
   * Never overwrites 'deceased' or 'merged' — those are explicit admin states.
   */
  async #updatePersonStatusFromEnrolments(
    personId: string,
    tenantId: string,
    tx: TenantScopedDb,
  ): Promise<void> {
    const personRows = await tx
      .select({ personStatusCode: persons.personStatusCode })
      .from(persons)
      .where(
        and(
          eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
          eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ),
      )
      .limit(1);

    const person = personRows[0];
    if (!person) return;
    if (person.personStatusCode === 'deceased' || person.personStatusCode === 'merged') return;

    const enrolmentRows = await tx
      .select({ statusCode: enrolments.statusCode })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
          eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(enrolments.recordedUntil),
        ),
      );

    const statuses = enrolmentRows.map((r) => r.statusCode);
    const derived = derivePersonStatus(statuses);

    if (derived !== person.personStatusCode) {
      await tx
        .update(persons)
        .set({ personStatusCode: derived })
        .where(
          and(
            eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        );
    }
  }

  #toDto(row: typeof enrolments.$inferSelect): EnrolmentDto {
    return {
      enrolmentId:         row.id,
      personId:            row.personId,
      programmeId:         row.programmeId,
      statusCode:          row.statusCode,
      modeOfStudyCode:     row.modeOfStudyCode,
      attendanceTypeCode:  row.attendanceTypeCode,
      academicYearOfEntry: row.academicYearOfEntry,
      startDate:           row.startDate,
      expectedEndDate:     row.expectedEndDate,
      actualEndDate:       row.actualEndDate,
      feeBandCode:         row.feeBandCode,
      fundingSourceCode:   row.fundingSourceCode,
      slcReference:        row.slcReference,
      ucasPersonalId:      row.ucasPersonalId,
      validFrom:           row.validFrom,
      recordedAt:          row.recordedAt,
    };
  }
}

/**
 * Derive coarse person lifecycle status from the set of current enrolment
 * status codes.  Returns 'student' while any enrolment is active; 'alumnus'
 * once all are graduated or withdrawn and at least one graduated; falls back
 * to 'prospective' when there are no enrolments at all.
 */
function derivePersonStatus(
  enrolmentStatuses: string[],
): 'prospective' | 'student' | 'alumnus' {
  if (enrolmentStatuses.length === 0) return 'prospective';

  const hasActive = enrolmentStatuses.some(
    (s) => s === 'enrolled' || s === 'intermitting' || s === 'suspended',
  );
  if (hasActive) return 'student';

  const hasGraduated = enrolmentStatuses.some((s) => s === 'graduated');
  return hasGraduated ? 'alumnus' : 'student';
}
