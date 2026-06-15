# Revelation SRS Event Consumer Guide

> Phase 7 — Stage 2
> Status: Current
> Schema registry: `schemas/events/registry.json`
> Envelope schema: `schemas/events/envelope.v1.json`
> Subject namespace: `srs.*`

---

## Overview

Revelation SRS publishes domain events to NATS JetStream. Every observable fact — a student created, a mark ratified, an award conferred, a UCAS confirmation sent — is published as a typed event with a stable subject, a versioned payload, and a shared envelope structure.

This guide covers:

- the standard event envelope and how to parse it
- subject naming and the NATS stream structure
- schema registry — how to resolve a schema and validate a payload
- consumer group naming and subscription patterns
- ordering, idempotency, and at-least-once delivery
- replay and backfill
- dead-letter handling
- schema compatibility and versioning
- the published event taxonomy with data classification
- internal events that are not for external consumers

---

## The Event Envelope

Every event is published as a JSON-encoded `DomainEventEnvelope`. The schema for the envelope is committed at:

```
schemas/events/envelope.v1.json
```

### Envelope fields

```json
{
  "id":                 "01931abc-0001-7000-a000-000000000001",
  "type":               "srs.student.created",
  "version":            "1.0.0",
  "schemaRef":          "https://schemas.revelation-srs.io/events/student/created/v1.json",
  "tenantId":           "01931abc-0000-7000-a000-000000000000",
  "occurredAt":         "2025-09-01T09:00:00Z",
  "publishedAt":        "2025-09-01T09:00:01Z",
  "validAt":            "2025-09-01T09:00:00Z",
  "correlationId":      "01931abc-ffff-7000-a000-000000000001",
  "causationId":        "01931abc-ffff-7000-a000-000000000002",
  "source":             "srs-core",
  "dataClassification": "personal",
  "payload": {
    "personId":      "01931abc-0001-7000-a000-000000000001",
    "studentNumber": "STU-2025-00001",
    "tenantId":      "01931abc-0000-7000-a000-000000000000"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique event identifier. Use as idempotency key. |
| `type` | string | Fully qualified NATS subject (e.g. `srs.student.created`). |
| `version` | string (semver) | Payload version. Breaking changes create a new version. |
| `schemaRef` | URI | Resolves to the JSON Schema for the `payload` field. |
| `tenantId` | UUID | Tenant that produced the event. All data is tenant-scoped. |
| `occurredAt` | ISO 8601 UTC | When the fact occurred in the world. |
| `publishedAt` | ISO 8601 UTC | When the event was published to the broker. |
| `validAt` | ISO 8601 UTC | Valid-time of the fact. Differs from `occurredAt` for backdated corrections. |
| `correlationId` | UUID | Traces the originating request across all events it causes. |
| `causationId` | UUID | The `id` of the event or command that directly caused this event. |
| `source` | string | Publishing service identifier, e.g. `srs-core`. |
| `dataClassification` | enum | Data sensitivity class — see [Data classification](#data-classification). |
| `payload` | object | Event-specific data. Validate against `schemaRef`. |

---

## Subject Naming

Events use a three-segment dot-separated subject:

```
srs.{domain}.{event-name}
```

Examples:

```
srs.student.created
srs.assessment.module-result-ratified
srs.regulatory.hesa-return-submitted
srs.governance.exam-board-ratified
```

### NATS stream design

Revelation SRS publishes all events to a single NATS JetStream stream:

```
Stream name:    SRS_EVENTS
Subjects:       srs.>
Storage:        file
Max age:        30 days (configurable per deployment)
Retention:      limits
Replicas:       3 (production)
```

Consumers should create durable consumer groups against `SRS_EVENTS` with subject filters matching the events they need. Do not create wildcard subscriptions across all `srs.>` subjects — filter to only the subjects your service requires.

---

## Schema Registry

Payload schemas are committed at:

```
schemas/events/{domain}/{event-name}/v1.json
```

The machine-readable registry is at:

```
schemas/events/registry.json
```

### Resolving a schema

Given an event, resolve the schema for its payload as follows:

1. Read `schemaRef` from the envelope.
2. The URI `https://schemas.revelation-srs.io/events/{domain}/{event}/v1.json` maps to the local path `schemas/events/{domain}/{event}/v1.json` in the SRS repository.
3. Load the schema and validate `event.payload` against it.

