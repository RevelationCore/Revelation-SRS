import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  adjustmentDistributions,
  reasonableAdjustments,
  tenants,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { EVENT_TYPES } from '@revelation-srs/domain';
import type {
  AdjustmentDistributionRequestedV1Payload,
  AdjustmentDistributionWithdrawalRequestedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import { clockNow } from '../clock.js';

import { amountFromRow } from './amount.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface DispatchResult {
  requestsPublished:    number;
  withdrawalsPublished: number;
}

const BATCH_SIZE = 100;

/**
 * Publishes the per-target adjustment instructions recorded in
 * adjustment_distribution, which doubles as their outbox. Only 'connected'
 * targets are published; manual targets are tasks in the staff queue and
 * file targets are delivered by the SRS's own exchange.
 *
 *   pending + request_published_at null           -> distribution-requested.<target>
 *   withdrawal-requested + withdrawal_published_at null -> distribution-withdrawal-requested.<target>
 *
 * Called straight after an adjustment is recorded or expired, and periodically
 * by the worker's reconcile loop, so an instruction lost because the bus was
 * down (or the process stopped between commit and publish) is sent later.
 *
 * Rows are claimed with FOR UPDATE SKIP LOCKED and stay locked until their
 * published_at is stamped. Concurrent dispatchers therefore never both publish
 * a row, and expireAdjustment, which locks the same rows first, waits and
 * then sees whether the request went out (withdraw it) or not (supersede it).
 * Each row's event id is fixed, so a republish after a crash between publish
 * and commit is absorbed by JetStream's duplicate window and by consumers'
 * distributionId checks.
 */
export class AdjustmentDistributionDispatcher {
  constructor(
    private readonly db:       Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly onError:  (err: unknown, context: Record<string, unknown>) => void = () => undefined,
  ) {}

  /** Publish everything due for one tenant. Never throws: failures stay due. */
  async dispatchTenant(tenantId: string): Promise<DispatchResult> {
    const result: DispatchResult = { requestsPublished: 0, withdrawalsPublished: 0 };
    if (!this.eventBus.isConnected()) return result;

    try {
      result.requestsPublished = await this.#publishRequests(tenantId);
      result.withdrawalsPublished = await this.#publishWithdrawals(tenantId);
    } catch (err) {
      this.onError(err, { tenantId, stage: 'adjustment-distribution-dispatch' });
    }
    return result;
  }

  /** Reconcile-loop entry point: every tenant. */
  async drain(): Promise<DispatchResult> {
    const total: DispatchResult = { requestsPublished: 0, withdrawalsPublished: 0 };
    if (!this.eventBus.isConnected()) return total;
    const tenantRows = await this.db.select({ id: tenants.id }).from(tenants);
    for (const { id } of tenantRows) {
      const r = await this.dispatchTenant(id);
      total.requestsPublished += r.requestsPublished;
      total.withdrawalsPublished += r.withdrawalsPublished;
    }
    return total;
  }

