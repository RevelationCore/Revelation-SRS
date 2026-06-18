import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  enrolments,
  exceptionalCircumstances,
  moduleOfferings,
  persons,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { EVENT_TYPES, NotFoundError } from '@revelation-srs/domain';
import type {
  CircumstancesEcFlaggedV1Payload,
  CircumstancesEcUpdatedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import { clockNow } from '../clock.js';

export interface RecordExceptionalCircumstancesInput {
  enrolmentId: string;
  moduleOfferingId?: string;
  outcomeCode: string;
  determinationDate: string;
  notes?: string;
}

export interface UpdateExceptionalCircumstancesInput {
  moduleOfferingId?: string | null;
  outcomeCode?: string;
  determinationDate?: string;
  notes?: string | null;
}

export interface ExceptionalCircumstancesDto {
  exceptionalCircumstancesId: string;
  enrolmentId: string;
  personId: string;
  moduleOfferingId: string | null;
  outcomeCode: string;
  determinationDate: string;
  notes: string | null;
  actorId: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

export class ExceptionalCircumstancesService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
  ) {}

  async recordExceptionalCircumstances(
    tenantId: string,
    personId: string,
    input: RecordExceptionalCircumstancesInput,
    actorId: string,
  ): Promise<string> {
    await this.#ensureEnrolmentBelongsToPerson(input.enrolmentId, personId, tenantId);
    if (input.moduleOfferingId) await this.#ensureModuleOfferingExists(input.moduleOfferingId, tenantId);

    const ecId = randomUUID();
    const now = clockNow();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(exceptionalCircumstances).values({
        versionId: randomUUID(),
        id: ecId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId: input.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        personId: personId as `${string}-${string}-${string}-${string}-${string}`,
        moduleOfferingId: (input.moduleOfferingId ?? null) as `${string}-${string}-${string}-${string}-${string}` | null,
        outcomeCode: input.outcomeCode,
        determinationDate: input.determinationDate,
        notes: input.notes ?? null,
        actorId,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: CircumstancesEcFlaggedV1Payload = {
        exceptionalCircumstancesId: ecId,
        enrolmentId: input.enrolmentId,
        personId,
        ...(input.moduleOfferingId ? { moduleOfferingId: input.moduleOfferingId } : {}),
        outcomeCode: input.outcomeCode,
        determinationDate: input.determinationDate,
      };
      await this.eventBus.publish(EVENT_TYPES.CIRCUMSTANCES_EC_FLAGGED, '1.0.0', tenantId, actorId, 'sensitive', payload);
    }

    return ecId;
  }

  async updateExceptionalCircumstances(
    ecId: string,
    tenantId: string,
    input: UpdateExceptionalCircumstancesInput,
    actorId: string,
  ): Promise<void> {
    const current = await this.#getCurrentExceptionalCircumstances(ecId, tenantId);
    const nextModuleOfferingId = input.moduleOfferingId === undefined ? current.moduleOfferingId : input.moduleOfferingId;
    if (nextModuleOfferingId) await this.#ensureModuleOfferingExists(nextModuleOfferingId, tenantId);

    const now = clockNow();
    const nextOutcomeCode = input.outcomeCode ?? current.outcomeCode;
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(exceptionalCircumstances)
        .set({ validTo: now, recordedUntil: now })
        .where(and(
          eq(exceptionalCircumstances.id, ecId as `${string}-${string}-${string}-${string}-${string}`),
          eq(exceptionalCircumstances.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          isNull(exceptionalCircumstances.recordedUntil),
        ));

      await tx.insert(exceptionalCircumstances).values({
        versionId: randomUUID(),
        id: ecId as `${string}-${string}-${string}-${string}-${string}`,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId: current.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        personId: current.personId as `${string}-${string}-${string}-${string}-${string}`,
        moduleOfferingId: nextModuleOfferingId as `${string}-${string}-${string}-${string}-${string}` | null,
        outcomeCode: nextOutcomeCode,
        determinationDate: input.determinationDate ?? current.determinationDate,
        notes: input.notes === undefined ? current.notes : input.notes,
        actorId,
        validFrom: now,
        validTo: null,
        recordedAt: now,
        recordedUntil: null,
      });
    });

    if (this.eventBus.isConnected()) {
      const payload: CircumstancesEcUpdatedV1Payload = {
        exceptionalCircumstancesId: ecId,
        previousOutcomeCode: current.outcomeCode,
        newOutcomeCode: nextOutcomeCode,
      };
      await this.eventBus.publish(EVENT_TYPES.CIRCUMSTANCES_EC_UPDATED, '1.0.0', tenantId, actorId, 'sensitive', payload);
    }
  }

  async listExceptionalCircumstances(
    personId: string,
    tenantId: string,
    enrolmentId?: string,
  ): Promise<ExceptionalCircumstancesDto[]> {
    await this.#ensurePersonExists(personId, tenantId);
    if (enrolmentId) await this.#ensureEnrolmentBelongsToPerson(enrolmentId, personId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(exceptionalCircumstances)
        .where(and(
          eq(exceptionalCircumstances.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
          eq(exceptionalCircumstances.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ...(enrolmentId ? [eq(exceptionalCircumstances.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`)] : []),
          isNull(exceptionalCircumstances.recordedUntil),
        ))
        .orderBy(exceptionalCircumstances.determinationDate, exceptionalCircumstances.recordedAt),
    );

    return rows.map(ecToDto);
  }

  async #getCurrentExceptionalCircumstances(ecId: string, tenantId: string): Promise<ExceptionalCircumstancesDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(exceptionalCircumstances).where(and(
        eq(exceptionalCircumstances.id, ecId as `${string}-${string}-${string}-${string}-${string}`),
        eq(exceptionalCircumstances.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        isNull(exceptionalCircumstances.recordedUntil),
      )).limit(1),
    );
    if (!rows[0]) throw new NotFoundError('ExceptionalCircumstances', ecId);
    return ecToDto(rows[0]);
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

  async #ensureModuleOfferingExists(moduleOfferingId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: moduleOfferings.id }).from(moduleOfferings).where(and(
        eq(moduleOfferings.id, moduleOfferingId as `${string}-${string}-${string}-${string}-${string}`),
        eq(moduleOfferings.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      )).limit(1),
    );
    if (rows.length === 0) throw new NotFoundError('ModuleOffering', moduleOfferingId);
  }
}

function ecToDto(row: typeof exceptionalCircumstances.$inferSelect): ExceptionalCircumstancesDto {
  return {
    exceptionalCircumstancesId: row.id,
    enrolmentId: row.enrolmentId,
    personId: row.personId,
    moduleOfferingId: row.moduleOfferingId,
    outcomeCode: row.outcomeCode,
    determinationDate: row.determinationDate,
    notes: row.notes,
    actorId: row.actorId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}
