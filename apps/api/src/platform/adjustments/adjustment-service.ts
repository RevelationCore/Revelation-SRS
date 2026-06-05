import { randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  adjustmentDistributions,
  enrolments,
  persons,
  reasonableAdjustments,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
} from '@revelation-srs/domain';
import type {
  AdjustmentApprovedV1Payload,
  AdjustmentDistributedV1Payload,
  AdjustmentExpiredV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';

export interface RecordAdjustmentInput {
  enrolmentId: string;
  adjustmentTypeCode: string;
  scopeCode: string;
  validFrom: string;
  validTo?: string;
  notes?: string;
}

export interface AdjustmentDto {
  adjustmentId: string;
  enrolmentId: string;
  personId: string;
  adjustmentTypeCode: string;
  scopeCode: string;
  notes: string | null;
  actorId: string;
  validFrom: Date;
  validTo: Date | null;
  recordedAt: Date;
  recordedUntil: Date | null;
}

export interface AdjustmentDistributionDto {
  distributionId: string;
  adjustmentId: string;
  targetSystem: string;
  statusCode: string;
  distributedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TARGET_SYSTEMS_BY_SCOPE: Record<string, string[]> = {
  all: ['vle', 'attendance', 'exams'],
  coursework: ['vle'],
  attendance: ['attendance'],
  exam: ['exams'],
};

export class AdjustmentService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
  ) {}

  async recordAdjustment(
    tenantId: string,
    personId: string,
    input: RecordAdjustmentInput,
    actorId: string,
  ): Promise<string> {
    await this.#ensureEnrolmentBelongsToPerson(input.enrolmentId, personId, tenantId);
    await this.#validateInput(tenantId, input);

    const adjustmentId = randomUUID();
    const now = new Date();
    const validFrom = new Date(input.validFrom);
    const validTo = input.validTo ? new Date(input.validTo) : null;
    const targetSystems = this.#targetSystemsForScope(input.scopeCode);

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(reasonableAdjustments).values({
        versionId: randomUUID(),
        id: adjustmentId,
        tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
        enrolmentId: input.enrolmentId as `${string}-${string}-${string}-${string}-${string}`,
        personId: personId as `${string}-${string}-${string}-${string}-${string}`,
        adjustmentTypeCode: input.adjustmentTypeCode,
        scopeCode: input.scopeCode,
        notes: input.notes ?? null,
        actorId,
        validFrom,
        validTo,
        recordedAt: now,
        recordedUntil: null,
      });

      if (targetSystems.length > 0) {
        await tx.insert(adjustmentDistributions).values(targetSystems.map((targetSystem) => ({
          id: randomUUID(),
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          adjustmentId,
          targetSystem,
          statusCode: 'pending',
          distributedAt: null,
          failureReason: null,
          createdAt: now,
          updatedAt: now,
        })));
      }
    });

    if (this.eventBus.isConnected()) {
      const payload: AdjustmentApprovedV1Payload = {
        adjustmentId,
        enrolmentId: input.enrolmentId,
        personId,
        adjustmentTypeCode: input.adjustmentTypeCode,
        scopeCode: input.scopeCode,
        validFrom: validFrom.toISOString(),
        ...(validTo ? { validTo: validTo.toISOString() } : {}),
      };
      await this.eventBus.publish(
        EVENT_TYPES.ADJUSTMENT_APPROVED,
        '1.0.0',
        tenantId,
        actorId,
        'sensitive',
        payload,
      );
    }

    return adjustmentId;
  }

  async listAdjustments(
    personId: string,
    tenantId: string,
    enrolmentId?: string,
  ): Promise<AdjustmentDto[]> {
    await this.#ensurePersonExists(personId, tenantId);
    if (enrolmentId) await this.#ensureEnrolmentBelongsToPerson(enrolmentId, personId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            ...(enrolmentId ? [eq(reasonableAdjustments.enrolmentId, enrolmentId as `${string}-${string}-${string}-${string}-${string}`)] : []),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .orderBy(reasonableAdjustments.validFrom, reasonableAdjustments.recordedAt),
    );

    return rows.map(adjustmentToDto);
  }

  async listDistributions(adjustmentId: string, tenantId: string): Promise<AdjustmentDistributionDto[]> {
    await this.#ensureAdjustmentExists(adjustmentId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(adjustmentDistributions)
        .where(
          and(
            eq(adjustmentDistributions.adjustmentId, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(adjustmentDistributions.createdAt, adjustmentDistributions.targetSystem),
    );

    return rows.map(distributionToDto);
  }

  async acknowledgeDistribution(
    adjustmentId: string,
    distributionId: string,
    tenantId: string,
    targetSystem: string,
  ): Promise<void> {
    await this.#getCurrentAdjustment(adjustmentId, tenantId);
    const distribution = await this.#getDistribution(adjustmentId, distributionId, tenantId);
    if (distribution.targetSystem !== targetSystem) {
      throw new NotFoundError('AdjustmentDistribution', distributionId);
    }

    const now = new Date();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(adjustmentDistributions)
        .set({
          statusCode: 'distributed',
          distributedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(adjustmentDistributions.id, distributionId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.adjustmentId, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        );
    });

    if (this.eventBus.isConnected()) {
      const payload: AdjustmentDistributedV1Payload = {
        adjustmentId,
        distributionId,
        targetSystem,
        distributedAt: now.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.ADJUSTMENT_DISTRIBUTED,
        '1.0.0',
        tenantId,
        distributionId,
        'sensitive',
        payload,
      );
    }
  }

  async expireAdjustment(adjustmentId: string, tenantId: string, actorId: string): Promise<void> {
    const current = await this.#getCurrentAdjustment(adjustmentId, tenantId);
    const now = new Date();
    const validTo = now > current.validFrom
      ? now
      : new Date(current.validFrom.getTime() + 1);

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(reasonableAdjustments)
        .set({ validTo, recordedUntil: now })
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        );

      await tx
        .update(adjustmentDistributions)
        .set({ statusCode: 'superseded', updatedAt: now })
        .where(
          and(
            eq(adjustmentDistributions.adjustmentId, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.statusCode, 'pending'),
          ),
        );
    });

    if (this.eventBus.isConnected()) {
      const payload: AdjustmentExpiredV1Payload = {
        adjustmentId,
        enrolmentId: current.enrolmentId,
        personId: current.personId,
        expiredAt: now.toISOString(),
      };
      await this.eventBus.publish(
        EVENT_TYPES.ADJUSTMENT_EXPIRED,
        '1.0.0',
        tenantId,
        actorId,
        'sensitive',
        payload,
      );
    }
  }

  async #validateInput(tenantId: string, input: RecordAdjustmentInput): Promise<void> {
    const validFrom = new Date(input.validFrom);
    const validTo = input.validTo ? new Date(input.validTo) : null;
    if (Number.isNaN(validFrom.getTime())) {
      throw new ValidationError('Adjustment validFrom must be a valid date-time', [
        { field: 'validFrom', message: 'Must be a valid date-time' },
      ]);
    }
    if (validTo && (Number.isNaN(validTo.getTime()) || validTo <= validFrom)) {
      throw new ValidationError('Adjustment validTo must be after validFrom', [
        { field: 'validTo', message: 'Must be after validFrom' },
      ]);
    }

    await this.#validateFieldValue(tenantId, 'reasonable_adjustment', 'adjustment_type_code', input.adjustmentTypeCode);
    await this.#validateFieldValue(tenantId, 'reasonable_adjustment', 'scope_code', input.scopeCode);
  }

  async #validateFieldValue(
    tenantId: string,
    entityName: string,
    fieldName: string,
    value: string,
  ): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue(entityName, fieldName, value, tenantId);
    if (isValid === false) {
      throw new ValidationError(
        `Invalid value '${value}' for ${entityName}.${fieldName}`,
        [{ field: fieldName, message: 'Value is not active in the configured value set' }],
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

    if (rows.length === 0) throw new NotFoundError('Person', personId);
  }

  async #ensureEnrolmentBelongsToPerson(
    enrolmentId: string,
    personId: string,
    tenantId: string,
  ): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: enrolments.id })
        .from(enrolments)
        .where(
          and(
            eq(enrolments.id, enrolmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(enrolments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(enrolments.recordedUntil),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) throw new NotFoundError('Enrolment', enrolmentId);
  }

  async #getCurrentAdjustment(adjustmentId: string, tenantId: string): Promise<AdjustmentDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .limit(1),
    );

    const row = rows[0];
    if (!row) throw new NotFoundError('ReasonableAdjustment', adjustmentId);
    return adjustmentToDto(row);
  }

  async #ensureAdjustmentExists(adjustmentId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: reasonableAdjustments.id })
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) throw new NotFoundError('ReasonableAdjustment', adjustmentId);
  }

  async #getDistribution(
    adjustmentId: string,
    distributionId: string,
    tenantId: string,
  ): Promise<AdjustmentDistributionDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(adjustmentDistributions)
        .where(
          and(
            eq(adjustmentDistributions.id, distributionId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.adjustmentId, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentDistributions.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    const row = rows[0];
    if (!row) throw new NotFoundError('AdjustmentDistribution', distributionId);
    return distributionToDto(row);
  }

  #targetSystemsForScope(scopeCode: string): string[] {
    return TARGET_SYSTEMS_BY_SCOPE[scopeCode] ?? ['vle', 'attendance', 'exams'];
  }
}

function adjustmentToDto(row: typeof reasonableAdjustments.$inferSelect): AdjustmentDto {
  return {
    adjustmentId: row.id,
    enrolmentId: row.enrolmentId,
    personId: row.personId,
    adjustmentTypeCode: row.adjustmentTypeCode,
    scopeCode: row.scopeCode,
    notes: row.notes,
    actorId: row.actorId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    recordedAt: row.recordedAt,
    recordedUntil: row.recordedUntil,
  };
}

function distributionToDto(row: typeof adjustmentDistributions.$inferSelect): AdjustmentDistributionDto {
  return {
    distributionId: row.id,
    adjustmentId: row.adjustmentId,
    targetSystem: row.targetSystem,
    statusCode: row.statusCode,
    distributedAt: row.distributedAt,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
