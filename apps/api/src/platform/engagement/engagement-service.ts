import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import {
  engagementObservationRevisions,
  engagementObservations,
  enrolments,
  expectedEngagementEvents,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  ConflictError,
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type EngagementExpectedEventCreatedV1Payload,
  type EngagementObservationCorrectedV1Payload,
  type EngagementObservationRecordedV1Payload,
} from '@revelation-srs/domain';

import { clockNow } from '../clock.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface CreateExpectedEventInput {
  personId: string;
  enrolmentId: string;
  activityTypeCode: string;
  activityReference?: string;
  eventModeCode: string;
  scheduledFrom: string;
  scheduledTo?: string;
  locationReference?: string;
  sourceSystemCode: string;
  sourceEventId: string;
  sourceVersion: string;
}

export interface RecordObservationInput {
  sourceSystemCode: string;
  sourceEventId: string;
  sourceVersion: string;
  captureMethodCode: string;
  outcomeCode: string;
  dataQualityCode?: string;
  eventTime: string;
  receivedAt?: string;
  deviceReference?: string;
  operationalReference?: string;
}

export interface CorrectObservationInput {
  sourceVersion: string;
  outcomeCode: string;
  dataQualityCode: string;
  eventTime?: string;
  correctionReasonCode: string;
  correctionReason?: string;
  disputed?: boolean;
}

export interface EngagementEventDto {
  expectedEventId: string;
  personId: string;
  enrolmentId: string;
  activityTypeCode: string;
  activityReference: string | null;
  eventModeCode: string;
  scheduledFrom: Date;
  scheduledTo: Date | null;
  locationReference: string | null;
  sourceSystemCode: string;
  sourceEventId: string;
  sourceVersion: string;
  statusCode: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
}

export interface EngagementObservationDto {
  observationId: string;
  observationVersionId: string;
  expectedEventId: string | null;
  personId: string;
  enrolmentId: string;
  sourceSystemCode: string;
  sourceEventId: string;
  sourceVersion: string;
  captureMethodCode: string;
  outcomeCode: string;
  dataQualityCode: string;
  eventTime: Date;
  receivedAt: Date;
  deviceReference: string | null;
  operationalReference: string | null;
  actorId: string;
  recordedAt: Date;
}

