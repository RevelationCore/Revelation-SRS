import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  deliveryFlowConfigs,
  deliveryItems,
  persons,
  personIdentities,
  tenants,
  type Db,
  type DeliveryItem,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, EVENT_TYPES, NotFoundError, ValidationError } from '@revelation-srs/domain';
import type { DeliveryRequestedV1Payload } from '@revelation-srs/domain';

import type { FulfilmentMode } from '../adjustments/target-config.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

import { DELIVERY_FLOWS, findFlow, flowSubjectToken, type DeliveryFlow } from './flows.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type DeliveryReplyActor = 'connector' | 'person';

export interface RequestDeliveryInput {
  flowCode:       string;
  subjectType:    string;
  subjectId:      string;
  personId?:      string;
  /** Identifies the change carried; repeating it records nothing new. */
  idempotencyKey: string;
  payload:        Record<string, unknown>;
  /** One line for the task queue. */
  summary:        string;
}

export interface FlowConfigDto {
  flowCode:            string;
  targetSystem:        string;
  targetLabel:         string;
  name:                string;
  producer:            DeliveryFlow['producer'];
  producerNote:        string;
  fulfilmentModeCode:  FulfilmentMode;
  ownerDescription:    string | null;
  alertAfterHours:     number;
  notifyEmail:         string | null;
  lastOverdueNoticeAt: Date | null;
  isDefault:           boolean;
}

export interface DeliveryItemDto {
  deliveryItemId:     string;
  flowCode:           string;
  targetSystem:       string;
  subjectType:        string;
  subjectId:          string;
  personId:           string | null;
  payload:            Record<string, unknown>;
  summary:            string;
  fulfilmentModeCode: string;
  statusCode:         string;
  failureReason:      string | null;
  requestPublishedAt: Date | null;
  deliveredAt:        Date | null;
  createdAt:          Date;
}

export interface DeliveryTaskDto extends DeliveryItemDto {
  flowName:         string;
  targetLabel:      string;
  studentNumber:    string | null;
  studentName:      string | null;
  ownerDescription: string | null;
  overdue:          boolean;
}

/**
 * The platform delivery ledger: outbound reference-model flows to adjacent
 * systems, each fulfilled per tenant as connected (event + replies), manual
 * (staff task queue), file (export) or not-used. The same pattern as the
 * adjustment distribution ledger, without its withdrawal lifecycle: these
 * flows carry state changes, and a later change supersedes an undelivered
 * earlier one for state-sync flows.
 */
