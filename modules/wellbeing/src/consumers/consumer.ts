/**
 * WellbeingEventConsumer — NATS JetStream consumer for SRS context events.
 *
 * Connects to NATS, subscribes to the SRS_EVENTS stream with a durable
 * push consumer, and dispatches messages to the appropriate projection
 * handler.  Each message is processed inside a single database transaction
 * that also records the event in the event_log table for idempotency.
 *
 * The consumer is started from main.ts after the HTTP server is ready.
 * Tests bypass this class entirely and call handlers directly.
 */

import type { DomainEventEnvelope } from '@revelation-srs/domain';
import { EVENT_TYPES } from '@revelation-srs/domain';
import type { ConsumerMessages, JetStreamClient, JetStreamManager, NatsConnection } from 'nats';
import { AckPolicy, connect, DeliverPolicy, JSONCodec, ReplayPolicy } from 'nats';
import type { Logger } from 'pino';

import type { WellbeingDb, WellbeingTx } from '../db/client.js';
import { withWellbeingTenantContext } from '../db/client.js';
import { CONSUMER_GROUP, isAlreadyProcessed, markProcessed } from '../repositories/event-log-repository.js';
import {
  handleStudentEnrolled,
  handleStudentStatusChanged,
  handleDisabilityDeclarationUpdated,
  handleModuleRegistered,
  handleModuleRegistrationWithdrawn,
  handleMarkReceived,
  handleModuleResultRatified,
  handleAdjustmentApproved,
  handleAdjustmentDistributed,
  handleAdjustmentExpired,
  handleEcFlagged,
  handleEcUpdated,
  handleUkviVisaStatusUpdated,
  handleUkviComplianceAlertRaised,
} from '../projections/context-projection.js';

const STREAM_NAME    = 'SRS_EVENTS';
const CONSUMER_NAME  = 'wellbeing-context-consumer';

/** Subjects this consumer subscribes to. */
const SUBSCRIBED_SUBJECTS = [
  EVENT_TYPES.STUDENT_ENROLLED,
  EVENT_TYPES.STUDENT_STATUS_CHANGED,
  EVENT_TYPES.STUDENT_DISABILITY_DECLARATION_UPDATED,
  EVENT_TYPES.ENROLMENT_MODULE_REGISTERED,
  EVENT_TYPES.ENROLMENT_MODULE_REGISTRATION_WITHDRAWN,
  EVENT_TYPES.ASSESSMENT_MARK_RECEIVED,
  EVENT_TYPES.ASSESSMENT_MODULE_RESULT_RATIFIED,
  EVENT_TYPES.ADJUSTMENT_APPROVED,
  EVENT_TYPES.ADJUSTMENT_DISTRIBUTED,
  EVENT_TYPES.ADJUSTMENT_EXPIRED,
  EVENT_TYPES.CIRCUMSTANCES_EC_FLAGGED,
  EVENT_TYPES.CIRCUMSTANCES_EC_UPDATED,
  EVENT_TYPES.REGULATORY_UKVI_VISA_STATUS_UPDATED,
  EVENT_TYPES.REGULATORY_UKVI_COMPLIANCE_ALERT,
] as const;

export class WellbeingEventConsumer {
  private nc: NatsConnection | null = null;
  private messages: ConsumerMessages | null = null;
  private readonly jc = JSONCodec<DomainEventEnvelope<unknown>>();

  constructor(
    private readonly natsUrl: string,
    private readonly db:      WellbeingDb,
    private readonly log:     Logger,
  ) {}

  async connect(): Promise<void> {
    this.nc = await connect({ servers: this.natsUrl });
    this.log.info({ natsUrl: this.natsUrl }, 'Wellbeing NATS consumer connected');
    await this.ensureConsumer(this.nc);
  }

  async start(): Promise<void> {
    if (!this.nc) throw new Error('Consumer not connected — call connect() first');

    const js: JetStreamClient = this.nc.jetstream();
    const consumer = await js.consumers.get(STREAM_NAME, CONSUMER_NAME);
    this.messages = await consumer.consume();

    this.log.info({ consumer: CONSUMER_NAME }, 'Wellbeing event consumer started');

    void this.processMessages();
  }

  async close(): Promise<void> {
    this.messages?.stop();
    await this.nc?.drain();
    this.nc = null;
    this.messages = null;
  }

  isConnected(): boolean {
    return this.nc !== null && !this.nc.isClosed();
  }

  // ── Message loop ────────────────────────────────────────────────────────────

