/**
 * VleEventConsumer — NATS JetStream consumer for SRS events flowing to the VLE.
 *
 * Connects to NATS, subscribes to SRS_EVENTS with a durable push consumer
 * filtered to the ten VLE-relevant subjects, and dispatches messages to
 * routeToHandler.  Each message is processed inside a database transaction
 * that also records the event in vle_event_ledger for idempotency.
 *
 * Tests bypass the NATS layer entirely and call dispatch() directly.
 */

import type { DomainEventEnvelope } from '@revelation-srs/domain';
import type {
  ConsumerMessages,
  JetStreamClient,
  JetStreamManager,
  NatsConnection,
} from 'nats';
import {
  AckPolicy,
  connect,
  DeliverPolicy,
  JSONCodec,
  ReplayPolicy,
} from 'nats';
import type { Logger } from 'pino';

import type { VleDb } from '../db/client.js';
import type { SrsAcknowledgementClient } from '../srs-client/acknowledgement-client.js';
import type { VleClient } from '../vle-client/client.js';

import {
  consumerGroupFor,
  consumerNameFor,
  getLastStreamSeq,
  isAlreadyProcessed,
  writeLedger,
} from './event-ledger-repository.js';
import { routeToHandler, VLE_SUBSCRIBED_SUBJECTS } from './handlers.js';

const STREAM_NAME = 'SRS_EVENTS';

export interface VleEventConsumerOptions {
  vleClient?:    VleClient;
  srsAckClient?: SrsAcknowledgementClient;
  maxAttempts?:  number;
}

export class VleEventConsumer {
  private nc:       NatsConnection  | null = null;
  private messages: ConsumerMessages | null = null;
  private readonly jc = JSONCodec<DomainEventEnvelope<unknown>>();
  private readonly vleClient:    VleClient | undefined;
  private readonly srsAckClient: SrsAcknowledgementClient | undefined;
  private readonly maxAttempts:  number;

  constructor(
    private readonly natsUrl:  string,
    private readonly db:       VleDb,
    private readonly tenantId: string,
    private readonly log:      Logger,
    opts: VleEventConsumerOptions = {},
  ) {
    this.vleClient    = opts.vleClient;
    this.srsAckClient = opts.srsAckClient;
    this.maxAttempts  = opts.maxAttempts ?? 5;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.nc = await connect({ servers: this.natsUrl });
    this.log.info({ natsUrl: this.natsUrl }, 'VLE connector NATS consumer connected');
    await this.ensureConsumer(this.nc);
  }

  async start(): Promise<void> {
    if (!this.nc) throw new Error('Consumer not connected — call connect() first');

    const js: JetStreamClient = this.nc.jetstream();
    const consumer = await js.consumers.get(STREAM_NAME, consumerNameFor(this.tenantId));
    this.messages  = await consumer.consume();

    this.log.info(
      { consumer: consumerNameFor(this.tenantId), tenant: this.tenantId },
      'VLE event consumer started',
    );

    void this.processMessages();
  }

  async close(): Promise<void> {
    this.messages?.stop();
    await this.nc?.drain();
    this.nc       = null;
    this.messages = null;
  }

  isConnected(): boolean {
    return this.nc !== null && !this.nc.isClosed();
  }

  // ── Message loop ───────────────────────────────────────────────────────────

  private async processMessages(): Promise<void> {
    if (!this.messages) return;

    for await (const msg of this.messages) {
      const deliveryCount = msg.info.redeliveryCount ?? 0;

      try {
        const envelope = this.jc.decode(msg.data);
        await this.dispatch(envelope, BigInt(msg.seq), deliveryCount + 1);
        msg.ack();
      } catch (err) {
        if (deliveryCount + 1 >= this.maxAttempts) {
          // Max attempts exceeded — acknowledge and stop retrying.
          // The failed row written by dispatch() provides the audit trail.
          this.log.error(
            { err, subject: msg.subject, seq: msg.seq, attempts: deliveryCount + 1 },
            'VLE consumer: max attempts exceeded — moving to dead-letter',
          );
          msg.ack();
        } else {
          this.log.warn(
            { err, subject: msg.subject, seq: msg.seq, attempt: deliveryCount + 1 },
            'VLE consumer: error processing event — scheduling retry',
          );
          msg.nak(30_000); // retry after 30 s
        }
      }
    }
  }

