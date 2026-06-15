# Revelation SRS REST API Guide

> Phase 7 — Stage 1
> Status: Current
> OpenAPI spec: `apps/api/openapi/v1.json`
> Live interactive docs: `GET /api/v1/docs` (development environments only)

---

## Overview

The Revelation SRS REST API exposes the student records system to authenticated consumers over HTTPS. This guide covers:

- authentication and tenant context
- URL conventions, versioning, and content type
- pagination and filtering
- error handling and RFC 7807 problem details
- idempotency and safe retries
- publication classification and which surfaces to integrate with
- rate limiting and client guidance

The committed OpenAPI 3.1 specification at `apps/api/openapi/v1.json` is the authoritative contract for all REST surfaces. The spec is generated from the live route registration and must not drift from the runtime. CI enforces this via the Stage 1 drift detection tests.

---

## Base URL

```
https://{tenant-host}/api/v1/
```

All API resources live under `/api/v1`. There is no `/api/v0` — the version is part of the path and will increment for breaking changes.

---

## Authentication

All API requests require a Bearer JWT in the `Authorization` header:

```http
Authorization: Bearer <token>
```

### Obtaining a token

Revelation SRS uses Keycloak as its identity provider. Request a token from the Keycloak realm associated with your institution:

```http
POST https://keycloak.{tenant-host}/realms/{realm}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={your-client-id}
&client_secret={your-client-secret}
```

The response includes `access_token` (JWT Bearer token) and `expires_in` (seconds until expiry).

### JWT structure

Revelation SRS reads these claims from the token:

| Claim | Type | Purpose |
|---|---|---|
| `sub` | string (UUID) | Principal identifier — used for audit records |
| `srs_tenant_id` | string (UUID) | Tenant scope — all queries are filtered to this tenant |
| `srs_roles` | string[] | Role list — determines which operations are permitted |
| `exp` | number | Expiry — tokens must not be reused past this timestamp |

Tokens without a valid `srs_tenant_id` claim are rejected with `401 Unauthorized`.

### Role requirements

Operations vary in the role level required:

| Publication class | Minimum role |
|---|---|
| `public` | `srs:reader` |
| `integration` | `srs:integration` |
| `workflow` | `srs:staff` |
| `admin` | `srs:tenant-admin` |
| `system` | `srs:platform-admin` |
| `reporting` | `srs:regulatory` |

Attempting an operation without the required role returns `403 Forbidden`.

---

## Tenant Context

Every request is automatically scoped to the tenant identified by `srs_tenant_id` in the JWT. This means:

- you cannot read or write data belonging to another tenant even if you know the UUID
- there is no `?tenant=` query parameter or `X-Tenant-ID` header — tenant context comes exclusively from the token
- API responses never include data from other tenants

---

## URL Conventions

```
GET    /api/v1/{resource}                    List a resource collection
POST   /api/v1/{resource}                    Create a new resource
GET    /api/v1/{resource}/{id}               Retrieve a single resource
PATCH  /api/v1/{resource}/{id}               Partial update (JSON Merge Patch semantics)
PUT    /api/v1/{resource}/{id}               Full replacement (rare)
DELETE /api/v1/{resource}/{id}               Remove a resource
POST   /api/v1/{resource}/{id}/{action}      Trigger a workflow action
```

All resource identifiers are **UUIDs** (RFC 4122). Sequential IDs are never exposed externally.

Resource names are **plural kebab-case**: `students`, `enrolments`, `module-registrations`, `exam-boards`.

### Action endpoints

Where an operation is not a simple CRUD operation, a verb-noun suffix is used:

```
POST /api/v1/enrolments/:enrolmentId/progression
POST /api/v1/exam-boards/:boardId/ratification
POST /api/v1/regulatory/hesa/returns/:returnId/submit
POST /api/v1/enrolments/:enrolmentId/slc-status-notification
```

