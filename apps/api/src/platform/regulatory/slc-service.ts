import { createHash } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  enrolmentDownstreamTriggers,
  enrolments,
  feeLiabilities,
  integrationExchanges,
  slcNotifications,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type RegulatorySlcConfirmationSentV1Payload,
  type RegulatorySlcNotificationReceivedV1Payload,
} from '@revelation-srs/domain';

import type { EnrolmentService } from '../enrolment/service.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import type { ValueSetService } from '../value-sets/service.js';

import { RegulatoryExchangeService } from './exchange-service.js';

export interface SlcConfirmationRecord {
  triggerId: string;
  enrolmentId: string;
  slcReference: string;
  programmeId: string | null;
  modeOfStudyCode: string;
  confirmationType: 'enrolment' | 'withdrawal' | 'intermission';
  feeAmount: string | null;
  startDate: string;
  expectedEndDate: string | null;
}

export interface SlcConfirmationPayload {
  confirmations: SlcConfirmationRecord[];
}

export interface SlcNotificationInput {
  enrolmentId: string;
  notificationTypeCode: string;
  effectiveDate: string;
  amount?: string | number | null;
  rawPayload?: Record<string, unknown>;
  idempotencyKey?: string;
  notificationId?: string;
}

export interface SlcNotificationDto {
  notificationId: string;
  enrolmentId: string;
  notificationTypeCode: string;
  effectiveDate: string;
  amount: string | null;
  receivedAt: Date;
}

export interface SlcExchangeStatusDto {
  exchangeId: string;
  directionCode: string;
  exchangeTypeCode: string;
  idempotencyKey: string;
  statusCode: string;
  sentAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}