### Validating a payload (Node.js / TypeScript)

```typescript
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ajv = new Ajv({ strict: false });

function validateEventPayload(event: DomainEventEnvelope): void {
  // Derive local schema path from schemaRef URI
  const schemaUri = event.schemaRef;
  const schemaRelPath = schemaUri.replace('https://schemas.revelation-srs.io/events/', '');
  const schema = JSON.parse(
    readFileSync(join('schemas/events', schemaRelPath), 'utf-8'),
  );

  const validate = ajv.compile(schema);
  if (!validate(event.payload)) {
    throw new Error(`Event payload validation failed: ${JSON.stringify(validate.errors)}`);
  }
}
```

---

## Consumer Group Naming

Use the pattern:

```
{service-name}_{event-domain}_{event-name}
```

Examples:

```
finance-adapter_enrolment_fee-liability-generated
vle-adapter_enrolment_module-registered
transcript-service_award_conferred
ukvi-adapter_regulatory_ukvi-cas-requested
```

Durable consumer groups ensure each subscription receives every event exactly once, even after restart. Do not use ephemeral (non-durable) subscriptions for production integrations.

---

## Ordering and Partitioning

Events within a single subject are ordered by NATS sequence number. The `registry.json` `partitionKey` field indicates the primary field used for logical ordering within a stream.

For example, `srs.enrolment.module-registered` has `partitionKey: "enrolmentId"`. All events for the same enrolment are published in occurrence order, but events for different enrolments may be interleaved.

**Do not** assume global ordering across subjects. If you need to process multiple events for the same entity in strict order (e.g. `srs.student.enrolled` before `srs.enrolment.module-registered`), sort by `occurredAt` or use the `correlationId`/`causationId` chain.

---

## Idempotency

Each event has a globally unique `id` (UUID v4). Use the `id` as an idempotency key when recording that an event has been processed.

```typescript
const alreadyProcessed = await db.query(
  'SELECT 1 FROM processed_events WHERE event_id = $1',
  [event.id],
);
if (alreadyProcessed.rowCount > 0) return;  // skip duplicate

await processEvent(event);
await db.query('INSERT INTO processed_events (event_id) VALUES ($1)', [event.id]);
```

Store processed event IDs for at least the retention period of the stream (30 days by default) to guarantee safe deduplication across replays.

---

## At-Least-Once Delivery

NATS JetStream provides at-least-once delivery semantics. Events may be redelivered if:

- your consumer fails to acknowledge within the ack timeout
- your consumer restarts before acknowledging
- a replay is triggered

Design your event handler to be idempotent using the `id`-based deduplication pattern above.

---

## Replay and Backfill

To replay events from a point in time:

1. Create a new durable consumer with `DeliverPolicy: ByStartTime` and set `OptStartTime` to the desired start.
2. The consumer will receive all events in the stream from that time onwards, regardless of whether they were previously acknowledged.

For a full backfill (e.g. initialising a new downstream system):

1. Create a consumer with `DeliverPolicy: All`.
2. Process events from the beginning of the stream.
3. Switch to a normal durable consumer once caught up.

Coordinate backfills with the SRS platform team — backfills may produce a large volume of events and should be rate-limited to avoid overwhelming downstream systems.

---

## Dead-Letter Handling

There is no built-in dead-letter queue in the standard SRS JetStream deployment. Implement dead-letter handling in your consumer:

1. If processing fails, catch the exception and **do not** acknowledge the message.
2. NATS will redeliver after the configured `AckWait` timeout (default: 30 seconds).
3. After `MaxDeliver` attempts (default: 5), the message is no longer redelivered.
4. Record failed messages in your own dead-letter store with the event `id`, `type`, and the error.
5. Alert on dead-letter accumulation and process them manually or via a replay.