  private async processMessages(): Promise<void> {
    if (!this.messages) return;

    for await (const msg of this.messages) {
      try {
        const envelope = this.jc.decode(msg.data);
        await this.dispatch(envelope, BigInt(msg.seq));
        msg.ack();
      } catch (err) {
        this.log.error({ err, subject: msg.subject, seq: msg.seq }, 'Error processing event — nacking');
        msg.nak(30_000); // retry after 30 s
      }
    }
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  /**
   * Route an event envelope to its handler inside a transaction that also
   * records the event in event_log.  Skips silently if the event has already
   * been processed (idempotency).
   *
   * Exported and called directly by integration tests to avoid needing NATS.
   */
  async dispatch(
    envelope: DomainEventEnvelope<unknown>,
    streamSeq?: bigint,
  ): Promise<void> {
    await withWellbeingTenantContext(this.db, envelope.tenantId, async (tx) => {
      if (await isAlreadyProcessed(tx, envelope.id, CONSUMER_GROUP)) {
        this.log.debug({ eventId: envelope.id }, 'Skipping duplicate event');
        return;
      }

      await routeToHandler(tx, envelope);

      await markProcessed(tx, {
        eventId:       envelope.id,
        subject:       envelope.type,
        tenantId:      envelope.tenantId,
        ...(streamSeq !== undefined ? { streamSeq } : {}),
        consumerGroup: CONSUMER_GROUP,
        payload:       envelope,
      });
    });
  }

  // ── Stream / consumer setup ─────────────────────────────────────────────────

  private async ensureConsumer(nc: NatsConnection): Promise<void> {
    const jsm: JetStreamManager = await nc.jetstreamManager();

    // Ensure SRS_EVENTS stream exists (created by the SRS API on startup;
    // here we just verify — the wellbeing module does not own the stream).
    try {
      await jsm.streams.info(STREAM_NAME);
    } catch {
      // Stream may not exist in dev before the SRS API has started once.
      this.log.warn({ stream: STREAM_NAME }, 'SRS_EVENTS stream not found — consumer not started');
      return;
    }

    // Create or re-attach a durable push consumer filtered to our subjects.
    try {
      await jsm.consumers.add(STREAM_NAME, {
        name:           CONSUMER_NAME,
        durable_name:   CONSUMER_NAME,
        filter_subjects: [...SUBSCRIBED_SUBJECTS],
        ack_policy:     AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
        replay_policy:  ReplayPolicy.Instant,
      });
      this.log.info({ consumer: CONSUMER_NAME }, 'Durable consumer created');
    } catch {
      // Consumer already exists (normal on restart).
      this.log.debug({ consumer: CONSUMER_NAME }, 'Consumer already exists — re-attaching');
    }
  }
}

// ── Handler router ────────────────────────────────────────────────────────────

export async function routeToHandler(
  tx:       WellbeingTx,
  envelope: DomainEventEnvelope<unknown>,
): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
  switch (envelope.type) {
    case EVENT_TYPES.STUDENT_ENROLLED:
      return handleStudentEnrolled(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.STUDENT_STATUS_CHANGED:
      return handleStudentStatusChanged(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.STUDENT_DISABILITY_DECLARATION_UPDATED:
      return handleDisabilityDeclarationUpdated(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.ENROLMENT_MODULE_REGISTERED:
      return handleModuleRegistered(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.ENROLMENT_MODULE_REGISTRATION_WITHDRAWN:
      return handleModuleRegistrationWithdrawn(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.ASSESSMENT_MARK_RECEIVED:
      return handleMarkReceived(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.ASSESSMENT_MODULE_RESULT_RATIFIED:
      return handleModuleResultRatified(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.ADJUSTMENT_APPROVED:
      return handleAdjustmentApproved(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.ADJUSTMENT_DISTRIBUTED:
      return handleAdjustmentDistributed(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.ADJUSTMENT_EXPIRED:
      return handleAdjustmentExpired(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.CIRCUMSTANCES_EC_FLAGGED:
      return handleEcFlagged(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.CIRCUMSTANCES_EC_UPDATED:
      return handleEcUpdated(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.REGULATORY_UKVI_VISA_STATUS_UPDATED:
      return handleUkviVisaStatusUpdated(tx, envelope as DomainEventEnvelope<any>);
    case EVENT_TYPES.REGULATORY_UKVI_COMPLIANCE_ALERT:
      return handleUkviComplianceAlertRaised(tx, envelope as DomainEventEnvelope<any>);
    default:
      // Unknown subject — silently skip; event_log records it for observability.
      break;
  }
}