export class SlcService {
  private readonly exchanges: RegulatoryExchangeService;

  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    private readonly valueSets: ValueSetService,
    private readonly enrolmentService: EnrolmentService,
    exchanges?: RegulatoryExchangeService,
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  async generateConfirmations(
    tenantId: string,
    actorId: string,
  ): Promise<{ processedCount: number; payload: SlcConfirmationPayload }> {
    const now = new Date();
    const confirmations: SlcConfirmationRecord[] = [];

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          trigger: enrolmentDownstreamTriggers,
          enrolment: enrolments,
          fee: feeLiabilities,
        })
        .from(enrolmentDownstreamTriggers)
        .innerJoin(
          enrolments,
          and(
            eq(enrolments.id, enrolmentDownstreamTriggers.enrolmentId),
            eq(enrolments.tenantId, tenantId),
            isNull(enrolments.recordedUntil),
          ),
        )
        .leftJoin(
          feeLiabilities,
          and(
            eq(feeLiabilities.enrolmentId, enrolments.id),
            eq(feeLiabilities.tenantId, tenantId),
          ),
        )
        .where(
          and(
            eq(enrolmentDownstreamTriggers.tenantId, tenantId),
            eq(enrolmentDownstreamTriggers.triggerTypeCode, 'slc-confirmation'),
            eq(enrolmentDownstreamTriggers.statusCode, 'pending'),
          ),
        ),
    );

    const seenTriggers = new Set<string>();
    for (const row of rows) {
      if (seenTriggers.has(row.trigger.id)) continue;
      seenTriggers.add(row.trigger.id);

      const record = buildConfirmationRecord(row.trigger.id, row.enrolment, row.fee);
      confirmations.push(record);

      const exchange = await this.exchanges.recordExchange(
        tenantId,
        'slc-enrolment-exchange.v1',
        {
          directionCode: 'outbound',
          exchangeTypeCode: 'slc-confirmation',
          idempotencyKey: `slc-confirmation:${row.trigger.id}`,
          payloadHash: hashPayload(record),
          payloadSummary: { ...record },
          sentAt: now,
        },
        actorId,
      );

      await withTenantContext(this.db, tenantId, async (tx) => {
        await tx
          .update(enrolmentDownstreamTriggers)
          .set({ statusCode: 'processed', sentAt: now })
          .where(
            and(
              eq(enrolmentDownstreamTriggers.id, row.trigger.id),
              eq(enrolmentDownstreamTriggers.tenantId, tenantId),
              eq(enrolmentDownstreamTriggers.statusCode, 'pending'),
            ),
          );
      });

      await this.#publishConfirmationSent(tenantId, actorId, {
        enrolmentId: row.enrolment.id,
        confirmationType: record.confirmationType,
        exchangeId: exchange.id,
      });
    }

    return { processedCount: confirmations.length, payload: { confirmations } };
  }

  async generateStatusChangeNotification(
    enrolmentId: string,
    tenantId: string,
    actorId: string,
  ): Promise<SlcConfirmationRecord> {
    const enrolment = await this.enrolmentService.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);
    if (!enrolment.slcReference) {
      throw new ValidationError('Cannot generate SLC status notification without an SLC reference');
    }

    const feeRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(feeLiabilities)
        .where(and(eq(feeLiabilities.tenantId, tenantId), eq(feeLiabilities.enrolmentId, enrolmentId)))
        .limit(1),
    );

    const record: SlcConfirmationRecord = {
      triggerId: `status:${enrolmentId}`,
      enrolmentId,
      slcReference: enrolment.slcReference,
      programmeId: enrolment.programmeId,
      modeOfStudyCode: enrolment.modeOfStudyCode,
      confirmationType: mapSlcConfirmationType(enrolment.statusCode),
      feeAmount: formatFeeAmount(feeRows[0]?.amountMinorUnits ?? null),
      startDate: enrolment.startDate,
      expectedEndDate: enrolment.expectedEndDate,
    };

    const exchange = await this.exchanges.recordExchange(
      tenantId,
      'slc-enrolment-exchange.v1',
      {
        directionCode: 'outbound',
        exchangeTypeCode: 'slc-status-change',
        idempotencyKey: `slc-status:${enrolmentId}:${enrolment.statusCode}`,
        payloadHash: hashPayload(record),
        payloadSummary: { ...record },
      },
      actorId,
    );

    await this.#publishConfirmationSent(tenantId, actorId, {
      enrolmentId,
      confirmationType: record.confirmationType,
      exchangeId: exchange.id,
    });

    return record;
  }

  async processInboundNotification(
    tenantId: string,
    notification: SlcNotificationInput,
    actorId: string,
  ): Promise<string> {
    await this.#validateNotificationType(tenantId, notification.notificationTypeCode);

    const enrolment = await this.enrolmentService.getEnrolment(notification.enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', notification.enrolmentId);

    const rawPayload = notification.rawPayload ?? { ...notification };
    const idempotencyKey = notification.idempotencyKey
      ?? notification.notificationId
      ?? `slc-notification:${notification.enrolmentId}:${notification.notificationTypeCode}:${notification.effectiveDate}`;

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(slcNotifications)
        .values({
          tenantId,
          enrolmentId: notification.enrolmentId,
          notificationTypeCode: notification.notificationTypeCode,
          effectiveDate: notification.effectiveDate,
          amount: notification.amount === undefined || notification.amount === null
            ? null
            : String(notification.amount),
          rawPayload,
        })
        .returning({ id: slcNotifications.id }),
    );
    const notificationId = rows[0]!.id;

    const exchange = await this.exchanges.recordExchange(
      tenantId,
      'slc-enrolment-exchange.v1',
      {
        directionCode: 'inbound',
        exchangeTypeCode: 'slc-notification',
        idempotencyKey,
        payloadHash: hashPayload(rawPayload),
        payloadSummary: {
          notificationId,
          enrolmentId: notification.enrolmentId,
          notificationTypeCode: notification.notificationTypeCode,
        },
      },
      actorId,
    );

    await this.#publishNotificationReceived(tenantId, actorId, {
      enrolmentId: notification.enrolmentId,
      notificationTypeCode: notification.notificationTypeCode,
      amount: notification.amount === undefined || notification.amount === null
        ? null
        : String(notification.amount),
      effectiveDate: notification.effectiveDate,
      notificationId,
    });

    void exchange;
    return notificationId;
  }

  async listNotifications(enrolmentId: string, tenantId: string): Promise<SlcNotificationDto[]> {
    const enrolment = await this.enrolmentService.getEnrolment(enrolmentId, tenantId);
    if (!enrolment) throw new NotFoundError('Enrolment', enrolmentId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(slcNotifications)
        .where(and(eq(slcNotifications.tenantId, tenantId), eq(slcNotifications.enrolmentId, enrolmentId))),
    );

    return rows.map((row) => ({
      notificationId: row.id,
      enrolmentId: row.enrolmentId,
      notificationTypeCode: row.notificationTypeCode,
      effectiveDate: row.effectiveDate,
      amount: row.amount,
      receivedAt: row.receivedAt,
    }));
  }

  async getExchangeStatus(tenantId: string): Promise<SlcExchangeStatusDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationExchanges)
        .where(and(eq(integrationExchanges.tenantId, tenantId), eq(integrationExchanges.contractId, 'slc-enrolment-exchange.v1'))),
    );

    return rows.map((row) => ({
      exchangeId: row.id,
      directionCode: row.directionCode,
      exchangeTypeCode: row.exchangeTypeCode,
      idempotencyKey: row.idempotencyKey,
      statusCode: row.statusCode,
      sentAt: row.sentAt,
      receivedAt: row.receivedAt,
      createdAt: row.createdAt,
    }));
  }

  async #validateNotificationType(tenantId: string, notificationTypeCode: string): Promise<void> {
    const isValid = await this.valueSets.validateFieldValue(
      'slc_notification',
      'notification_type_code',
      notificationTypeCode,
      tenantId,
    );

    if (isValid === false) {
      throw new ValidationError(
        `Invalid SLC notification type '${notificationTypeCode}'`,
        [{ field: 'notificationTypeCode', message: 'Value is not active in slc-notification-type-code' }],
      );
    }
  }

  async #publishConfirmationSent(
    tenantId: string,
    actorId: string,
    payload: RegulatorySlcConfirmationSentV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_SLC_CONFIRMATION_SENT, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }

  async #publishNotificationReceived(
    tenantId: string,
    actorId: string,
    payload: RegulatorySlcNotificationReceivedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.REGULATORY_SLC_NOTIFICATION_RECEIVED, '1.0.0', tenantId, actorId, 'sensitive', payload);
  }
}