export class DeliveryService {
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
    private readonly onError: (err: unknown, context: Record<string, unknown>) => void = () => undefined,
  ) {}

  /**
   * Record a change for a flow. Returns the item, or null when the tenant
   * does not use the flow. Safe to repeat with the same idempotency key.
   * Never throws for delivery problems: a connected item that cannot be
   * published now is published by the reconcile loop.
   */
  async request(tenantId: string, input: RequestDeliveryInput): Promise<DeliveryItemDto | null> {
    const flow = findFlow(input.flowCode);
    if (!flow) throw new ValidationError(`Unknown delivery flow '${input.flowCode}'`);

    const item = await withTenantContext(this.db, tenantId, async (tx) => {
      const mode = (await this.#configsIn(tx, tenantId)).get(flow.flowCode)?.fulfilmentModeCode as FulfilmentMode | undefined
        ?? flow.defaultMode;
      if (mode === 'not-used') return null;

      const now = clockNow();
      const inserted = await tx.insert(deliveryItems).values({
        tenantId: tenantId as Uuid,
        flowCode: flow.flowCode,
        targetSystem: flow.targetSystem,
        subjectType: input.subjectType,
        subjectId: input.subjectId as Uuid,
        personId: (input.personId ?? null) as Uuid | null,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        summary: input.summary,
        fulfilmentModeCode: mode,
        statusCode: 'pending',
        requestPublishedAt: mode === 'connected' ? null : now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing().returning();
      const row = inserted[0];
      if (!row) {
        const [existing] = await tx.select().from(deliveryItems).where(and(
          eq(deliveryItems.tenantId, tenantId as Uuid),
          eq(deliveryItems.flowCode, flow.flowCode),
          eq(deliveryItems.idempotencyKey, input.idempotencyKey),
        ));
        return existing ?? null;
      }

      if (flow.stateSync) {
        // The target needs the latest state, not every intermediate one.
        await tx.update(deliveryItems)
          .set({ statusCode: 'superseded', updatedAt: now })
          .where(and(
            eq(deliveryItems.tenantId, tenantId as Uuid),
            eq(deliveryItems.flowCode, flow.flowCode),
            eq(deliveryItems.subjectId, input.subjectId as Uuid),
            ne(deliveryItems.id, row.id),
            inArray(deliveryItems.statusCode, ['pending', 'failed']),
          ));
      }
      return row;
    });

    if (item?.fulfilmentModeCode === 'connected') await this.dispatchTenant(tenantId);
    return item ? toDto(item) : null;
  }

  async listItems(tenantId: string, opts: { flowCode?: string; subjectId?: string } = {}): Promise<DeliveryItemDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(deliveryItems).where(and(
        eq(deliveryItems.tenantId, tenantId as Uuid),
        ...(opts.flowCode ? [eq(deliveryItems.flowCode, opts.flowCode)] : []),
        ...(opts.subjectId ? [eq(deliveryItems.subjectId, opts.subjectId as Uuid)] : []),
      )).orderBy(deliveryItems.createdAt),
    );
    return rows.map(toDto);
  }

  /** Open manual items, oldest first, with who and whether overdue. */
  async listTasks(tenantId: string, opts: { flowCode?: string; now?: Date } = {}): Promise<DeliveryTaskDto[]> {
    const now = opts.now ?? clockNow();
    const configs = await this.listFlows(tenantId);
    const rows = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select({
        item: deliveryItems,
        studentNumber: persons.studentNumber,
        preferredName: personIdentities.preferredName,
        legalFirstName: personIdentities.legalFirstName,
        familyName: personIdentities.legalFamilyName,
      })
        .from(deliveryItems)
        .leftJoin(persons, and(eq(persons.id, deliveryItems.personId), eq(persons.tenantId, deliveryItems.tenantId)))
        .leftJoin(personIdentities, and(
          eq(personIdentities.personId, deliveryItems.personId),
          eq(personIdentities.tenantId, deliveryItems.tenantId),
          isNull(personIdentities.recordedUntil),
        ))
        .where(and(
          eq(deliveryItems.tenantId, tenantId as Uuid),
          eq(deliveryItems.fulfilmentModeCode, 'manual'),
          inArray(deliveryItems.statusCode, ['pending', 'failed']),
          ...(opts.flowCode ? [eq(deliveryItems.flowCode, opts.flowCode)] : []),
        ))
        .orderBy(deliveryItems.createdAt),
    );
    const seen = new Set<string>();
    const tasks: DeliveryTaskDto[] = [];
    for (const r of rows) {
      if (seen.has(r.item.id)) continue;
      seen.add(r.item.id);
      const config = configs.find((c) => c.flowCode === r.item.flowCode);
      tasks.push({
        ...toDto(r.item),
        flowName: config?.name ?? r.item.flowCode,
        targetLabel: config?.targetLabel ?? r.item.targetSystem,
        studentNumber: r.studentNumber,
        studentName: r.familyName ? `${r.preferredName ?? r.legalFirstName ?? ''} ${r.familyName}`.trim() : null,
        ownerDescription: config?.ownerDescription ?? null,
        overdue: now.getTime() - r.item.createdAt.getTime() > (config?.alertAfterHours ?? 72) * 3_600_000,
      });
    }
    return tasks;
  }

  async acknowledge(tenantId: string, itemId: string, actor: DeliveryReplyActor): Promise<void> {
    const item = await this.#get(tenantId, itemId);
    assertActor(item, actor);
    if (item.statusCode === 'delivered') return;
    if (item.statusCode === 'superseded') {
      throw new ConflictError('A later change for this record replaced this item; apply that one instead');
    }
    const now = clockNow();
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.update(deliveryItems)
        .set({ statusCode: 'delivered', deliveredAt: now, failureReason: null, updatedAt: now })
        .where(and(eq(deliveryItems.id, itemId as Uuid), inArray(deliveryItems.statusCode, ['pending', 'failed']))),
    );
  }

  /**
   * The SRS itself records that a flow's item was fulfilled — e.g. an
   * identity check completed through its own endpoint answers the OIV
   * request. Marks open items for the subject delivered; never throws.
   */
  async completeForSubject(tenantId: string, flowCode: string, subjectId: string): Promise<void> {
    const now = clockNow();
    try {
      await withTenantContext(this.db, tenantId, (tx) =>
        tx.update(deliveryItems)
          .set({ statusCode: 'delivered', deliveredAt: now, failureReason: null, updatedAt: now })
          .where(and(
            eq(deliveryItems.tenantId, tenantId as Uuid),
            eq(deliveryItems.flowCode, flowCode),
            eq(deliveryItems.subjectId, subjectId as Uuid),
            inArray(deliveryItems.statusCode, ['pending', 'failed']),
          )),
      );
    } catch (err) {
      this.onError(err, { tenantId, flowCode, subjectId, stage: 'complete-for-subject' });
    }
  }

  async reportFailure(tenantId: string, itemId: string, reason: string, actor: DeliveryReplyActor): Promise<void> {
    const item = await this.#get(tenantId, itemId);
    assertActor(item, actor);
    if (item.statusCode !== 'pending' && item.statusCode !== 'failed') {
      throw new ConflictError(`This item is ${item.statusCode} and needs no further action`);
    }
    const now = clockNow();
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.update(deliveryItems)
        .set({ statusCode: 'failed', failureReason: reason, updatedAt: now })
        .where(and(eq(deliveryItems.id, itemId as Uuid), inArray(deliveryItems.statusCode, ['pending', 'failed']))),
    );
  }

  // ── Flow settings ──────────────────────────────────────────────────────────

  async listFlows(tenantId: string): Promise<FlowConfigDto[]> {
    const configs = await withTenantContext(this.db, tenantId, (tx) => this.#configsIn(tx, tenantId));
    return DELIVERY_FLOWS.map((flow) => flowDto(flow, configs.get(flow.flowCode)));
  }

  async setFlow(
    tenantId: string,
    flowCode: string,
    input: { fulfilmentModeCode: string; ownerDescription?: string | null; alertAfterHours?: number; notifyEmail?: string | null },
    actorId: string,
  ): Promise<FlowConfigDto> {
    const flow = findFlow(flowCode);
    if (!flow) throw new NotFoundError('DeliveryFlow', flowCode);
    const valid = await this.valueSets.validateFieldValue('delivery_flow_config', 'fulfilment_mode_code', input.fulfilmentModeCode, tenantId);
    if (valid === false) {
      throw new ValidationError(`Invalid value '${input.fulfilmentModeCode}' for delivery_flow_config.fulfilment_mode_code`, [
        { field: 'fulfilmentModeCode', message: 'Value is not active in the configured value set' },
      ]);
    }
    const notifyEmail = input.notifyEmail?.trim() || null;
    if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
      throw new ValidationError('notifyEmail must be an email address', [{ field: 'notifyEmail', message: 'Must be an email address' }]);
    }
    const now = clockNow();
    const values = {
      tenantId: tenantId as Uuid,
      flowCode,
      fulfilmentModeCode: input.fulfilmentModeCode,
      ownerDescription: input.ownerDescription ?? null,
      alertAfterHours: input.alertAfterHours ?? 72,
      notifyEmail,
      updatedAt: now,
      updatedBy: actorId,
    };
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.insert(deliveryFlowConfigs).values(values).onConflictDoUpdate({
        target: [deliveryFlowConfigs.tenantId, deliveryFlowConfigs.flowCode],
        set: {
          fulfilmentModeCode: values.fulfilmentModeCode,
          ownerDescription: values.ownerDescription,
          alertAfterHours: values.alertAfterHours,
          notifyEmail: values.notifyEmail,
          updatedAt: now,
          updatedBy: actorId,
        },
      }),
    );
    return (await this.listFlows(tenantId)).find((f) => f.flowCode === flowCode)!;
  }

  async markOverdueNoticeSent(tenantId: string, flowCode: string, at: Date): Promise<void> {
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.update(deliveryFlowConfigs).set({ lastOverdueNoticeAt: at })
        .where(and(eq(deliveryFlowConfigs.tenantId, tenantId as Uuid), eq(deliveryFlowConfigs.flowCode, flowCode))),
    );
  }

  // ── Outbox ─────────────────────────────────────────────────────────────────

  /**
   * Publish connected items not yet published, with each item's fixed event
   * id. Rows are claimed FOR UPDATE SKIP LOCKED until stamped, so concurrent
   * dispatchers never both publish one. Never throws.
   */
  async dispatchTenant(tenantId: string): Promise<number> {
    if (!this.eventBus.isConnected()) return 0;
    try {
      return await withTenantContext(this.db, tenantId, async (tx) => {
        const due = await tx.select().from(deliveryItems).where(and(
          eq(deliveryItems.tenantId, tenantId as Uuid),
          eq(deliveryItems.fulfilmentModeCode, 'connected'),
          eq(deliveryItems.statusCode, 'pending'),
          isNull(deliveryItems.requestPublishedAt),
        )).orderBy(deliveryItems.createdAt).limit(100).for('update', { skipLocked: true });

        let published = 0;
        for (const item of due) {
          const payload: DeliveryRequestedV1Payload = {
            deliveryItemId: item.id,
            flowCode: item.flowCode,
            targetSystem: item.targetSystem,
            subjectType: item.subjectType,
            subjectId: item.subjectId,
            ...(item.personId ? { personId: item.personId } : {}),
            payload: item.payload,
            requestedAt: item.createdAt.toISOString(),
          };
          try {
            await this.eventBus.publish(EVENT_TYPES.DELIVERY_REQUESTED, '1.0.0', tenantId, item.id, 'personal', payload, {
              eventId: item.requestEventId,
              occurredAt: item.createdAt,
              subjectSuffix: flowSubjectToken(item.flowCode),
            });
          } catch (err) {
            this.onError(err, { tenantId, deliveryItemId: item.id, stage: 'publish-delivery-requested' });
            break;
          }
          const now = clockNow();
          await tx.update(deliveryItems).set({ requestPublishedAt: now, updatedAt: now }).where(eq(deliveryItems.id, item.id));
          published += 1;
        }
        return published;
      });
    } catch (err) {
      this.onError(err, { tenantId, stage: 'delivery-dispatch' });
      return 0;
    }
  }

  async drain(): Promise<number> {
    if (!this.eventBus.isConnected()) return 0;
    let total = 0;
    for (const { id } of await this.db.select({ id: tenants.id }).from(tenants)) total += await this.dispatchTenant(id);
    return total;
  }

  async #get(tenantId: string, itemId: string): Promise<DeliveryItem> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) =>
      tx.select().from(deliveryItems).where(and(eq(deliveryItems.id, itemId as Uuid), eq(deliveryItems.tenantId, tenantId as Uuid))),
    );
    if (!row) throw new NotFoundError('DeliveryItem', itemId);
    return row;
  }

  async #configsIn(tx: Tx, tenantId: string) {
    const rows = await tx.select().from(deliveryFlowConfigs).where(eq(deliveryFlowConfigs.tenantId, tenantId as Uuid));
    return new Map(rows.map((r) => [r.flowCode, r]));
  }
}

