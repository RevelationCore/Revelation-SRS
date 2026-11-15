import { createHash, randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  adjustmentDistributions,
  adjustmentRequests,
  enrolments,
  persons,
  reasonableAdjustments,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  createPostgresDocumentAdapter,
  DocumentNotFoundError,
  DocumentTooLargeError,
  DocumentTypeNotAllowedError,
  type RetrievedDocument,
} from '@revelation-srs/documents';
import {
  ConflictError,
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
import { clockNow } from '../clock.js';

export interface RecordAdjustmentInput {
  enrolmentId: string;
  adjustmentTypeCode: string;
  scopeCode: string;
  validFrom: string;
  validTo?: string;
  notes?: string;
  /** Wellbeing module adjustment_case logical id, when this record
   * originated from that module's referral -> assessment -> approve
   * workflow rather than a direct registry-administrator entry. Opaque
   * cross-service reference, not validated against anything in this DB. */
  sourceCaseId?: string;
}

export interface RecordAdjustmentResult {
  adjustmentId: string;
  /** True when an earlier request with the same idempotency key and payload
   * already recorded this adjustment; nothing new was written or published. */
  replayed: boolean;
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
  sourceCaseId: string | null;
  outcomeDocumentId: string | null;
}

export interface AttachOutcomeDocumentInput {
  filename: string;
  mimeType: string;
  content: Buffer;
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
    idempotencyKey?: string,
  ): Promise<RecordAdjustmentResult> {
    await this.#ensureEnrolmentBelongsToPerson(input.enrolmentId, personId, tenantId);
    await this.#validateInput(tenantId, input);

    const now = clockNow();
    const validFrom = new Date(input.validFrom);
    const validTo = input.validTo ? new Date(input.validTo) : null;
    const targetSystems = this.#targetSystemsForScope(input.scopeCode);
    const payloadHash = hashRequest({
      personId,
      enrolmentId: input.enrolmentId,
      adjustmentTypeCode: input.adjustmentTypeCode,
      scopeCode: input.scopeCode,
      validFrom: validFrom.toISOString(),
      validTo: validTo ? validTo.toISOString() : null,
      notes: input.notes ?? null,
      sourceCaseId: input.sourceCaseId ?? null,
    });

    const result = await withTenantContext(this.db, tenantId, async (tx): Promise<RecordAdjustmentResult> => {
      const adjustmentId = randomUUID();

      // Claim the key first. A concurrent request with the same key waits on
      // the primary key until this transaction ends, then finds the row.
      if (idempotencyKey) {
        const claimed = await tx.insert(adjustmentRequests).values({
          tenantId: tenantId as `${string}-${string}-${string}-${string}-${string}`,
          idempotencyKey,
          payloadHash,
          adjustmentId,
          createdAt: now,
        }).onConflictDoNothing().returning();

        if (claimed.length === 0) {
          const existing = await tx.select().from(adjustmentRequests).where(and(
            eq(adjustmentRequests.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(adjustmentRequests.idempotencyKey, idempotencyKey),
          )).limit(1);
          const prior = existing[0];
          if (!prior) throw new ConflictError('This idempotency key is in use by a request that did not complete');
          if (prior.payloadHash !== payloadHash) {
            throw new ConflictError('This idempotency key was already used for a different adjustment request');
          }
          return { adjustmentId: prior.adjustmentId, replayed: true };
        }
      }

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
        sourceCaseId: input.sourceCaseId ?? null,
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

      return { adjustmentId, replayed: false };
    });

    if (result.replayed) return result;
    const { adjustmentId } = result;

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

    return result;
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

  async getAdjustment(adjustmentId: string, tenantId: string): Promise<AdjustmentDto> {
    return this.#getCurrentAdjustment(adjustmentId, tenantId);
  }

  async acknowledgeDistribution(
    adjustmentId: string,
    distributionId: string,
    tenantId: string,
    targetSystem: string,
  ): Promise<void> {
    const adjustment = await this.#getCurrentAdjustment(adjustmentId, tenantId);
    const distribution = await this.#getDistribution(adjustmentId, distributionId, tenantId);
    if (distribution.targetSystem !== targetSystem) {
      throw new NotFoundError('AdjustmentDistribution', distributionId);
    }

    // A repeated acknowledgement (e.g. a consumer retrying after a lost
    // response) is a no-op: the first one already recorded and published it.
    if (distribution.statusCode === 'distributed') return;
    if (distribution.statusCode === 'superseded') {
      throw new ConflictError('This distribution was superseded and can no longer be acknowledged');
    }

    const now = clockNow();
    const updated = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
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
            inArray(adjustmentDistributions.statusCode, ['pending', 'failed']),
          ),
        )
        .returning({ id: adjustmentDistributions.id }),
    );

    // Lost a race with a concurrent acknowledgement or expiry.
    if (updated.length === 0) {
      const latest = await this.#getDistribution(adjustmentId, distributionId, tenantId);
      if (latest.statusCode === 'superseded') {
        throw new ConflictError('This distribution was superseded and can no longer be acknowledged');
      }
      return;
    }

    if (this.eventBus.isConnected()) {
      const payload: AdjustmentDistributedV1Payload = {
        adjustmentId,
        distributionId,
        targetSystem,
        distributedAt:      now.toISOString(),
        personId:           adjustment.personId,
        enrolmentId:        adjustment.enrolmentId,
        adjustmentTypeCode: adjustment.adjustmentTypeCode,
        scopeCode:          adjustment.scopeCode,
        validFrom:          adjustment.validFrom.toISOString(),
        ...(adjustment.validTo ? { validTo: adjustment.validTo.toISOString() } : {}),
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

  /**
   * End an adjustment's valid period now (or immediately after it starts,
   * if it has not started yet).
   *
   * A bitemporal update, like attachOutcomeDocument: the current version is
   * closed in transaction time and a successor is recorded with the new
   * validTo. The closed version keeps its original validTo, so a query
   * "as recorded before the expiry" still shows what was then believed, and
   * the expired adjustment stays visible (with its end date) for history,
   * board packs and later reconstruction. An adjustment whose period has
   * already ended keeps its recorded end date and gains no new version.
   * The expired event is still published, as before: there is no scheduler
   * that announces a natural end, so this call may be consumers' only signal.
   */
  async expireAdjustment(adjustmentId: string, tenantId: string, actorId: string): Promise<void> {
    const now = clockNow();

    const outcome = await withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .for('update')
        .limit(1);
      const current = rows[0];
      if (!current) throw new NotFoundError('ReasonableAdjustment', adjustmentId);

      const endAt = now > current.validFrom
        ? now
        : new Date(current.validFrom.getTime() + 1);
      const alreadyEnded = current.validTo !== null && current.validTo <= endAt;

      if (!alreadyEnded) {
        await tx
          .update(reasonableAdjustments)
          .set({ recordedUntil: now })
          .where(eq(reasonableAdjustments.versionId, current.versionId));

        await tx.insert(reasonableAdjustments).values({
          ...current,
          versionId:     randomUUID(),
          validTo:       endAt,
          actorId,
          recordedAt:    now,
          recordedUntil: null,
        });
      }

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

      return {
        current,
        endedAt: alreadyEnded ? current.validTo! : endAt,
      };
    });

    if (this.eventBus.isConnected()) {
      const payload: AdjustmentExpiredV1Payload = {
        adjustmentId,
        enrolmentId: outcome.current.enrolmentId,
        personId: outcome.current.personId,
        expiredAt: outcome.endedAt.toISOString(),
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

  /**
   * Attach a detail document expanding on the coded adjustment (e.g. a
   * specific seating/equipment/software specification) — for when the
   * type/scope/notes fields alone aren't expressive enough. Stored via
   * this service's own packages/documents install, independent of
   * whatever the wellbeing module holds for the case that originated
   * this record (if any) — see sourceCaseId's doc comment on why that's
   * a deliberate choice, not an oversight.
   *
   * A bitemporal correction: the current version is closed and a new one
   * inserted with the same valid-time range (the adjustment itself
   * hasn't changed, only our documentation of it) — never an in-place
   * overwrite.
   */
  async attachOutcomeDocument(
    adjustmentId: string,
    personId:     string,
    tenantId:     string,
    actorId:      string,
    input:        AttachOutcomeDocumentInput,
  ): Promise<{ documentId: string; checksumSha256: string }> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .limit(1);

      const current = rows[0];
      // Not-found (rather than forbidden) for a personId/adjustmentId
      // mismatch — consistent with #ensureEnrolmentBelongsToPerson, and
      // avoids letting a caller probe which adjustment IDs exist.
      if (!current || current.personId !== personId) throw new NotFoundError('ReasonableAdjustment', adjustmentId);

      let stored;
      try {
        stored = await createPostgresDocumentAdapter(tx).store({
          tenantId,
          ownerService: 'srs-adjustments',
          ownerRef:     adjustmentId,
          filename:     input.filename,
          mimeType:     input.mimeType,
          content:      input.content,
          actorId,
        });
      } catch (err) {
        if (err instanceof DocumentTooLargeError || err instanceof DocumentTypeNotAllowedError) {
          throw new ValidationError(err.message);
        }
        throw err;
      }

      const now = clockNow();
      await tx
        .update(reasonableAdjustments)
        .set({ recordedUntil: now })
        .where(eq(reasonableAdjustments.versionId, current.versionId));

      await tx.insert(reasonableAdjustments).values({
        ...current,
        versionId:         randomUUID(),
        actorId,
        recordedAt:        now,
        recordedUntil:     null,
        outcomeDocumentId: stored.documentId,
      });

      return { documentId: stored.documentId, checksumSha256: stored.checksumSha256 };
    });
  }

  async getOutcomeDocument(adjustmentId: string, personId: string, tenantId: string, actorId: string): Promise<RetrievedDocument> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ personId: reasonableAdjustments.personId, outcomeDocumentId: reasonableAdjustments.outcomeDocumentId })
        .from(reasonableAdjustments)
        .where(
          and(
            eq(reasonableAdjustments.id, adjustmentId as `${string}-${string}-${string}-${string}-${string}`),
            eq(reasonableAdjustments.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(reasonableAdjustments.recordedUntil),
          ),
        )
        .limit(1);

      const current = rows[0];
      if (!current || current.personId !== personId) throw new NotFoundError('ReasonableAdjustment', adjustmentId);
      if (!current.outcomeDocumentId) throw new NotFoundError('AdjustmentOutcomeDocument', adjustmentId);

      try {
        return await createPostgresDocumentAdapter(tx).retrieve(tenantId, current.outcomeDocumentId, actorId);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) throw new NotFoundError('AdjustmentOutcomeDocument', adjustmentId);
        throw err;
      }
    });
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

  /**
   * Checks any version (current or historical) exists — deliberately not
   * limited to the current version. listDistributions is a read/history
   * operation and must still work after the adjustment has been expired
   * (expireAdjustment closes the current version with no replacement row),
   * otherwise there would be no way to see that its pending distributions
   * were marked superseded.
   */
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

function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
    sourceCaseId: row.sourceCaseId,
    outcomeDocumentId: row.outcomeDocumentId,
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
