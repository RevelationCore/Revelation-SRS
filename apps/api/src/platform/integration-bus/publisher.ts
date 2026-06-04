import { randomUUID } from 'node:crypto';

import type { DomainEventEnvelope, DataClassification } from '@revelation-srs/domain';
import type { JetStreamClient, NatsConnection } from 'nats';
import { connect, JSONCodec } from 'nats';

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
  }

  async close(): Promise<void> {
    await this.nc?.drain();
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

    const now = new Date().toISOString();
    const envelope: DomainEventEnvelope<TPayload> = {
      id:                 randomUUID(),
      type,
      version,
      schemaRef:          `https://srs.example.com/schemas/events/${type.replace(/\./g, '/')}/${version}.json`,
      tenantId,
      occurredAt:         now,
      publishedAt:        now,
      validAt:            (options.validAt ?? new Date()).toISOString(),
      correlationId,
      causationId:        options.causationId ?? correlationId,
      source:             'srs-core',
      dataClassification,
      payload,
    };

    await this.js.publish(type, this.jc.encode(envelope));
  }
}