type EnrolmentRow = typeof enrolments.$inferSelect;
type FeeLiabilityRow = typeof feeLiabilities.$inferSelect;

function buildConfirmationRecord(
  triggerId: string,
  enrolment: EnrolmentRow,
  fee: FeeLiabilityRow | null,
): SlcConfirmationRecord {
  return {
    triggerId,
    enrolmentId: enrolment.id,
    slcReference: enrolment.slcReference ?? enrolment.id,
    programmeId: enrolment.programmeId,
    modeOfStudyCode: enrolment.modeOfStudyCode,
    confirmationType: mapSlcConfirmationType(enrolment.statusCode),
    feeAmount: formatFeeAmount(fee?.amountMinorUnits ?? null),
    startDate: enrolment.startDate,
    expectedEndDate: enrolment.expectedEndDate,
  };
}

function mapSlcConfirmationType(statusCode: string): 'enrolment' | 'withdrawal' | 'intermission' {
  if (statusCode === 'withdrawn') return 'withdrawal';
  if (statusCode === 'intermitting' || statusCode === 'suspended') return 'intermission';
  return 'enrolment';
}

function formatFeeAmount(amountMinorUnits: bigint | null): string | null {
  if (amountMinorUnits === null) return null;
  return (Number(amountMinorUnits) / 100).toFixed(2);
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