```typescript
const consumer = await js.consumers.get('SRS_EVENTS', 'my-consumer-group');
const messages = await consumer.consume();

for await (const msg of messages) {
  try {
    await processEvent(JSON.parse(new TextDecoder().decode(msg.data)));
    msg.ack();
  } catch (err) {
    await deadLetterStore.record({
      eventId: JSON.parse(new TextDecoder().decode(msg.data)).id,
      error:   String(err),
      subject: msg.subject,
    });
    msg.nak();  // trigger redeliver or let MaxDeliver exhaust
  }
}
```

---

## Schema Compatibility and Versioning

Revelation SRS follows these compatibility rules:

| Change | Compatible? | Action |
|---|---|---|
| Add new optional field to payload | Yes — backwards compatible | No version bump |
| Remove existing field from payload | No — breaking change | New version (`v2`) |
| Change field type | No — breaking change | New version (`v2`) |
| Change field from optional to required | No — breaking change | New version (`v2`) |
| Add new enum value | Yes — backwards compatible | No version bump |
| Remove enum value | No — breaking change | New version (`v2`) |
| Rename a field | No — breaking change | New version (`v2`) |

When a breaking change is required:
- A new schema version is published at `schemas/events/{domain}/{event}/v2.json`.
- The new event type is published with `version: "2.0.0"` and the updated `schemaRef`.
- The old version continues to be published in parallel for a **deprecation period of 6 months**.
- `deprecated: true` is set in the registry entry for the old version.
- Consumers must migrate to the new version before the deprecation period ends.

---

## Data Classification

Every event carries a `dataClassification` field indicating the sensitivity of the payload:

| Classification | Description | Consumer obligations |
|---|---|---|
| `standard` | Non-personal operational data (IDs, codes, counts) | Standard secure transit and storage |
| `personal` | Personally identifiable information (name, date of birth, student number) | GDPR Article 5 obligations apply |
| `sensitive` | Data warranting extra care (disability, EC, misconduct outcomes) | Additional access controls required |
| `special-category` | GDPR Article 9 special category data (disability declarations) | Explicit consent or legal basis required |
| `regulatory` | Statutory exchange data (HESA, UCAS, SLC, UKVI) | Regulatory compliance obligations apply |

Never log or store special-category or sensitive data in unprotected systems. Encrypt payloads in transit and at rest.

---

## Published Event Taxonomy

All 46 published events by domain:

### Student (5 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.student.created` | 1.0.0 | personal | personId |
| `srs.student.identity-updated` | 1.0.0 | personal | personId |
| `srs.student.enrolled` | 1.0.0 | personal | personId |
| `srs.student.status-changed` | 1.0.0 | personal | personId |
| `srs.student.disability-declaration-updated` | 1.0.0 | special-category | personId |

### Identity (2 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.identity.verification-requested` | 1.0.0 | personal | personId |
| `srs.identity.verification-completed` | 1.0.0 | personal | personId |

### Enrolment (4 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.enrolment.fee-liability-generated` | 1.0.0 | regulatory | enrolmentId |
| `srs.enrolment.module-registered` | 1.0.0 | standard | enrolmentId |
| `srs.enrolment.module-registration-withdrawn` | 1.0.0 | standard | enrolmentId |
| `srs.enrolment.module-registration-completed` | 1.0.0 | standard | enrolmentId |

### Catalogue (4 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.catalogue.programme-updated` | 1.0.0 | standard | programmeId |
| `srs.catalogue.module-updated` | 1.0.0 | standard | moduleId |
| `srs.catalogue.module-relationship-updated` | 1.0.0 | standard | moduleId |
| `srs.catalogue.learning-outcome-updated` | 1.0.0 | standard | learningOutcomeId |

### Assessment (4 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.assessment.mark-received` | 1.0.0 | standard | moduleRegistrationId |
| `srs.assessment.mark-updated` | 1.0.0 | standard | moduleRegistrationId |
| `srs.assessment.module-result-calculated` | 1.0.0 | standard | moduleRegistrationId |
| `srs.assessment.module-result-ratified` | 1.0.0 | standard | moduleRegistrationId |