  async tenantIds(): Promise<string[]> {
    return (await this.db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
  }

  async countUndispatched(tenantId: string): Promise<{ requests: number; withdrawals: number }> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({
          requests: sql<number>`count(*) filter (where ${adjustmentDistributions.fulfilmentModeCode} = 'connected' and ${adjustmentDistributions.statusCode} = 'pending' and ${adjustmentDistributions.requestPublishedAt} is null)`.mapWith(Number),
          withdrawals: sql<number>`count(*) filter (where ${adjustmentDistributions.fulfilmentModeCode} = 'connected' and ${adjustmentDistributions.statusCode} = 'withdrawal-requested' and ${adjustmentDistributions.withdrawalPublishedAt} is null)`.mapWith(Number),
        })
        .from(adjustmentDistributions)
        .where(eq(adjustmentDistributions.tenantId, tenantId as Uuid));
      return { requests: row?.requests ?? 0, withdrawals: row?.withdrawals ?? 0 };
    });
  }

  async #publishRequests(tenantId: string): Promise<number> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const due = await tx
        .select({ distribution: adjustmentDistributions, adjustment: reasonableAdjustments })
        .from(adjustmentDistributions)
        .innerJoin(reasonableAdjustments, and(
          eq(reasonableAdjustments.id, adjustmentDistributions.adjustmentId),
          eq(reasonableAdjustments.tenantId, adjustmentDistributions.tenantId),
          isNull(reasonableAdjustments.recordedUntil),
        ))
        .where(and(
          eq(adjustmentDistributions.tenantId, tenantId as Uuid),
          eq(adjustmentDistributions.fulfilmentModeCode, 'connected'),
          eq(adjustmentDistributions.statusCode, 'pending'),
          isNull(adjustmentDistributions.requestPublishedAt),
        ))
        .orderBy(adjustmentDistributions.createdAt)
        .limit(BATCH_SIZE)
        .for('update', { of: adjustmentDistributions, skipLocked: true });

      let published = 0;
      for (const { distribution: d, adjustment: a } of due) {
        const now = clockNow();
        const amount = amountFromRow(a);
        const payload: AdjustmentDistributionRequestedV1Payload = {
          distributionId:     d.id,
          adjustmentId:       a.id,
          targetSystem:       d.targetSystem,
          personId:           a.personId,
          enrolmentId:        a.enrolmentId,
          adjustmentTypeCode: a.adjustmentTypeCode,
          scopeCode:          a.scopeCode,
          ...(amount ? { amount } : {}),
          validFrom:          a.validFrom.toISOString(),
          ...(a.validTo ? { validTo: a.validTo.toISOString() } : {}),
          requestedAt:        d.createdAt.toISOString(),
        };
        try {
          await this.eventBus.publish(
            EVENT_TYPES.ADJUSTMENT_DISTRIBUTION_REQUESTED,
            '1.0.0',
            tenantId,
            a.id,
            'sensitive',
            payload,
            {
              eventId:       d.requestEventId,
              occurredAt:    d.createdAt,
              validAt:       a.validFrom,
              subjectSuffix: d.targetSystem,
            },
          );
        } catch (err) {
          // Keep what was published so far; the rest stays due.
          this.onError(err, { tenantId, distributionId: d.id, stage: 'publish-distribution-requested' });
          break;
        }
        await tx
          .update(adjustmentDistributions)
          .set({ requestPublishedAt: now, updatedAt: now })
          .where(eq(adjustmentDistributions.id, d.id));
        published += 1;
      }
      return published;
    });
  }

  async #publishWithdrawals(tenantId: string): Promise<number> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const due = await tx
        .select({ distribution: adjustmentDistributions, adjustment: reasonableAdjustments })
        .from(adjustmentDistributions)
        .innerJoin(reasonableAdjustments, and(
          eq(reasonableAdjustments.id, adjustmentDistributions.adjustmentId),
          eq(reasonableAdjustments.tenantId, adjustmentDistributions.tenantId),
          isNull(reasonableAdjustments.recordedUntil),
        ))
        .where(and(
          eq(adjustmentDistributions.tenantId, tenantId as Uuid),
          eq(adjustmentDistributions.fulfilmentModeCode, 'connected'),
          eq(adjustmentDistributions.statusCode, 'withdrawal-requested'),
          isNull(adjustmentDistributions.withdrawalPublishedAt),
          isNotNull(adjustmentDistributions.withdrawalEventId),
        ))
        .orderBy(adjustmentDistributions.withdrawalRequestedAt)
        .limit(BATCH_SIZE)
        .for('update', { of: adjustmentDistributions, skipLocked: true });

      let published = 0;
      for (const { distribution: d, adjustment: a } of due) {
        const now = clockNow();
        const requestedAt = d.withdrawalRequestedAt ?? now;
        const payload: AdjustmentDistributionWithdrawalRequestedV1Payload = {
          distributionId: d.id,
          adjustmentId:   a.id,
          targetSystem:   d.targetSystem,
          personId:       a.personId,
          enrolmentId:    a.enrolmentId,
          endedAt:        (a.validTo ?? requestedAt).toISOString(),
          reasonCode:     'expired',
          requestedAt:    requestedAt.toISOString(),
        };
        try {
          await this.eventBus.publish(
            EVENT_TYPES.ADJUSTMENT_DISTRIBUTION_WITHDRAWAL_REQUESTED,
            '1.0.0',
            tenantId,
            a.id,
            'sensitive',
            payload,
            {
              eventId:       d.withdrawalEventId!,
              occurredAt:    requestedAt,
              subjectSuffix: d.targetSystem,
            },
          );
        } catch (err) {
          this.onError(err, { tenantId, distributionId: d.id, stage: 'publish-distribution-withdrawal-requested' });
          break;
        }
        await tx
          .update(adjustmentDistributions)
          .set({ withdrawalPublishedAt: now, updatedAt: now })
          .where(eq(adjustmentDistributions.id, d.id));
        published += 1;
      }
      return published;
    });
  }
}
