export type DataClassification = 'standard' | 'personal' | 'sensitive' | 'special-category' | 'regulatory';
/**
 * Standard envelope wrapping every domain event published to NATS JetStream.
 * See docs/architecture/domain-events.md for the full taxonomy.
 */
export interface DomainEventEnvelope<TPayload = unknown> {
    /** UUID v4 — unique event identifier; doubles as idempotency key for consumers. */
    readonly id: string;
    /** Fully qualified subject, e.g. "srs.student.enrolled". */
    readonly type: string;
    /** Semver, e.g. "1.0.0". Breaking changes create a new version. */
    readonly version: string;
    /** URI to the JSON Schema for this event version. */
    readonly schemaRef: string;
    /** UUID of the tenant that produced the event. */
    readonly tenantId: string;
    /** ISO 8601 UTC — when the fact occurred in the real world. */
    readonly occurredAt: string;
    /** ISO 8601 UTC — when the event was published to the broker. */
    readonly publishedAt: string;
    /**
     * ISO 8601 UTC — valid-time of the fact.
     * Differs from occurredAt when a backdated correction is made.
     */
    readonly validAt: string;
    /** UUID — traces the originating user request across all events it causes. */
    readonly correlationId: string;
    /** UUID — the id of the event or command that directly caused this event. */
    readonly causationId: string;
    /** Identifies the publishing service, e.g. "srs-core", "wellbeing-module". */
    readonly source: string;
    readonly dataClassification: DataClassification;
    readonly payload: TPayload;
}
//# sourceMappingURL=envelope.d.ts.map