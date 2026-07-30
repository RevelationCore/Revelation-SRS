import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  engagementOutcomes,
  enrolments,
  persons,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
} from '@revelation-srs/domain';
import type { EngagementOutcomeRecordedV1Payload } from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface RecordEngagementOutcomeInput {
  enrolmentId: string;
  moduleRegistrationId?: string;
  outcomeCode: string;
  severityCode?: string;
  effectiveFrom: string;
  sourceAlertId?: string;
  // Populated only for outcomeCode 'referred-sponsor-compliance' — see
  // engagement-outcome.ts and srs-engagement-outcome-client.ts.
  policyVersionId?: string;
  evidenceWindowFrom?: string;
  evidenceWindowTo?: string;
  evidenceSnapshot?: Record<string, unknown>;
  evidenceHash?: string;
  reevaluationRequired?: boolean;
}

export interface EngagementOutcomeDto {
  engagementOutcomeId: string;
  personId: string;
  enrolmentId: string;
  moduleRegistrationId: string | null;
  outcomeCode: string;
  severityCode: string | null;
  sourceAlertId: string | null;
  sourceModule: string;
  actorId: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
}

/**
 * Records the operational outcome handed off by the attendance module
 * (modules/attendance). SRS is the system of record for this outcome and is
 * solely responsible for publishing srs.engagement.outcome-recorded to
 * downstream consumers — mirroring the F-WELL-SIS-01 reasonable-adjustment pattern.
 */
export class EngagementOutcomeService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
  ) {}

  async recordOutcome(
    tenantId: string,
    personId: string,
    input: RecordEngagementOutcomeInput,
    actorId: string,
  ): Promise<string> {
    await this.#ensureEnrolmentBelongsToPerson(input.enrolmentId, personId, tenantId);

    const effectiveFrom = new Date(input.effectiveFrom);
    if (Number.isNaN(effectiveFrom.valueOf())) {
      throw new ValidationError('effectiveFrom must be an ISO 8601 date-time');
    }

    // Idempotent on (sourceAlertId, outcomeCode) when the caller supplies one —
    // a retried delivery from the attendance module returns the existing row
    // rather than creating a duplicate.
    if (input.sourceAlertId) {
      const existing = await withTenantContext(this.db, tenantId, (tx) =>
        tx.select({ id: engagementOutcomes.id }).from(engagementOutcomes).where(and(
          eq(engagementOutcomes.tenantId, tenantId as Uuid),
          eq(engagementOutcomes.sourceAlertId, input.sourceAlertId!),
          eq(engagementOutcomes.outcomeCode, input.outcomeCode),
          isNull(engagementOutcomes.recordedUntil),
        )).limit(1),
      );
      if (existing[0]) return existing[0].id;
    }

    const engagementOutcomeId = randomUUID();
    const now = clockNow();

    await withTenantContext(this.db, tenantId, (tx) =>
      tx.insert(engagementOutcomes).values({
        versionId: randomUUID(),
        id: engagementOutcomeId,
        tenantId: tenantId as Uuid,
        personId: personId as Uuid,
        enrolmentId: input.enrolmentId as Uuid,
        moduleRegistrationId: input.moduleRegistrationId ? input.moduleRegistrationId as Uuid : null,
        outcomeCode: input.outcomeCode,
        severityCode: input.severityCode ?? null,
        sourceAlertId: input.sourceAlertId ?? null,
        sourceModule: 'attendance',
        actorId,
        validFrom: effectiveFrom,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
        policyVersionId: input.policyVersionId ? input.policyVersionId as Uuid : null,
        evidenceWindowFrom: input.evidenceWindowFrom ? new Date(input.evidenceWindowFrom) : null,
        evidenceWindowTo: input.evidenceWindowTo ? new Date(input.evidenceWindowTo) : null,
        evidenceSnapshot: input.evidenceSnapshot ?? null,
        evidenceHash: input.evidenceHash ?? null,
        reevaluationRequired: input.reevaluationRequired ?? null,
      }),
    );

    if (this.eventBus.isConnected()) {
      const payload: EngagementOutcomeRecordedV1Payload = {
        engagementOutcomeId,
        personId,
        enrolmentId: input.enrolmentId,
        ...(input.moduleRegistrationId !== undefined ? { moduleRegistrationId: input.moduleRegistrationId } : {}),
        outcomeCode: input.outcomeCode,
        ...(input.severityCode !== undefined ? { severityCode: input.severityCode } : {}),
        effectiveFrom: effectiveFrom.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.ENGAGEMENT_OUTCOME_RECORDED,
        '1.0.0',
        tenantId,
        actorId,
        'sensitive',
        payload,
        { validAt: effectiveFrom },
      );
    }

    return engagementOutcomeId;
  }

  async listOutcomes(personId: string, tenantId: string, enrolmentId?: string): Promise<EngagementOutcomeDto[]> {
    await this.#ensurePersonExists(personId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(engagementOutcomes).where(and(
        eq(engagementOutcomes.tenantId, tenantId as Uuid),
        eq(engagementOutcomes.personId, personId as Uuid),
        isNull(engagementOutcomes.recordedUntil),
        enrolmentId ? eq(engagementOutcomes.enrolmentId, enrolmentId as Uuid) : undefined,
      )).orderBy(asc(engagementOutcomes.validFrom)),
    );
    return rows.map((row) => this.#dto(row));
  }

  async #ensurePersonExists(personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ id: persons.id }).from(persons).where(and(
        eq(persons.id, personId as Uuid),
        eq(persons.tenantId, tenantId as Uuid),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Student', personId);
  }

  async #ensureEnrolmentBelongsToPerson(enrolmentId: string, personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({ id: enrolments.id }).from(enrolments).where(and(
        eq(enrolments.tenantId, tenantId as Uuid),
        eq(enrolments.id, enrolmentId as Uuid),
        eq(enrolments.personId, personId as Uuid),
        isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Enrolment', enrolmentId);
  }

  #dto(row: typeof engagementOutcomes.$inferSelect): EngagementOutcomeDto {
    return {
      engagementOutcomeId: row.id,
      personId: row.personId,
      enrolmentId: row.enrolmentId,
      moduleRegistrationId: row.moduleRegistrationId,
      outcomeCode: row.outcomeCode,
      severityCode: row.severityCode,
      sourceAlertId: row.sourceAlertId,
      sourceModule: row.sourceModule,
      actorId: row.actorId,
      validFrom: row.validFrom,
      validTo: row.validTo,
      recordedAt: row.recordedAt,
    };
  }
}