export class EngagementService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
  ) {}

  async createExpectedEvent(
    tenantId: string,
    input: CreateExpectedEventInput,
    actorId: string,
    correlationId: string,
  ): Promise<{ expectedEventId: string; created: boolean }> {
    const scheduledFrom = this.#date(input.scheduledFrom, 'scheduledFrom');
    const scheduledTo = input.scheduledTo ? this.#date(input.scheduledTo, 'scheduledTo') : null;
    if (scheduledTo && scheduledTo <= scheduledFrom) {
      throw new ValidationError('scheduledTo must be after scheduledFrom', [
        { field: 'scheduledTo', message: 'must be after scheduledFrom' },
      ]);
    }
    await this.#ensureEnrolment(input.enrolmentId, input.personId, tenantId);
    await Promise.all([
      this.#validateCode('expected_engagement_event', 'activity_type_code', input.activityTypeCode, tenantId, scheduledFrom),
      this.#validateCode('expected_engagement_event', 'event_mode_code', input.eventModeCode, tenantId, scheduledFrom),
    ]);

    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: expectedEngagementEvents.id })
        .from(expectedEngagementEvents)
        .where(and(
          eq(expectedEngagementEvents.tenantId, tenantId as Uuid),
          eq(expectedEngagementEvents.sourceSystemCode, input.sourceSystemCode),
          eq(expectedEngagementEvents.sourceEventId, input.sourceEventId),
          eq(expectedEngagementEvents.sourceVersion, input.sourceVersion),
        ))
        .limit(1),
    );
    if (existing[0]) return { expectedEventId: existing[0].id, created: false };

    const expectedEventId = randomUUID();
    const now = clockNow();
    try {
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.insert(expectedEngagementEvents).values({
          versionId: randomUUID(),
          id: expectedEventId,
          tenantId: tenantId as Uuid,
          personId: input.personId as Uuid,
          enrolmentId: input.enrolmentId as Uuid,
          activityTypeCode: input.activityTypeCode,
          activityReference: input.activityReference ?? null,
          eventModeCode: input.eventModeCode,
          scheduledFrom,
          scheduledTo,
          locationReference: input.locationReference ?? null,
          sourceSystemCode: input.sourceSystemCode,
          sourceEventId: input.sourceEventId,
          sourceVersion: input.sourceVersion,
          statusCode: 'expected',
          actorId,
          validFrom: scheduledFrom,
          validTo: scheduledTo,
          recordedAt: now,
          recordedUntil: null,
        });
      });
    } catch (error) {
      this.#rethrowUnique(error, 'Expected event source version already exists');
    }

    if (this.eventBus.isConnected()) {
      const payload: EngagementExpectedEventCreatedV1Payload = {
        expectedEventId,
        personId: input.personId,
        enrolmentId: input.enrolmentId,
        activityTypeCode: input.activityTypeCode,
        eventModeCode: input.eventModeCode,
        scheduledFrom: scheduledFrom.toISOString(),
        ...(scheduledTo ? { scheduledTo: scheduledTo.toISOString() } : {}),
        sourceSystemCode: input.sourceSystemCode,
        sourceEventId: input.sourceEventId,
        sourceVersion: input.sourceVersion,
      };
      await this.eventBus.publish(
        EVENT_TYPES.ENGAGEMENT_EXPECTED_EVENT_CREATED,
        '1.0.0',
        tenantId,
        correlationId,
        'personal',
        payload,
        { validAt: scheduledFrom },
      );
    }
    return { expectedEventId, created: true };
  }

  async listExpectedEvents(
    tenantId: string,
    filter: {
      personId?: string;
      enrolmentId?: string;
      statusCode?: string;
      scheduledFrom?: string;
      scheduledTo?: string;
    },
  ): Promise<EngagementEventDto[]> {
    const from = filter.scheduledFrom ? this.#date(filter.scheduledFrom, 'scheduledFrom') : undefined;
    const to = filter.scheduledTo ? this.#date(filter.scheduledTo, 'scheduledTo') : undefined;
    return withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx.select()
        .from(expectedEngagementEvents)
        .where(and(
          eq(expectedEngagementEvents.tenantId, tenantId as Uuid),
          isNull(expectedEngagementEvents.recordedUntil),
          filter.personId ? eq(expectedEngagementEvents.personId, filter.personId as Uuid) : undefined,
          filter.enrolmentId ? eq(expectedEngagementEvents.enrolmentId, filter.enrolmentId as Uuid) : undefined,
          filter.statusCode ? eq(expectedEngagementEvents.statusCode, filter.statusCode) : undefined,
          from ? gte(expectedEngagementEvents.scheduledFrom, from) : undefined,
          to ? lte(expectedEngagementEvents.scheduledFrom, to) : undefined,
        ))
        .orderBy(asc(expectedEngagementEvents.scheduledFrom));
      return rows.map((row) => this.#eventDto(row));
    });
  }

  async recordObservation(
    expectedEventId: string,
    tenantId: string,
    input: RecordObservationInput,
    idempotencyKey: string,
    actorId: string,
    correlationId: string,
  ): Promise<{ observationId: string; created: boolean }> {
    if (!idempotencyKey.trim()) throw new ValidationError('Idempotency-Key header is required');
    const event = await this.#getExpectedEvent(expectedEventId, tenantId);
    const eventTime = this.#date(input.eventTime, 'eventTime');
    const receivedAt = input.receivedAt ? this.#date(input.receivedAt, 'receivedAt') : clockNow();
    await Promise.all([
      this.#validateCode('engagement_observation', 'capture_method_code', input.captureMethodCode, tenantId, eventTime),
      this.#validateCode('engagement_observation', 'outcome_code', input.outcomeCode, tenantId, eventTime),
      this.#validateCode('engagement_observation', 'data_quality_code', input.dataQualityCode ?? 'valid', tenantId, eventTime),
    ]);

    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: engagementObservations.id })
        .from(engagementObservations)
        .where(and(
          eq(engagementObservations.tenantId, tenantId as Uuid),
          eq(engagementObservations.sourceSystemCode, input.sourceSystemCode),
          eq(engagementObservations.idempotencyKey, idempotencyKey),
        ))
        .limit(1),
    );
    if (existing[0]) return { observationId: existing[0].id, created: false };

    const observationId = randomUUID();
    const versionId = randomUUID();
    const dataQualityCode = input.dataQualityCode ?? 'valid';
    try {
      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx.insert(engagementObservations).values({
          versionId,
          id: observationId,
          tenantId: tenantId as Uuid,
          expectedEventId: expectedEventId as Uuid,
          personId: event.personId as Uuid,
          enrolmentId: event.enrolmentId as Uuid,
          sourceSystemCode: input.sourceSystemCode,
          sourceEventId: input.sourceEventId,
          sourceVersion: input.sourceVersion,
          idempotencyKey,
          captureMethodCode: input.captureMethodCode,
          outcomeCode: input.outcomeCode,
          dataQualityCode,
          eventTime,
          receivedAt,
          deviceReference: input.deviceReference ?? null,
          operationalReference: input.operationalReference ?? null,
          actorId,
          validFrom: eventTime,
          validTo: null,
          recordedAt: clockNow(),
          recordedUntil: null,
        });
      });
    } catch (error) {
      this.#rethrowUnique(error, 'Observation source version or idempotency key already exists');
    }

    if (this.eventBus.isConnected()) {
      const payload: EngagementObservationRecordedV1Payload = {
        observationId,
        expectedEventId,
        personId: event.personId,
        enrolmentId: event.enrolmentId,
        captureMethodCode: input.captureMethodCode,
        outcomeCode: input.outcomeCode,
        dataQualityCode,
        eventTime: eventTime.toISOString(),
        sourceSystemCode: input.sourceSystemCode,
        sourceEventId: input.sourceEventId,
        sourceVersion: input.sourceVersion,
      };
      await this.eventBus.publish(
        EVENT_TYPES.ENGAGEMENT_OBSERVATION_RECORDED,
        '1.0.0',
        tenantId,
        correlationId,
        'sensitive',
        payload,
        { validAt: eventTime },
      );
    }
    return { observationId, created: true };
  }

  async correctObservation(
    observationId: string,
    tenantId: string,
    input: CorrectObservationInput,
    idempotencyKey: string,
    actorId: string,
    correlationId: string,
  ): Promise<{ observationId: string; observationVersionId: string; created: boolean }> {
    if (!idempotencyKey.trim()) throw new ValidationError('Idempotency-Key header is required');
    const current = await this.#getObservation(observationId, tenantId);
    const eventTime = input.eventTime ? this.#date(input.eventTime, 'eventTime') : current.eventTime;
    await Promise.all([
      this.#validateCode('engagement_observation', 'outcome_code', input.outcomeCode, tenantId, eventTime),
      this.#validateCode('engagement_observation', 'data_quality_code', input.dataQualityCode, tenantId, eventTime),
    ]);

    const duplicate = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ versionId: engagementObservations.versionId })
        .from(engagementObservations)
        .where(and(
          eq(engagementObservations.tenantId, tenantId as Uuid),
          eq(engagementObservations.sourceSystemCode, current.sourceSystemCode),
          eq(engagementObservations.idempotencyKey, idempotencyKey),
        ))
        .limit(1),
    );
    if (duplicate[0]) {
      return { observationId, observationVersionId: duplicate[0].versionId, created: false };
    }

    const replacementVersionId = randomUUID();
    const now = clockNow();
    try {
      await withTenantContext(this.db, tenantId, async (tx) => {
        const closed = await tx.update(engagementObservations)
          .set({ recordedUntil: now })
          .where(and(
            eq(engagementObservations.tenantId, tenantId as Uuid),
            eq(engagementObservations.id, observationId as Uuid),
            isNull(engagementObservations.recordedUntil),
          ))
          .returning({ versionId: engagementObservations.versionId });
        if (!closed[0]) throw new ConflictError('Observation was corrected concurrently');

        await tx.insert(engagementObservations).values({
          versionId: replacementVersionId,
          id: observationId as Uuid,
          tenantId: tenantId as Uuid,
          expectedEventId: current.expectedEventId ? current.expectedEventId as Uuid : null,
          personId: current.personId as Uuid,
          enrolmentId: current.enrolmentId as Uuid,
          sourceSystemCode: current.sourceSystemCode,
          sourceEventId: current.sourceEventId,
          sourceVersion: input.sourceVersion,
          idempotencyKey,
          captureMethodCode: current.captureMethodCode,
          outcomeCode: input.outcomeCode,
          dataQualityCode: input.dataQualityCode,
          eventTime,
          receivedAt: now,
          deviceReference: current.deviceReference,
          operationalReference: current.operationalReference,
          actorId,
          validFrom: eventTime,
          validTo: null,
          recordedAt: now,
          recordedUntil: null,
        });
        await tx.insert(engagementObservationRevisions).values({
          id: randomUUID(),
          tenantId: tenantId as Uuid,
          observationId: observationId as Uuid,
          supersededVersionId: current.observationVersionId as Uuid,
          replacementVersionId,
          correctionReasonCode: input.correctionReasonCode,
          correctionReason: input.correctionReason ?? null,
          disputed: input.disputed ?? false,
          authorisedBy: actorId,
          recordedAt: now,
          correlationId: this.#uuidOrNull(correlationId),
        });
      });
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      this.#rethrowUnique(error, 'Correction source version or idempotency key already exists');
    }

    if (this.eventBus.isConnected()) {
      const payload: EngagementObservationCorrectedV1Payload = {
        observationId,
        supersededVersionId: current.observationVersionId,
        replacementVersionId,
        correctionReasonCode: input.correctionReasonCode,
        disputed: input.disputed ?? false,
        outcomeCode: input.outcomeCode,
        dataQualityCode: input.dataQualityCode,
      };
      await this.eventBus.publish(
        EVENT_TYPES.ENGAGEMENT_OBSERVATION_CORRECTED,
        '1.0.0',
        tenantId,
        correlationId,
        'sensitive',
        payload,
        { validAt: eventTime },
      );
    }
    return { observationId, observationVersionId: replacementVersionId, created: true };
  }

  async getStudentTimeline(
    personId: string,
    tenantId: string,
    filter: { from?: string; to?: string },
  ): Promise<{ events: EngagementEventDto[]; observations: EngagementObservationDto[] }> {
    const from = filter.from ? this.#date(filter.from, 'from') : undefined;
    const to = filter.to ? this.#date(filter.to, 'to') : undefined;
    const timeline = await withTenantContext(this.db, tenantId, async (tx) => {
      const [events, observations] = await Promise.all([
        tx.select().from(expectedEngagementEvents).where(and(
          eq(expectedEngagementEvents.tenantId, tenantId as Uuid),
          eq(expectedEngagementEvents.personId, personId as Uuid),
          isNull(expectedEngagementEvents.recordedUntil),
          from ? gte(expectedEngagementEvents.scheduledFrom, from) : undefined,
          to ? lte(expectedEngagementEvents.scheduledFrom, to) : undefined,
        )).orderBy(asc(expectedEngagementEvents.scheduledFrom)),
        tx.select().from(engagementObservations).where(and(
          eq(engagementObservations.tenantId, tenantId as Uuid),
          eq(engagementObservations.personId, personId as Uuid),
          isNull(engagementObservations.recordedUntil),
          from ? gte(engagementObservations.eventTime, from) : undefined,
          to ? lte(engagementObservations.eventTime, to) : undefined,
        )).orderBy(desc(engagementObservations.eventTime)),
      ]);
      return {
        events: events.map((row) => this.#eventDto(row)),
        observations: observations.map((row) => this.#observationDto(row)),
      };
    });
    if (timeline.events.length === 0 && timeline.observations.length === 0) {
      await this.#ensurePerson(personId, tenantId);
    }
    return timeline;
  }

  async #getExpectedEvent(expectedEventId: string, tenantId: string): Promise<EngagementEventDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(expectedEngagementEvents).where(and(
        eq(expectedEngagementEvents.tenantId, tenantId as Uuid),
        eq(expectedEngagementEvents.id, expectedEventId as Uuid),
        isNull(expectedEngagementEvents.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Expected engagement event', expectedEventId);
    return this.#eventDto(rows[0]);
  }

  async #getObservation(observationId: string, tenantId: string): Promise<EngagementObservationDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(engagementObservations).where(and(
        eq(engagementObservations.tenantId, tenantId as Uuid),
        eq(engagementObservations.id, observationId as Uuid),
        isNull(engagementObservations.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Engagement observation', observationId);
    return this.#observationDto(rows[0]);
  }

  async #ensureEnrolment(enrolmentId: string, personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: enrolments.id }).from(enrolments).where(and(
        eq(enrolments.tenantId, tenantId as Uuid),
        eq(enrolments.id, enrolmentId as Uuid),
        eq(enrolments.personId, personId as Uuid),
        isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Enrolment', enrolmentId);
  }

  async #ensurePerson(personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ personId: enrolments.personId }).from(enrolments).where(and(
        eq(enrolments.tenantId, tenantId as Uuid),
        eq(enrolments.personId, personId as Uuid),
        isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Student', personId);
  }

  async #validateCode(
    entityName: string,
    fieldName: string,
    value: string,
    tenantId: string,
    at: Date,
  ): Promise<void> {
    const valid = await this.valueSets.validateFieldValue(entityName, fieldName, value, tenantId, at);
    if (valid === false) {
      throw new ValidationError(`Invalid ${fieldName}: '${value}'`, [
        { field: fieldName, message: 'must be an active configured value' },
      ]);
    }
  }

  #date(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      throw new ValidationError(`Invalid ${field}`, [{ field, message: 'must be an ISO 8601 date-time' }]);
    }
    return date;
  }

  #eventDto(row: typeof expectedEngagementEvents.$inferSelect): EngagementEventDto {
    return {
      expectedEventId: row.id,
      personId: row.personId,
      enrolmentId: row.enrolmentId,
      activityTypeCode: row.activityTypeCode,
      activityReference: row.activityReference,
      eventModeCode: row.eventModeCode,
      scheduledFrom: row.scheduledFrom,
      scheduledTo: row.scheduledTo,
      locationReference: row.locationReference,
      sourceSystemCode: row.sourceSystemCode,
      sourceEventId: row.sourceEventId,
      sourceVersion: row.sourceVersion,
      statusCode: row.statusCode,
      validFrom: row.validFrom,
      validTo: row.validTo,
      recordedAt: row.recordedAt,
    };
  }

  #observationDto(row: typeof engagementObservations.$inferSelect): EngagementObservationDto {
    return {
      observationId: row.id,
      observationVersionId: row.versionId,
      expectedEventId: row.expectedEventId,
      personId: row.personId,
      enrolmentId: row.enrolmentId,
      sourceSystemCode: row.sourceSystemCode,
      sourceEventId: row.sourceEventId,
      sourceVersion: row.sourceVersion,
      captureMethodCode: row.captureMethodCode,
      outcomeCode: row.outcomeCode,
      dataQualityCode: row.dataQualityCode,
      eventTime: row.eventTime,
      receivedAt: row.receivedAt,
      deviceReference: row.deviceReference,
      operationalReference: row.operationalReference,
      actorId: row.actorId,
      recordedAt: row.recordedAt,
    };
  }

  #rethrowUnique(error: unknown, message: string): never {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new ConflictError(message);
    }
    throw error;
  }

  #uuidOrNull(value: string): Uuid | null {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      ? value as Uuid
      : null;
  }
}
