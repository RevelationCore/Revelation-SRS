import {
  tenants,
  workflowEventOutbox,
  type Db,
  type TenantScopedDb,
  withTenantContext,
} from '@revelation-srs/db';
import type { DataClassification } from '@revelation-srs/domain';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface WorkflowEventInput {
  tenantId: string;
  eventType: string;
  eventVersion?: string;
  correlationId: string;
  dataClassification?: DataClassification;
  payload: Record<string, unknown>;
}

/**
 * Save a workflow event in the caller's transaction. It becomes eligible for
 * publication only if that transaction commits. The row ID is the event's
 * stable ID, so consumers can de-duplicate redelivery.
 */
export async function enqueueWorkflowEvent(tx: TenantScopedDb, input: WorkflowEventInput): Promise<string> {
  const rows = await tx.insert(workflowEventOutbox).values({
    tenantId: input.tenantId as Uuid,
    eventType: input.eventType,
    eventVersion: input.eventVersion ?? '1.0.0',
    correlationId: input.correlationId,
    dataClassification: input.dataClassification ?? 'standard',
    payload: input.payload,
  }).returning({ id: workflowEventOutbox.id });
  return rows[0]!.id;
}

const MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * Publishes saved workflow events to NATS.
 *
 * `publishNow` is called straight after a commit so events normally go out
 * immediately. Anything it cannot publish (NATS down, process crash) stays
 * unpublished until `drain` picks it up. Delivery is at-least-once.
 */
export class WorkflowEventOutbox {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
  ) {}

  async publishNow(tenantId: string, eventIds: string[]): Promise<void> {
    if (eventIds.length === 0 || !this.eventBus.isConnected()) return;
    try {
      await this.#publishBatch(tenantId, eventIds);
    } catch {
      // Left for drain(); the state change has already committed.
    }
  }

  /** Publish due events for every tenant. Returns the number published. */
  async drain(limitPerTenant = 100): Promise<number> {
    if (!this.eventBus.isConnected()) return 0;
    const tenantRows = await this.db.select({ id: tenants.id }).from(tenants);
    let published = 0;
    for (const { id } of tenantRows) {
      published += await this.#drainTenant(id, limitPerTenant);
    }
    return published;
  }

  async countUnpublished(tenantId: string): Promise<number> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(workflowEventOutbox)
        .where(and(eq(workflowEventOutbox.tenantId, tenantId as Uuid), isNull(workflowEventOutbox.publishedAt))),
    );
    return rows[0]?.n ?? 0;
  }

  async #drainTenant(tenantId: string, limit: number): Promise<number> {
    const due = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: workflowEventOutbox.id }).from(workflowEventOutbox)
        .where(and(
          eq(workflowEventOutbox.tenantId, tenantId as Uuid),
          isNull(workflowEventOutbox.publishedAt),
          lte(workflowEventOutbox.nextAttemptAt, sql`now()`),
        ))
        .orderBy(asc(workflowEventOutbox.createdAt))
        .limit(limit),
    );
    if (due.length === 0) return 0;
    return this.#publishBatch(tenantId, due.map((r) => r.id));
  }

  /**
   * Claims rows with SKIP LOCKED so two relays do not publish the same row
   * at the same moment, publishes them in creation order, and records the
   * result. A failure stops the batch so later events are not published
   * ahead of an earlier one.
   */
  async #publishBatch(tenantId: string, eventIds: string[]): Promise<number> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(workflowEventOutbox)
        .where(and(
          eq(workflowEventOutbox.tenantId, tenantId as Uuid),
          inArray(workflowEventOutbox.id, eventIds as Uuid[]),
          isNull(workflowEventOutbox.publishedAt),
        ))
        .orderBy(asc(workflowEventOutbox.createdAt))
        .for('update', { skipLocked: true });

      let published = 0;
      for (const row of rows) {
        try {
          await this.eventBus.publish(
            row.eventType,
            row.eventVersion,
            row.tenantId,
            row.correlationId,
            row.dataClassification as DataClassification,
            row.payload,
            { eventId: row.id, occurredAt: row.createdAt },
          );
          await tx.update(workflowEventOutbox)
            .set({ publishedAt: sql`now()`, publishAttempts: row.publishAttempts + 1, lastError: null })
            .where(eq(workflowEventOutbox.id, row.id));
          published += 1;
        } catch (error) {
          const attempts = row.publishAttempts + 1;
          const backoffMs = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempts, 16));
          await tx.update(workflowEventOutbox)
            .set({
              publishAttempts: attempts,
              lastError: error instanceof Error ? error.message.slice(0, 500) : 'publish failed',
              nextAttemptAt: sql`now() + make_interval(secs => ${backoffMs / 1000})`,
            })
            .where(eq(workflowEventOutbox.id, row.id));
          break;
        }
      }
      return published;
    });
  }
}