function assertActor(item: DeliveryItem, actor: DeliveryReplyActor): void {
  if (actor === 'person' && item.fulfilmentModeCode !== 'manual') {
    throw new ConflictError(`This item is fulfilled by a ${item.fulfilmentModeCode} target; only its integration can reply`);
  }
}

function toDto(row: DeliveryItem): DeliveryItemDto {
  return {
    deliveryItemId: row.id,
    flowCode: row.flowCode,
    targetSystem: row.targetSystem,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    personId: row.personId,
    payload: row.payload,
    summary: row.summary,
    fulfilmentModeCode: row.fulfilmentModeCode,
    statusCode: row.statusCode,
    failureReason: row.failureReason,
    requestPublishedAt: row.requestPublishedAt,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
  };
}

function flowDto(flow: DeliveryFlow, row: typeof deliveryFlowConfigs.$inferSelect | undefined): FlowConfigDto {
  return {
    flowCode: flow.flowCode,
    targetSystem: flow.targetSystem,
    targetLabel: flow.targetLabel,
    name: flow.name,
    producer: flow.producer,
    producerNote: flow.producerNote,
    fulfilmentModeCode: (row?.fulfilmentModeCode as FulfilmentMode | undefined) ?? flow.defaultMode,
    ownerDescription: row?.ownerDescription ?? null,
    alertAfterHours: row?.alertAfterHours ?? 72,
    notifyEmail: row?.notifyEmail ?? null,
    lastOverdueNoticeAt: row?.lastOverdueNoticeAt ?? null,
    isDefault: !row,
  };
}