Action endpoints have publication class `workflow` — see [Publication classification](#publication-classification) below.

---

## Content Type

All request and response bodies use `application/json`. Set the request header:

```http
Content-Type: application/json
Accept: application/json
```

File download endpoints (for example, HESA XML returns) use `application/xml` or `application/octet-stream` as indicated in the OpenAPI spec.

---

## Pagination

Collection endpoints that can return large result sets support cursor-based pagination via query parameters:

| Parameter | Type | Description |
|---|---|---|
| `limit` | integer (1–500, default 50) | Maximum records per page |
| `cursor` | string (opaque) | Pagination cursor from the previous response `nextCursor` field |

A paginated response includes:

```json
{
  "data": [ ... ],
  "nextCursor": "eyJpZCI6IjEyM..."
}
```

When `nextCursor` is absent or `null`, there are no further pages.

**Do not** use `offset`-based pagination (`?offset=100&limit=50`) — offset is not supported and offsets are not stable under concurrent writes.

---

## Filtering and Sorting

Where filtering is supported, parameters are documented per endpoint in the OpenAPI spec. Common patterns:

```
GET /api/v1/students?status=active
GET /api/v1/enrolments?programmeId=uuid&academicYearCode=2024-25
GET /api/v1/module-registrations?moduleOfferingId=uuid
```

Filters are applied with `AND` semantics. There is no free-text search across the REST layer — use the reporting surfaces or dedicated search APIs for full-text queries.

Sorting is not currently configurable at the API layer. Collections are ordered by a stable, deterministic field (typically creation timestamp or a natural ordering) as documented per resource in the OpenAPI spec.

---

## Bitemporality

Several core resources (`enrolments`, `marks`, `module-registrations`, `module-results`, `progression-decisions`, `awards`, `academic-rules`) are **bitemporal**: they record both when something was true in the world (valid time) and when it was recorded in the system (system time).

By default, `GET` operations return the **current effective record** — the record that is both currently valid and currently the active system record.

Bitemporal history is available via history endpoints:

```
GET /api/v1/enrolments/:enrolmentId/history
GET /api/v1/marks/:markId/history
GET /api/v1/module-registrations/:moduleRegistrationId/history
```

History responses include all versions with `validFrom`, `validTo`, `recordedAt`, and `recordedUntil` timestamps.

Do not attempt to reconstruct point-in-time state by filtering history records — this is the responsibility of the SRS service layer. Use history endpoints for audit and traceability only.

---

## Errors

All errors use [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) Problem Details format:

```json
{
  "type": "https://srs.example.com/errors/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "Module offering is not available for the requested academic period",
  "instance": "/api/v1/module-registrations",
  "correlationId": "01931abc-def0-7000-a123-456789abcdef",
  "errors": {
    "moduleOfferingId": ["not available for academic period 2024-25"]
  }
}
```

### Error fields

| Field | Description |
|---|---|
| `type` | URI identifying the error category — stable across versions |
| `title` | Human-readable summary of the error |
| `status` | HTTP status code |
| `detail` | Specific description of this occurrence |
| `instance` | The request path that triggered the error |
| `correlationId` | Request ID for log correlation — include in support requests |
| `errors` | (validation errors only) field-level detail as an object of field → message arrays |

### Status codes

| Code | Meaning |
|---|---|
| `200 OK` | Successful read or synchronous action |
| `201 Created` | Resource created — `Location` header contains the new resource URL |
| `204 No Content` | Successful action with no response body |
| `400 Bad Request` | Malformed request body or invalid parameter type |
| `401 Unauthorized` | Missing or expired JWT |
| `403 Forbidden` | Valid JWT but insufficient role for this operation |
| `404 Not Found` | Resource does not exist or is not visible to this tenant |
| `409 Conflict` | State conflict — for example, duplicate submission |
| `422 Unprocessable Entity` | Request is syntactically valid but semantically invalid (domain validation failure) |
| `429 Too Many Requests` | Rate limit exceeded — see [Rate limiting](#rate-limiting) |
| `503 Service Unavailable` | Upstream dependency (database, workflow engine) is unavailable |

---

## Idempotency

`GET`, `PUT`, and `DELETE` are safe or idempotent by design. `PATCH` is idempotent when applied to the same effective record.

`POST` requests creating new resources are **not** idempotent by default. For workflow command endpoints (publication class `workflow`), duplicate submission may result in a `409 Conflict` if the same command was already accepted.

For high-stakes `POST` operations, pass an `Idempotency-Key` header (a UUID you generate) to enable safe retries:

```http
POST /api/v1/regulatory/hesa/returns
Idempotency-Key: 01931abc-0000-7000-a000-000000000001
```

If the same key is received within 24 hours, the original response is returned without re-executing the operation. Idempotency key support is noted in the OpenAPI spec per operation where available.

---

## Rate Limiting

The API applies rate limiting per authenticated principal (tenant × user):

| Limit | Window |
|---|---|
| 1,000 requests | 60 seconds |

Rate limit status is returned in response headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1718352000
```

When the limit is exceeded, the API returns `429 Too Many Requests` with a `Retry-After` header indicating the number of seconds to wait.

---

## Publication Classification

Every operation in the OpenAPI spec carries an `x-publication-class` extension indicating its intended consumer and publication scope:

| Class | Description | Consumer |
|---|---|---|
| `public` | Core student record surface | Any authenticated principal with `srs:reader` |
| `integration` | Adjacent-system connectivity (adjustments, communications) | Integration partners with `srs:integration` |
| `workflow` | State-machine command endpoints | Staff and system integrators with `srs:staff` |
| `admin` | Tenant-scoped configuration and workflow runtime | Tenant administrators with `srs:tenant-admin` |
| `system` | Platform-level controls, cross-tenant configuration | Platform administrators only |
| `reporting` | Regulatory submission data and compliance extracts | Regulatory teams and BI systems |
| `private` | Internal routing surfaces | Not for external consumers — not published |

Third-party integrations should target `public` and `integration` surfaces for data reads, and `workflow` surfaces for driving enrolment and assessment lifecycle events.

---

## Versioning and Deprecation

The current API version is **v1**. The version is part of the URL path:

```
/api/v1/students
```

Breaking changes (removed fields, changed semantics, incompatible URL changes) will increment the major version to `/api/v2`. Non-breaking additions (new optional fields, new endpoints) may be made within the same version.

Deprecated operations are indicated in the OpenAPI spec with the `deprecated: true` flag and a `x-deprecation-notice` extension explaining the replacement and the date from which the operation will be removed.

The changelog for each API version is maintained in `docs/architecture/api-standards.md`.

---

## OpenAPI Spec and Interactive Docs

The committed OpenAPI 3.1 specification is at:

```
apps/api/openapi/v1.json
```

This file is the stable, published contract. It is generated from the live Fastify route registration and validated in CI to prevent drift.

Interactive Swagger UI is available in development environments at:

```
GET /api/v1/docs
```

The machine-readable spec is available at runtime:

```
GET /api/v1/openapi.json
```

### Regenerating the spec

After adding or changing routes, regenerate the committed spec:

```bash
pnpm --filter @revelation-srs/api generate:openapi
```

Then commit the updated `openapi/v1.json`. The CI drift detection test will fail if the committed spec does not match the live route registration.

---

## Common Patterns

### Creating a student and enrolment

```http
POST /api/v1/students
Authorization: Bearer {token}
Content-Type: application/json

{
  "givenName": "Jane",
  "familyName": "Smith",
  "dateOfBirth": "2003-09-12",
  "nationalityCode": "GBR"
}
```

Response `201 Created` with `Location: /api/v1/students/{personId}`.

```http
POST /api/v1/enrolments
Authorization: Bearer {token}
Content-Type: application/json

{
  "personId": "{personId}",
  "programmeId": "{programmeId}",
  "academicYearCode": "2025-26",
  "modeOfStudyCode": "full-time"
}
```

### Reading an enrolment with bitemporal history

```http
GET /api/v1/enrolments/{enrolmentId}
Authorization: Bearer {token}
```

```http
GET /api/v1/enrolments/{enrolmentId}/history
Authorization: Bearer {token}
```

### Submitting a HESA return

```http
POST /api/v1/regulatory/hesa/returns
Authorization: Bearer {token}
Content-Type: application/json

{
  "academicYearCode": "2024-25",
  "returnTypeCode": "student"
}
```

Then trigger submission:

```http
POST /api/v1/regulatory/hesa/returns/{returnId}/submit
Authorization: Bearer {token}
```

---

## Support

For API questions, integration support, or to report issues, use the project issue tracker at the repository homepage.

Include the `correlationId` from error responses in any support request — this maps to the server log entry for the failed request.
