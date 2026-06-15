# Revelation SRS Integration Developer Guide

> Phase 7 — Stage 5
> Status: Current
> Audience: third-party integrators, first-party module authors, institutional IT teams

---

## Overview

Revelation SRS exposes three complementary integration surfaces:

| Surface | Mechanism | Best for |
|---------|-----------|----------|
| **REST API** | HTTP/JSON over HTTPS | Transactional reads and writes; synchronous workflows |
| **Event stream** | NATS JetStream | Reactive consumers; audit sinks; downstream synchronisation |
| **File exchange** | HTTPS API (JSON/XML upload/download) | Statutory regulatory submissions (UCAS, HESA, SLC, UKVI) |

Most real integrations are hybrid: a VLE subscribes to events for enrolment changes and calls the REST API to submit marks. A statutory adapter consumes trigger events and calls a file-exchange endpoint to generate a return.

This guide explains how to authenticate, register your integration, and build against each surface. For detailed protocol references, consult the specialist guides:

- **REST API**: [`rest-api-guide.md`](rest-api-guide.md)
- **Event consumer**: [`event-consumer-guide.md`](event-consumer-guide.md)
- **File exchange contracts**: [`file-contracts/`](file-contracts/)
- **Contract index** (all surfaces in one table): [`contract-index.md`](contract-index.md)

Example walkthroughs for common integrations are in [`examples/`](examples/).

---

## Authentication and Tenant Context

Every API call requires a Bearer JWT obtained from the institution's Keycloak realm.

```http
Authorization: Bearer <access_token>
```

Request a token using OAuth 2.0 client credentials:

```http
POST https://keycloak.{tenant-host}/realms/{realm}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=your-integration-client
&client_secret=your-client-secret
```

Keycloak returns `access_token`, `expires_in`, and `refresh_token`. Cache the token and refresh it before expiry rather than requesting a new token on every call.

### Tenant context

Every JWT carries a `tenant_id` claim that scopes all data access. The SRS enforces row-level security at the database layer — it is not possible to read another tenant's data, even with a valid token.

Your client credentials are provisioned per-institution. If you support multiple institutions you will have separate credentials (and separate Keycloak realms) for each.

### Required roles

Each operation requires a specific Keycloak realm role:

| Operation family | Role |
|-----------------|------|
| Student, enrolment, assessment reads | `registry-read` |
| Enrolment lifecycle, mark submission | `registry-write` |
| Adjustments, EC, wellbeing data | `wellbeing-advisor` |
| Regulatory exchanges (UCAS, HESA, SLC, UKVI) | `regulatory:write` / `regulatory:read` |
| Integration contracts and registrations | `integration:manage` |
| Tenant configuration and admin | `tenant-administrator` |

See the OpenAPI spec (`apps/api/openapi/v1.json`) for the exact permission required on each operation.

---

## Choosing an Integration Surface

```
┌─ Is your integration reactive (data changes in SRS drive your system)?
│   YES → Event stream
│   NO  ↓
└─ Do you need to push data INTO the SRS?
    YES → REST API (transactional writes)
    NO  ↓
└─ Is this a statutory regulatory exchange (UCAS, HESA, SLC, UKVI)?
    YES → File exchange API
    NO  → REST API (reads)
```

### First-party module vs external integration

**First-party module** (e.g. Wellbeing, Finance, Assessment Venue): a component that is architecturally part of the SRS platform. It shares the same Keycloak realm, subscribes to internal events, and calls integration-class REST endpoints. Its client credentials are provisioned with elevated permissions (wellbeing-data write, adjustments, EC).

**External integration** (e.g. VLE, CRM, BI warehouse): an independent system that connects to the SRS over its published external surface. It authenticates with its own client credentials, consumes public-class events and REST endpoints only, and registers via the plugin registry.