### Adjustment (3 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.adjustment.approved` | 1.0.0 | sensitive | enrolmentId |
| `srs.adjustment.distributed` | 1.0.0 | sensitive | adjustmentId |
| `srs.adjustment.expired` | 1.0.0 | sensitive | enrolmentId |

### Circumstances (3 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.circumstances.exceptional-circumstances-flagged` | 1.0.0 | sensitive | enrolmentId |
| `srs.circumstances.exceptional-circumstances-updated` | 1.0.0 | sensitive | exceptionalCircumstancesId |
| `srs.circumstances.misconduct-outcome-recorded` | 1.0.0 | sensitive | enrolmentId |

### Governance (6 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.governance.exam-board-data-pack-ready` | 1.0.0 | standard | examBoardId |
| `srs.governance.exam-board-ratified` | 1.0.0 | standard | examBoardId |
| `srs.governance.record-locked` | 1.0.0 | standard | examBoardId |
| `srs.governance.record-amended-post-ratification` | 1.0.0 | standard | examBoardId |
| `srs.governance.exam-entry-submitted` | 1.0.0 | standard | examBoardId |
| `srs.governance.exam-schedule-received` | 1.0.0 | standard | examBoardId |

### Progression (1 event)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.progression.decided` | 1.0.0 | standard | enrolmentId |

### Award (1 event)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.award.conferred` | 1.0.0 | standard | enrolmentId |

### Regulatory (13 events)

| Subject | Version | Data class | Partition key |
|---|---|---|---|
| `srs.regulatory.ucas-application-received` | 1.0.0 | personal | applicationId |
| `srs.regulatory.ucas-confirmation-sent` | 1.0.0 | regulatory | enrolmentId |
| `srs.regulatory.hesa-return-generated` | 1.0.0 | regulatory | returnId |
| `srs.regulatory.hesa-return-submitted` | 1.0.0 | regulatory | returnId |
| `srs.regulatory.hesa-id-assigned` | 1.0.0 | personal | enrolmentId |
| `srs.regulatory.slc-confirmation-sent` | 1.0.0 | regulatory | enrolmentId |
| `srs.regulatory.slc-notification-received` | 1.0.0 | regulatory | enrolmentId |
| `srs.regulatory.ukvi-cas-requested` | 1.0.0 | regulatory | enrolmentId |
| `srs.regulatory.ukvi-cas-assigned` | 1.0.0 | regulatory | enrolmentId |
| `srs.regulatory.ukvi-attendance-submitted` | 1.0.0 | regulatory | academicPeriodId |
| `srs.regulatory.ukvi-visa-status-updated` | 1.0.0 | regulatory | enrolmentId |
| `srs.regulatory.ukvi-compliance-alert-raised` | 1.0.0 | regulatory | enrolmentId |
| `srs.regulatory.ofs-extract-generated` | 1.0.0 | regulatory | extractId |

---

## Internal Events (Not for External Consumers)

The following events are in `EVENT_TYPES` but are **not published externally**. Do not create subscriptions for these subjects.

| Subject | Reason |
|---|---|
| `srs.enrolment.downstream-trigger-created` | Internal routing event used by the trigger processing pipeline. Not a stable consumer surface. |
| `srs.workflow.task-assigned` | Internal workflow coordination. Task management is a platform concern. |
| `srs.workflow.task-completed` | Internal workflow coordination. |
| `srs.workflow.task-escalated` | Internal workflow coordination. |
| `srs.workflow.decision-recorded` | Internal workflow coordination. |
| `srs.workflow.completed` | Internal workflow coordination. |

---

## Regenerating Schemas

After adding or changing event payload types, regenerate the committed schemas:

```bash
pnpm --filter @revelation-srs/domain generate:schemas
```

Then commit the updated files in `schemas/events/`. The Stage 2 schema registry tests will fail in CI if schemas are stale.

---

## Support

For event consumer questions or to report schema issues, use the project issue tracker. Include the event `id` and `correlationId` from the envelope in any support request.
