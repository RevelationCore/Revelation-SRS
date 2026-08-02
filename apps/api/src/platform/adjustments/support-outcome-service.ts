import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  supportOutcomes,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError } from '@revelation-srs/domain';

import { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Support-outcome distribution (BPR-D09). support_outcome is the
 * minimum-necessary outcome record, distinct from the simpler flat
 * adjustment_distribution status column. Per-target delivery goes through
 * the shared distribution_item/attempt/acknowledgement primitives so
 * targets can be reconciled individually.
 */

export interface RecordSupportOutcomeInput {
  enrolmentId:          string;
  sourceCaseId?:        string;
  sourceDecisionId?:    string;
  outcomeTypeCode:      string;
  minimumNecessaryText: string;
  visibilityScopeCode:  string;
}

export interface SupportOutcomeDto {
  supportOutcomeId:     string;
  enrolmentId:          string;
  sourceCaseId:         string | null;
  sourceDecisionId:     string | null;
  outcomeTypeCode:      string;
  minimumNecessaryText: string;
  visibilityScopeCode:  string;
  actorId:              string;
  validFrom:            Date;
  validTo:              Date | null;
  recordedAt:           Date;
  recordedUntil:        Date | null;
}

export class SupportOutcomeService {
  constructor(
    private readonly db: Db,
    private readonly businessCases: BusinessCaseService,
  ) {}

  async recordOutcome(tenantId: string, input: RecordSupportOutcomeInput, actorId: string): Promise<string> {
    const outcomeId = randomUUID();
    const now       = clockNow();

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(supportOutcomes).values({
        versionId:            randomUUID(),
        id:                   outcomeId as Uuid,
        tenantId:             tenantId as Uuid,
        enrolmentId:          input.enrolmentId as Uuid,
        sourceCaseId:         input.sourceCaseId ? (input.sourceCaseId as Uuid) : null,
        sourceDecisionId:     input.sourceDecisionId ? (input.sourceDecisionId as Uuid) : null,
        outcomeTypeCode:      input.outcomeTypeCode,
        minimumNecessaryText: input.minimumNecessaryText,
        visibilityScopeCode:  input.visibilityScopeCode,
        actorId,
        validFrom:            now,
        validTo:              null,
        recordedAt:           now,
        recordedUntil:        null,
      });
    });

    return outcomeId;
  }

  /** Creates a distribution_item per target and returns the created item IDs. */
  async distributeToTargets(tenantId: string, sourceOutcomeId: string, targetSystemCodes: string[]): Promise<string[]> {
    const outcome = await this.getCurrentOutcome(sourceOutcomeId, tenantId);
    if (!outcome) throw new NotFoundError('SupportOutcome', sourceOutcomeId);

    const itemIds: string[] = [];
    for (const targetSystemCode of targetSystemCodes) {
      const itemId = await this.businessCases.createDistributionItem(tenantId, {
        ...(outcome.sourceDecisionId ? { sourceDecisionId: outcome.sourceDecisionId } : {}),
        targetSystemCode,
        contentRef: sourceOutcomeId,
      });
      itemIds.push(itemId);
    }
    return itemIds;
  }

  async getCurrentOutcome(supportOutcomeId: string, tenantId: string): Promise<SupportOutcomeDto | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(supportOutcomes).where(and(
        eq(supportOutcomes.id,       supportOutcomeId as Uuid),
        eq(supportOutcomes.tenantId, tenantId          as Uuid),
        isNull(supportOutcomes.recordedUntil),
      )).limit(1),
    );
    return rows[0] ? outcomeToDto(rows[0]) : null;
  }

  async listOutcomesForEnrolment(enrolmentId: string, tenantId: string): Promise<SupportOutcomeDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(supportOutcomes).where(and(
        eq(supportOutcomes.enrolmentId, enrolmentId as Uuid),
        eq(supportOutcomes.tenantId,    tenantId     as Uuid),
        isNull(supportOutcomes.recordedUntil),
      )).orderBy(desc(supportOutcomes.recordedAt)),
    );
    return rows.map(outcomeToDto);
  }
}

function outcomeToDto(row: typeof supportOutcomes.$inferSelect): SupportOutcomeDto {
  return {
    supportOutcomeId:     row.id,
    enrolmentId:          row.enrolmentId,
    sourceCaseId:         row.sourceCaseId,
    sourceDecisionId:     row.sourceDecisionId,
    outcomeTypeCode:      row.outcomeTypeCode,
    minimumNecessaryText: row.minimumNecessaryText,
    visibilityScopeCode:  row.visibilityScopeCode,
    actorId:              row.actorId,
    validFrom:            row.validFrom,
    validTo:              row.validTo,
    recordedAt:           row.recordedAt,
    recordedUntil:        row.recordedUntil,
  };
}
