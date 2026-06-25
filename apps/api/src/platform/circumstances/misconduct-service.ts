import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  enrolments,
  marks,
  misconductCaseReferences,
  misconductOutcomes,
  misconductPenaltyEffects,
  moduleRegistrations,
  persons,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { EVENT_TYPES, NotFoundError, ValidationError } from '@revelation-srs/domain';
import type { CircumstancesMisconductOutcomeRecordedV1Payload } from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

export interface MisconductPenaltyEffectInput {
  targetEntityType: 'mark' | 'module_registration';
  targetEntityId: string;
  penaltyDetail?: string;
}

export interface RecordMisconductOutcomeInput {
  enrolmentId: string;
  caseReference: string;
  caseStatusCode?: string;
  penaltyCode: string;
  effectiveDate: string;
  penaltyEffects?: MisconductPenaltyEffectInput[];
}

export interface MisconductOutcomeDto {
  misconductCaseId: string;
  misconductOutcomeId: string;
  enrolmentId: string;
  personId: string;
  caseReference: string;
  caseStatusCode: string;
  penaltyCode: string;
  effectiveDate: string;
  actorId: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
  penaltyEffects: MisconductPenaltyEffectDto[];
}

export interface MisconductPenaltyEffectDto {
  penaltyEffectId: string;
  misconductOutcomeId: string;
  targetEntityType: string;
  targetEntityId: string;
  penaltyDetail: string | null;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

export class MisconductService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly eventBus: IntegrationBusPublisher,
  ) {}

  async recordMisconductOutcome(
    tenantId: string,
    personId: string,
    input: RecordMisconductOutcomeInput,
    actorId: string,
  ): Promise<string> {
    await this.#ensureEnrolmentBelongsToPerson(input.enrolmentId, personId, tenantId);
    await this.#validatePenaltyCode(tenantId, input.penaltyCode);
    for (const effect of input.penaltyEffects ?? []) {
      await this.#ensurePenaltyTarget(effect, input.enrolmentId, tenantId);
    }

    const misconductCaseId = randomUUID();
    const misconductOutcomeId = randomUUID();
    const now = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(misconductCaseReferences).values({
        versionId: randomUUID(),
        id: misconductCaseId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId: input.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        personId: personId as `${string}-${string}-${string}-${string}-${string}`,
        caseReference: input.caseReference,
        caseStatusCode: input.caseStatusCode ?? 'closed',
        actorId,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });

      await tx.insert(misconductOutcomes).values({
        versionId: randomUUID(),
        id: misconductOutcomeId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        misconductCaseId,
        enrolmentId: input.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        penaltyCode: input.penaltyCode,
        effectiveDate: input.effectiveDate,
        actorId,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });

      if (input.penaltyEffects?.length) {
        await tx.insert(misconductPenaltyEffects).values(input.penaltyEffects.map((effect) => ({
          versionId: randomUUID(),
          id: randomUUID(),
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          misconductOutcomeId,
          targetEntityType: effect.targetEntityType,
          targetEntityId: effect.targetEntityId as `${string}-${string}-${string}-${string}-${string}`,
          penaltyDetail: effect.penaltyDetail ?? null,
          validFrom: now,
          validTo: null,
          recordedAt: now,
          recordedUntil: null,
        })));
      }
    });

    if (this.eventBus.isConnected()) {
      const payload: CircumstancesMisconductOutcomeRecordedV1Payload = {
        misconductCaseId,
        misconductOutcomeId,
        enrolmentId: input.enrolmentId,
        personId,
        caseReference: input.caseReference,
        caseStatusCode: input.caseStatusCode ?? 'closed',
        penaltyCode: input.penaltyCode,
        effectiveDate: input.effectiveDate,
      };
      await this.eventBus.publish(
        EVENT_TYPES.CIRCUMSTANCES_MISCONDUCT_OUTCOME_RECORDED,
        '1.0.0',
        tenantId,
        actorId,
        'sensitive',
        payload,
      );
    }

    return misconductOutcomeId;
  }

  async listMisconductOutcomes(
    personId: string,
    tenantId: string,
    enrolmentId?: string,
  ): Promise<MisconductOutcomeDto[]> {
    await this.#ensurePersonExists(personId, tenantId);
    if (enrolmentId) await this.#ensureEnrolmentBelongsToPerson(enrolmentId, personId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          misconductCaseId: misconductCaseReferences.id,
          misconductOutcomeId: misconductOutcomes.id,
          enrolmentId: misconductOutcomes.enrolmentId,
          personId: misconductCaseReferences.personId,
          caseReference: misconductCaseReferences.caseReference,
          caseStatusCode: misconductCaseReferences.caseStatusCode,
          penaltyCode: misconductOutcomes.penaltyCode,
          effectiveDate: misconductOutcomes.effectiveDate,
          actorId: misconductOutcomes.actorId,
          validFrom: misconductOutcomes.validFrom,
          validTo: misconductOutcomes.validTo,
          recordedAt: misconductOutcomes.recordedAt,
          recordedUntil: misconductOutcomes.recordedUntil,
        })
        .from(misconductOutcomes)
        .innerJoin(misconductCaseReferences, eq(misconductOutcomes.misconductCaseId, misconductCaseReferences.id))
        .where(and(
          eq(misconductCaseReferences.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
          eq(misconductOutcomes.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          eq(misconductCaseReferences.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ...(enrolmentId ? [eq(misconductOutcomes.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          isNull(misconductOutcomes.recordedUntil),
          isNull(misconductCaseReferences.recordedUntil),
        ))
        .orderBy(misconductOutcomes.effectiveDate, misconductOutcomes.recordedAt),
    );

    const effects = await this.#listPenaltyEffects(rows.map((row) => row.misconductOutcomeId), tenantId);
    return rows.map((row) => ({
      ...row,
      penaltyEffects: effects.filter((effect) => effect.misconductOutcomeId === row.misconductOutcomeId),
    }));
  }

  async #listPenaltyEffects(outcomeIds: string[], tenantId: string): Promise<MisconductPenaltyEffectDto[]> {
    if (outcomeIds.length === 0) return [];
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(misconductPenaltyEffects)
        .where(and(
          eq(misconductPenaltyEffects.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(misconductPenaltyEffects.recordedUntil),
          inArray(misconductPenaltyEffects.misconductOutcomeId, outcomeIds as Array<`${string}-${string}-${string}-${string}-${string}`>),
        )),
    );
    return rows.map(effectToDto);
  }

  async #validatePenaltyCode(tenantId: string, penaltyCode: string): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue('misconduct_outcome', 'penalty_code', penaltyCode, tenantId);
    if (isValid === false) {
      throw new ValidationError(
        `Invalid value '${penaltyCode}' for misconduct_outcome.penalty_code`,
        [{ field: 'penaltyCode', message: 'Value is not active in the configured value set' }],
      );
    }
  }

  async #ensurePenaltyTarget(effect: MisconductPenaltyEffectInput, enrolmentId: string, tenantId: string): Promise<void> {
    if (effect.targetEntityType === 'module_registration') {
      const rows = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.select({ id: moduleRegistrations.id }).from(moduleRegistrations).where(and(
          eq(moduleRegistrations.id, effect.targetEntityId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
          eq(moduleRegistrations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(moduleRegistrations.recordedUntil),
        )).limit(1),
      );
      if (rows.length === 0) throw new NotFoundError('ModuleRegistration', effect.targetEntityId);
      return;
    }

    if (effect.targetEntityType === 'mark') {
      const rows = await withTenantContext(this.db, tenantId, async (tx) =>
        tx.select({ id: marks.id }).from(marks).where(and(
          eq(marks.id, effect.targetEntityId as `${string}-${string}-${string}-${string}-${string}`),
          eq(marks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(marks.recordedUntil),
        )).limit(1),
      );
      if (rows.length === 0) throw new NotFoundError('Mark', effect.targetEntityId);
      return;
    }

    throw new ValidationError('Invalid misconduct penalty target type', [
      { field: 'targetEntityType', message: 'Must be mark or module_registration' },
    ]);
  }

  async #ensurePersonExists(personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: persons.id }).from(persons).where(and(
        eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
        eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (rows.length === 0) throw new NotFoundError('Person', personId);
  }

  async #ensureEnrolmentBelongsToPerson(enrolmentId: string, personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: enrolments.id }).from(enrolments).where(and(
        eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
        eq(enrolments.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
        eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(enrolments.recordedUntil),
      )).limit(1),
    );
    if (rows.length === 0) throw new NotFoundError('Enrolment', enrolmentId);
  }
}

function effectToDto(row: typeof misconductPenaltyEffects.$inferSelect): MisconductPenaltyEffectDto {
  return {
    penaltyEffectId: row.id,
    misconductOutcomeId: row.misconductOutcomeId,
    targetEntityType: row.targetEntityType,
    targetEntityId: row.targetEntityId,
    penaltyDetail: row.penaltyDetail,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}
