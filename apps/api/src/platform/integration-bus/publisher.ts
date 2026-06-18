import { randomUUID } from 'node:crypto';

import { context, propagation } from '@opentelemetry/api';
import type { DomainEventEnvelope, DataClassification } from '@revelation-srs/domain';
import type { JetStreamClient, NatsConnection, MsgHdrs } from 'nats';
import { connect, JSONCodec, headers as natsHeaders } from 'nats';

import { clockNow } from '../clock.js';

export interface PublishOptions {
  /** Overrides valid time when the event represents a backdated fact. */
  validAt?: Date;
  /** The event that caused this one; omit for commands/user actions. */
  causationId?: string;
}

/**
 * Publishes domain events to NATS JetStream using the standard envelope.
 *
 * See docs/architecture/domain-events.md for the full event taxonomy.
 * See docs/architecture/integration-layer.md for stream topology.
 */
export class IntegrationBusPublisher {
  private nc: NatsConnection | null = null;
  private js: JetStreamClient | null = null;
  private readonly jc = JSONCodec<DomainEventEnvelope<unknown>>();

  constructor(private readonly natsUrl: string) {}

  async connect(): Promise<void> {
    this.nc = await connect({ servers: this.natsUrl });
    this.js = this.nc.jetstream();
    await this.ensureStream();
  }

  private async ensureStream(): Promise<void> {
    const jsm = await this.nc!.jetstreamManager();
    try {
      await jsm.streams.info('SRS_EVENTS');
    } catch {
      await jsm.streams.add({ name: 'SRS_EVENTS', subjects: ['srs.>'] });
    }
  }

  async close(): Promise<void> {
    await this.nc?.drain();
    this.nc = null;
    this.js = null;
  }

  isConnected(): boolean {
    return this.nc !== null && !this.nc.isClosed();
  }

  async publish<TPayload>(
    type:               string,
    version:            string,
    tenantId:           string,
    correlationId:      string,
    dataClassification: DataClassification,
    payload:            TPayload,
    options:            PublishOptions = {},
  ): Promise<void> {
    if (!this.js) throw new Error('IntegrationBusPublisher is not connected');

    const now = clockNow().toISOString();
    const envelope: DomainEventEnvelope<TPayload> = {
      id:                 randomUUID(),
      type,
      version,
      schemaRef:          `https://srs.example.com/schemas/events/${type.replace(/\./g, '/')}/${version}.json`,
      tenantId,
      occurredAt:         now,
      publishedAt:        now,
      validAt:            (options.validAt ?? clockNow()).toISOString(),
      correlationId,
      causationId:        options.causationId ?? correlationId,
      source:             'srs-core',
      dataClassification,
      payload,
    };

    // Inject W3C TraceContext headers so downstream consumers can continue the trace.
    const hdrs: MsgHdrs = natsHeaders();
    propagation.inject(context.active(), hdrs, {
      set: (carrier: MsgHdrs, key: string, value: string) => carrier.set(key, value),
    });

    await this.js.publish(type, this.jc.encode(envelope), { headers: hdrs });
  }
}