Both patterns are described in detail in the [Integration Patterns](#integration-patterns) section.

---

## Plugin Registration

Before your integration goes live you must register it using the integration registry API. Registration links your system to a specific contract, transport, and endpoint configuration, and allows the SRS to enforce environment and safety-class rules.

### Step 1 — Identify the correct contract

```http
GET /api/v1/integration-contracts
Authorization: Bearer <admin-token>
```

This returns the catalogue of supported integration contracts. Each contract has a `contractId`, `patternType`, `directionCode`, and `dataClassificationCode`. Find the contract that matches your integration (e.g. `exam-scheduling.v1` for the exam scheduling file exchange, or use events and REST for VLE).

To look up a specific contract:

```http
GET /api/v1/integration-contracts/{contractId}
Authorization: Bearer <admin-token>
```

If a contract's `deprecatedAt` field is non-null, new registrations for it are blocked. Use the current replacement contract instead.

### Step 2 — Create a registration

```http
POST /api/v1/integration-registrations
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "contractId": "exam-scheduling.v1",
  "displayName": "Exam Scheduler — Syndesis",
  "transportCode": "sftp-push",
  "endpointUrl": "sftp://exams.your-institution.ac.uk/srs/incoming/",
  "secretRef": "vault:secret/integrations/exam-scheduler/sftp-key",
  "replaySupported": true,
  "endpointSafetyClass": "external-test",
  "liveTrafficApproved": false
}
```

Key fields:

| Field | Meaning |
|-------|---------|
| `contractId` | The integration contract being registered |
| `transportCode` | Transport mechanism: `https-api`, `sftp-push`, `manual-api`, `manual-file`, `nats-push` |
| `endpointUrl` | Where the SRS sends outbound data (for outbound contracts) |
| `secretRef` | Vault path for credentials; never store credentials directly |
| `replaySupported` | Whether backfill/replay is supported by your endpoint |
| `endpointSafetyClass` | `simulator`, `external-test`, or `external-production` |
| `liveTrafficApproved` | Must be `true` before enabling a production endpoint |

New registrations are always created in a disabled state.

### Step 3 — Enable the registration

```http
POST /api/v1/integration-registrations/{registrationId}/enable
Authorization: Bearer <admin-token>
```

The SRS enforces safety class rules at enable time:

- `simulator` endpoints can be enabled in any environment.
- `external-test` endpoints can be enabled in any non-production environment.
- `external-production` endpoints require `liveTrafficApproved: true` and a production deployment environment. Attempting to enable a production endpoint in a staging or test environment returns 403.

### Step 4 — Update and monitor

Update configuration with `PATCH /api/v1/integration-registrations/{registrationId}`.

Record health checks from your monitoring pipeline:

```http
POST /api/v1/integration-registrations/{registrationId}/health-check
Authorization: Bearer <admin-token>
Content-Type: application/json

{ "statusCode": "healthy" }
```

Valid status codes: `healthy`, `degraded`, `unhealthy`.

View exchange history:

```http
GET /api/v1/integration-exchanges?registrationId={registrationId}
Authorization: Bearer <admin-token>
```

### Replay and backfill

If your endpoint supports replay (`replaySupported: true`), you can request a backfill:

```http
POST /api/v1/integration-registrations/{registrationId}/replay
Authorization: Bearer <admin-token>
Content-Type: application/json

{ "fromDate": "2026-01-01T00:00:00.000Z" }
```

This creates a `replay-backfill` exchange record with status `requested`. Your integration is responsible for processing the backfill once the request is received.

---

## REST API Integration

See [`rest-api-guide.md`](rest-api-guide.md) for the full reference. Key points for integrators:

- Base URL: `https://{tenant-host}/api/v1/`
- All responses are `application/json`; errors follow [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) problem detail format
- Paginated list endpoints use `limit` and `cursor` query parameters
- Every mutating operation produces a stable `operationId` in the response; use this for idempotent retries

### Integration-class endpoints

These REST endpoints are specifically designed for system-to-system integration (marked `INT` in the contract inventory):

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/module-registrations/:id/marks` | VLE or mark ingest |
| `POST /api/v1/students/:id/adjustments` | Wellbeing adjustment ingest |
| `POST /api/v1/students/:id/exceptional-circumstances` | Wellbeing EC ingest |
| `POST /api/v1/students/:id/misconduct-outcomes` | Misconduct outcome ingest |
| `POST /api/v1/regulatory/ucas/applications` | UCAS application ingest |
| `POST /api/v1/regulatory/ucas/confirmations/generate` | UCAS confirmation trigger |
| `POST /api/v1/regulatory/hesa/returns/:id/validation-reports` | HESA validation report ingest |
| `POST /api/v1/regulatory/slc/confirmations/generate` | SLC confirmation trigger |
| `POST /api/v1/regulatory/slc/notifications` | SLC inbound payment notification |
| `POST /api/v1/regulatory/ukvi/cas-requests` | UKVI CAS application |
| `POST /api/v1/regulatory/ukvi/attendance-reports` | UKVI attendance submission |
| `POST /api/v1/regulatory/ukvi/visa-updates` | UKVI visa status update inbound |

---

## Event Subscription

See [`event-consumer-guide.md`](event-consumer-guide.md) for the full reference. Key points:

- Events are published to NATS JetStream on subjects of the form `srs.{domain}.{event}`
- Every event carries the standard envelope: `id`, `subject`, `version`, `tenantId`, `occurredAt`, `actorId`, `correlationId`, `payload`
- Subscribe with a durable consumer group to get at-least-once delivery with replay support
- Validate every payload against the schema at `schemas/events/{domain}/{event}.v1.json`

### Selecting events

The full event taxonomy is in [`contract-index.md`](contract-index.md). For each domain:

| Domain | Events | Typical consumers |
|--------|--------|------------------|
| `srs.student.*` | Identity, enrolment, status, disability | VLE, Finance, IAM |
| `srs.enrolment.*` | Module registration, fee liability | VLE, Finance |
| `srs.catalogue.*` | Programme, module, learning outcome | VLE, Timetabling |
| `srs.assessment.*` | Marks, results | BI, Transcript |
| `srs.adjustment.*` | Approved, distributed, expired | Wellbeing, Venue |
| `srs.circumstances.*` | EC, misconduct | Wellbeing, BI |
| `srs.governance.*` | Exam boards, exam schedules | Timetabling, Transcript |
| `srs.progression.*` | Progression decisions | Transcript, CRM |
| `srs.award.*` | Awards conferred | Transcript, Alumni |
| `srs.regulatory.*` | Statutory exchange events | Adapters, BI |

Internal events (`srs.workflow.*`, `srs.enrolment.downstream-trigger-created`) are not published externally.

---

## File Exchange

See the individual spec documents in [`file-contracts/`](file-contracts/) for schemas, field mappings, and validation rules. Key points:

- All file exchanges are mediated through the REST API — there is no FTP/SFTP at the SRS layer
- Every exchange is identified by an `idempotencyKey`; re-submitting with the same key is safe
- JSON schemas in `schemas/file-contracts/` validate payloads before acceptance

| Contract | Direction | Pattern |
|----------|-----------|---------|
| UCAS Admissions Exchange | Inbound (applications) + Outbound (confirmations) | REST API JSON |
| HESA Student Return | Outbound (XML), Inbound (validation report) | REST API XML/JSON |
| SLC Enrolment Exchange | Outbound (confirmations), Inbound (notifications) | REST API JSON |
| UKVI Sponsor Compliance | Outbound (CAS, attendance), Inbound (visa updates) | REST API JSON |
| Exam Scheduling | Outbound (entries), Inbound (schedule) | File exchange |

---

## Contract Versioning and Deprecation

### Versioning

Each integration contract has a `currentContractVersion` (semver). Registrations snapshot the version at registration time in `contractVersion`. The SRS follows these rules:

- **Patch** (1.0.x): backwards-compatible bug fixes; no integration changes required
- **Minor** (1.x.0): backwards-compatible additions (new optional fields); existing integrations remain valid
- **Major** (x.0.0): breaking change; a new `contractId` version is published (e.g. `exam-scheduling.v2`); old version enters a grace period

### Deprecation

When a contract is deprecated, its `deprecatedAt` field is set. Deprecated contracts:

- No longer accept new registrations (attempt returns 422)
- Existing registrations continue to function during the grace period
- Are removed from the catalogue after the grace period ends

Check `deprecatedAt` when listing contracts. Migrate your registration to the replacement contract before the grace period expires.

### Minimum supported version

If `minimumSupportedVersion` is set on a contract, registrations on older versions of the payload schema may receive degraded service. The SRS may reject payloads that reference fields removed before `minimumSupportedVersion`.

---

## Environment Promotion and Endpoint Safety

Revelation SRS supports multiple deployment environments: `local`, `dev`, `test`, `staging`, `prod`.

Each registration has an `endpointSafetyClass`:

| Class | What it means | Can enable in non-prod? |
|-------|---------------|------------------------|
| `simulator` | Internal stub or sandbox | Yes |
| `external-test` | External system in test mode | Yes |
| `external-production` | Live external system | No — requires `liveTrafficApproved: true` AND prod environment |

**Promotion workflow**:

1. Register with `endpointSafetyClass: simulator` in your local/dev environment.
2. Test with `endpointSafetyClass: external-test` against your external test system.
3. When ready, set `liveTrafficApproved: true` and change `endpointSafetyClass: external-production`.
4. The SRS allows enabling in prod only once both conditions are met.

This prevents accidentally routing live student data to a test system during staging validation.

---

## Error Handling, Retries, Idempotency, and Reconciliation

### Error format

All errors follow RFC 7807 problem detail:

```json
{
  "type": "validation-error",
  "title": "Validation Error",
  "status": 422,
  "detail": "Integration contract 'legacy-api.v0' is deprecated and cannot accept new registrations"
}
```

| Status | Meaning | Retry? |
|--------|---------|--------|
| 400 | Malformed request | No — fix the request |
| 401 | Token expired or missing | Yes — refresh token and retry |
| 403 | Permission denied | No — check roles |
| 404 | Resource not found | No — verify IDs |
| 409 | Conflict (idempotent re-submit, already processed) | No — treat as success |
| 422 | Validation error (business rule) | No — fix the payload |
| 429 | Rate limited | Yes — back off exponentially |
| 500 | SRS internal error | Yes — back off and retry |
| 503 | Service unavailable | Yes — back off and retry |

### Idempotency

Every mutating REST endpoint accepts an `Idempotency-Key` header. Re-submitting a request with the same key within the idempotency window (24 hours) returns the original response without re-processing.

```http
POST /api/v1/module-registrations/{id}/marks
Idempotency-Key: vle-mark-submit-{sessionId}-{studentId}-{moduleCode}
```

Choose idempotency keys that are stable and deterministic for the operation — never use random UUIDs. Use the natural business key (student ID + module + assessment component + attempt).

File exchange endpoints use a dedicated `idempotencyKey` field in the request body.

### Retries

Use exponential back-off with jitter for 5xx and 429 responses:

```
base_delay = 1s
max_delay  = 60s
delay(n)   = min(base_delay × 2^n + jitter(0..1s), max_delay)
```

Do not retry 4xx responses (except 401 and 429) — they indicate a client error.

### Reconciliation

For critical workflows (mark submission, fee liability, statutory returns), implement a reconciliation pass:

1. After your primary operation, record the SRS resource ID in your system.
2. On a scheduled basis (e.g. nightly), query the SRS to verify the expected state.
3. If drift is detected, use the exchange audit trail (`GET /api/v1/integration-exchanges`) to diagnose.
4. For events, use the dead-letter subject (`srs.dlq.*`) to find unprocessed messages.

---

## Local Development and Test Fixtures

### Running the SRS locally

```bash
# Start dependencies (PostgreSQL, NATS)
docker compose up -d

# Run migrations and seed
pnpm --filter @revelation-srs/db migrate

# Start the API
pnpm --filter @revelation-srs/api dev
```

The API runs at `http://localhost:3000`. Interactive OpenAPI docs are available at `GET /api/v1/docs` in development mode.

### Test JWTs

In local and test environments, the API accepts HS256 JWTs signed with `JWT_SECRET`. Generate a test token:

```javascript
import { createHmac } from 'node:crypto';

function makeTestJwt(tenantId, roles, secret = 'your-local-secret') {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub:        'test-integrator-001',
    tenant_id:  tenantId,
    realm_roles: roles,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
```

### Test data

Integration test fixtures are in `apps/api/test/`. Each domain has seeded value sets and example records. Use the test-app helpers (`test/helpers/test-app.ts`) to spin up an isolated Postgres container for your own integration tests.

### Schema validation

Validate event payloads against the schemas in `schemas/events/`:

```javascript
import Ajv from 'ajv';
import schema from './schemas/events/enrolment/module-registered.v1.json' assert { type: 'json' };

const ajv = new Ajv();
const validate = ajv.compile(schema);
if (!validate(payload)) throw new Error(validate.errors);
```

Validate file-exchange payloads against `schemas/file-contracts/`.

---

## Integration Patterns

### First-party module pattern

First-party modules are internal platform extensions (Wellbeing, Finance, Assessment Venue) that run within the institutional platform boundary.

**Characteristics**:
- Same Keycloak realm; elevated permissions granted explicitly
- Consumes internal-class REST endpoints and all event subjects
- Posts adjustment, EC, and misconduct data directly via integration-class REST endpoints
- Can read special-category data (disability declarations, EC records) under specific permission grants
- Deployed and managed by the institution or platform vendor; not subject to external API rate limits

**Registration**: create an integration registration with `endpointSafetyClass: simulator` (internal) or `external-test` (if calling an external system from within the module).

See [`examples/wellbeing-integration.md`](examples/wellbeing-integration.md) for a worked example.

### External integration pattern

External integrations (VLE, CRM, BI warehouse, library system) connect over the published external surface only.

**Characteristics**:
- Separate Keycloak client with restricted role assignments
- Consumes only `PUB`-class REST endpoints and published events
- Cannot read special-category data without explicit grant
- Subject to rate limiting and connection quotas
- Must register via the plugin registry before going live

**Lifecycle**:
1. Obtain client credentials from the institution's registry administrator.
2. Create an integration registration (or request one from the registry administrator).
3. Develop against a local/dev SRS instance with simulator safety class.
4. Validate against an external-test endpoint.
5. Request `liveTrafficApproved: true` from the registry administrator.
6. Enable the registration in production.

See [`examples/vle-integration.md`](examples/vle-integration.md) for a worked example.

---

## Common Integration Examples

| Integration | Pattern | Guide |
|-------------|---------|-------|
| VLE — course provisioning and mark submission | Events + REST | [`examples/vle-integration.md`](examples/vle-integration.md) |
| Finance — fee liability and payment/hold updates | Events + REST | [`examples/finance-integration.md`](examples/finance-integration.md) |
| UCAS / HESA / SLC / UKVI statutory exchanges | File exchange | [`examples/statutory-exchanges.md`](examples/statutory-exchanges.md) |
| Wellbeing — first-party adjustments and EC | REST (first-party) | [`examples/wellbeing-integration.md`](examples/wellbeing-integration.md) |

---

## Getting Help

- OpenAPI spec (machine-readable): `apps/api/openapi/v1.json`
- Live interactive docs: `GET /api/v1/docs` (development only)
- Event schema registry: `schemas/events/registry.json`
- File contract registry: `schemas/file-contracts/registry.json`
- Contract index: [`contract-index.md`](contract-index.md)
- Issues: https://github.com/your-org/revelation-srs/issues
