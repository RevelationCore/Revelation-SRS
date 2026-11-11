import {
  tenants,
  workflowCommands,
  workflowInstances,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { ReviewExecutionService } from './review-execution-service.js';
import type { WorkflowEventOutbox } from './workflow-event-outbox.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface ReconcileResult {
  startsRetried: number;
  commandsRedelivered: number;
  eventsPublished: number;
}

export interface WorkflowHealthSummary {
  startingInstances: number;
  needsAttentionInstances: number;
  pendingCommands: number;
  failedCommands: number;
  unpublishedEvents: number;
  oldestPendingCommandSeconds: number | null;
}

/**
 * Repairs the gaps between the database and Temporal. Safe to run on
 * several processes at once: starts are idempotent by workflow ID, the
 * workflow ignores a command it has already seen, and every effect is
 * applied under a receipt.
 *
 * - Reviews saved but not yet started on Temporal are started.
 * - Commands saved but not confirmed are delivered again by Signal.
 * - Workflow events not yet published are published.
 *
 * It never applies a business change itself, starts a fresh workflow for a
 * closed one, or re-sends anything to an external system.
 */
export class WorkflowReconciler {
  constructor(
    private readonly db: Db,
    private readonly reviews: ReviewExecutionService,
    private readonly outbox: WorkflowEventOutbox,
    private readonly options: { graceSeconds: number; batchSize: number } = { graceSeconds: 15, batchSize: 50 },
  ) {}

  async runOnce(): Promise<ReconcileResult> {
    const result: ReconcileResult = { startsRetried: 0, commandsRedelivered: 0, eventsPublished: 0 };
    const tenantRows = await this.db.select({ id: tenants.id }).from(tenants);
    for (const { id: tenantId } of tenantRows) {
      if (this.reviews.isAvailable) {
        result.startsRetried += await this.#retryStarts(tenantId);
        result.commandsRedelivered += await this.#redeliverCommands(tenantId);
      }
    }
    result.eventsPublished = await this.outbox.drain();
    return result;
  }

  async health(tenantId: string): Promise<WorkflowHealthSummary> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const instanceCounts = await tx.select({
        status: workflowInstances.executionStatus,
        n: sql<number>`count(*)::int`,
      }).from(workflowInstances).where(and(
        eq(workflowInstances.tenantId, tenantId as Uuid),
        inArray(workflowInstances.executionStatus, ['starting', 'needs-attention']),
      )).groupBy(workflowInstances.executionStatus);
      const commandCounts = await tx.select({
        state: workflowCommands.deliveryState,
        n: sql<number>`count(*)::int`,
        oldest: sql<number | null>`extract(epoch from (now() - min(${workflowCommands.acceptedAt})))::int`,
      }).from(workflowCommands).where(and(
        eq(workflowCommands.tenantId, tenantId as Uuid),
        inArray(workflowCommands.deliveryState, ['pending', 'delivered', 'failed']),
      )).groupBy(workflowCommands.deliveryState);
      const count = <T extends { n: number }>(rows: T[], pick: (r: T) => boolean) =>
        rows.filter(pick).reduce((sum, r) => sum + r.n, 0);
      const pendingRows = commandCounts.filter((r) => r.state === 'pending' || r.state === 'delivered');
      return {
        startingInstances: count(instanceCounts, (r) => r.status === 'starting'),
        needsAttentionInstances: count(instanceCounts, (r) => r.status === 'needs-attention'),
        pendingCommands: count(pendingRows, () => true),
        failedCommands: count(commandCounts, (r) => r.state === 'failed'),
        unpublishedEvents: await this.outbox.countUnpublished(tenantId),
        oldestPendingCommandSeconds: pendingRows.length
          ? Math.max(...pendingRows.map((r) => r.oldest ?? 0))
          : null,
      };
    });
  }

  async #retryStarts(tenantId: string): Promise<number> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: workflowInstances.id }).from(workflowInstances).where(and(
        eq(workflowInstances.tenantId, tenantId as Uuid),
        eq(workflowInstances.executionBackend, 'temporal'),
        eq(workflowInstances.executionStatus, 'starting'),
        lte(workflowInstances.createdAt, sql`now() - make_interval(secs => ${this.options.graceSeconds})`),
      )).orderBy(asc(workflowInstances.createdAt)).limit(this.options.batchSize),
    );
    let started = 0;
    for (const { id } of rows) {
      if ((await this.reviews.ensureStarted(tenantId, id)) !== 'starting') started += 1;
    }
    return started;
  }

  async #redeliverCommands(tenantId: string): Promise<number> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: workflowCommands.id }).from(workflowCommands).where(and(
        eq(workflowCommands.tenantId, tenantId as Uuid),
        eq(workflowCommands.deliveryState, 'pending'),
        lte(workflowCommands.nextDeliveryAt, sql`now()`),
        lte(workflowCommands.acceptedAt, sql`now() - make_interval(secs => ${this.options.graceSeconds})`),
      )).orderBy(asc(workflowCommands.acceptedAt)).limit(this.options.batchSize),
    );
    let delivered = 0;
    for (const { id } of rows) {
      if (await this.reviews.redeliver(tenantId, id)) delivered += 1;
    }
    return delivered;
  }
}