  // ── Dispatch (public for testing) ──────────────────────────────────────────

  /**
   * Process a single event envelope.
   *
   * Wrong-tenant events are silently dropped (no ledger entry).
   * Duplicate events (already 'processed') are silently skipped.
   * Handler errors are recorded as 'failed' and rethrown so NATS can nak.
   *
   * The attemptCount parameter is used by the NATS message loop to track
   * retries; tests may omit it.
   */
  async dispatch(
    envelope:     DomainEventEnvelope<unknown>,
    streamSeq?:   bigint,
    attemptCount: number = 1,
  ): Promise<void> {
    // 1. Reject events for a different tenant — never record in our ledger.
    if (envelope.tenantId !== this.tenantId) {
      this.log.warn(
        { eventId: envelope.id, type: envelope.type, eventTenant: envelope.tenantId },
        'VLE consumer: rejecting cross-tenant event',
      );
      return;
    }

    // 2. Idempotency check — skip if already successfully processed.
    const alreadyDone = await isAlreadyProcessed(this.db, this.tenantId, envelope.id);
    if (alreadyDone) {
      this.log.debug({ eventId: envelope.id }, 'VLE consumer: skipping duplicate event');
      return;
    }

    // 3. Route to handler inside a transaction.
    try {
      await this.db.transaction(async (tx) => {
        const ctx = {
          tx,
          tenantId:     this.tenantId,
          vleClient:    this.vleClient,
          srsAckClient: this.srsAckClient,
          log:          this.log,
        };
        const outcome    = await routeToHandler(envelope, this.log, ctx);
        const statusCode = outcome === 'handled' ? 'processed' : 'skipped';

        await writeLedger(tx, {
          tenantId:     envelope.tenantId,
          eventId:      envelope.id,
          subject:      envelope.type,
          statusCode,
          ...(streamSeq !== undefined ? { streamSeq } : {}),
          payload:      envelope,
          attemptCount,
        });
      });
    } catch (err) {
      // Record the failure outside the rolled-back transaction.
      await writeLedger(this.db, {
        tenantId:     envelope.tenantId,
        eventId:      envelope.id,
        subject:      envelope.type,
        statusCode:   'failed',
        ...(streamSeq !== undefined ? { streamSeq } : {}),
        errorDetail:  err instanceof Error ? err.message : String(err),
        attemptCount,
      }).catch((writeErr) => {
        this.log.error({ writeErr, eventId: envelope.id }, 'VLE consumer: failed to write error to ledger');
      });

      throw err;
    }
  }

  // ── Stream / consumer setup ────────────────────────────────────────────────

  private async ensureConsumer(nc: NatsConnection): Promise<void> {
    const jsm: JetStreamManager = await nc.jetstreamManager();

    try {
      await jsm.streams.info(STREAM_NAME);
    } catch {
      this.log.warn({ stream: STREAM_NAME }, 'SRS_EVENTS stream not found — consumer not started');
      return;
    }

    // Determine replay starting point from ledger checkpoint.
    const lastSeq = await getLastStreamSeq(this.db, this.tenantId);

    const deliverPolicy = lastSeq
      ? DeliverPolicy.StartSequence
      : DeliverPolicy.All;

    const consumerConfig = {
      name:            consumerNameFor(this.tenantId),
      durable_name:    consumerNameFor(this.tenantId),
      filter_subjects: [...VLE_SUBSCRIBED_SUBJECTS],
      ack_policy:      AckPolicy.Explicit,
      deliver_policy:  deliverPolicy,
      replay_policy:   ReplayPolicy.Instant,
      max_deliver:     this.maxAttempts,
      ...(lastSeq ? { opt_start_seq: Number(lastSeq) + 1 } : {}),
    };

    try {
      await jsm.consumers.add(STREAM_NAME, consumerConfig);
      this.log.info(
        { consumer: consumerNameFor(this.tenantId), deliverPolicy, lastSeq: lastSeq?.toString() },
        'VLE durable consumer created',
      );
    } catch {
      // Consumer already exists — re-attach on restart.
      this.log.debug(
        { consumer: consumerNameFor(this.tenantId) },
        'VLE consumer already exists — re-attaching',
      );
    }
  }

  // ── Accessors (for health/observability) ───────────────────────────────────

  get consumerGroup(): string {
    return consumerGroupFor(this.tenantId);
  }
}
