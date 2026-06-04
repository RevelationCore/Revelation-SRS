# API Design Standards

> Status: Draft — Phase 2
> Last updated: 2026-06-04
> These standards govern every REST API endpoint in Revelation SRS. All API surfaces — Core, first-party modules, and adapters — conform to this specification.

---

## URL Structure

```
/api/v{N}/{resource}
/api/v{N}/{resource}/{id}
/api/v{N}/{resource}/{id}/{sub-resource}
```

| Segment | Rule |
|---|---|
| `/api` | Constant prefix for all REST endpoints |
| `/v{N}` | Major version integer. Current: `v1` |
| `{resource}` | Plural noun, kebab-case: `students`, `module-registrations` |
| `{id}` | UUID (never expose sequential IDs) |
| `{sub-resource}` | Nested resource that only exists in the context of the parent |

### Examples

```
GET    /api/v1/students
GET    /api/v1/students/:studentId
GET    /api/v1/students/:studentId/enrolments
POST   /api/v1/students/:studentId/enrolments
GET    /api/v1/enrolments/:enrolmentId/module-registrations
POST   /api/v1/module-registrations/:id/withdrawal
GET    /api/v1/exam-boards/:id/data-pack
POST   /api/v1/exam-boards/:id/ratify
```

### Actions

Where an operation is not a simple CRUD operation on a resource, use a **verb-noun action suffix**:

```
POST /api/v1/exam-boards/:id/ratify
POST /api/v1/enrolments/:id/withdraw
POST /api/v1/enrolments/:id/intermit
POST /api/v1/module-registrations/:id/withdrawal
POST /api/v1/hesa-returns/:id/submit
```

---

## HTTP Methods

| Method | Usage | Body | Idempotent |
|---|---|---|---|
| `GET` | Retrieve resource(s); never modifies state | None | Yes |
| `POST` | Create a new resource or trigger an action | JSON | No |
| `PUT` | Replace a resource completely (rare) | JSON | Yes |
| `PATCH` | Partial update of a resource | JSON Merge Patch | No |
| `DELETE` | Remove a resource (only via approved workflow) | None | Yes |

`PATCH` is preferred over `PUT` for updates. `PUT` is reserved for idempotent full replacements (e.g. configuration objects).

---

## Request Format

All request bodies are `Content-Type: application/json`.

### Route schema (Fastify, schema-first)

Every route declares its JSON Schema at definition time. Fastify validates all inbound requests before the handler runs. No handler reads an unvalidated input.

```typescript
// Example route definition
fastify.post<{ Params: { studentId: string }; Body: CreateEnrolmentBody }>(
  '/students/:studentId/enrolments',
  {
    schema: {
      params: Type.Object({ studentId: Type.String({ format: 'uuid' }) }),
      body:   CreateEnrolmentSchema,          // Typebox schema
      response: { 201: EnrolmentResponseSchema },
    },
  },
  async (request, reply) => { ... }
);
```

All schemas are defined using `@sinclair/typebox` (TypeScript-first JSON Schema builder). Schemas are shared between routes and OpenAPI generation — they are the single source of truth.

---

## Response Format

### Success responses

| Status | Meaning | Body |
|---|---|---|
| `200 OK` | Read or action succeeded | Resource object or action result |
| `201 Created` | Resource created | Created resource object; `Location` header set |
| `202 Accepted` | Async operation accepted | `{ jobId, statusUrl }` |
| `204 No Content` | Operation succeeded, nothing to return | Empty |

Single resource:
```json
{
  "id": "...",
  "studentNumber": "...",
  ...
}
```

Collection:
```json
{
  "data": [ { ... }, { ... } ],
  "pagination": {
    "cursor": "eyJpZCI6Ii4uLiJ9",
    "hasMore": true,
    "total": 1423
  }
}
```

### Error responses — RFC 7807 Problem Details

All error responses use [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) (`Content-Type: application/problem+json`).

```json
{
  "type":     "https://srs.example.com/errors/validation-error",
  "title":    "Validation Error",
  "status":   422,
  "detail":   "The request body failed validation.",
  "instance": "/api/v1/students/abc/enrolments",
  "errors": [
    { "field": "programmeId", "message": "Must be a valid UUID" }
  ],
  "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479"
}
```

| Status | `type` suffix | Usage |
|---|---|---|
| `400` | `bad-request` | Malformed JSON or missing required field |
| `401` | `unauthorized` | Missing or invalid authentication token |
| `403` | `forbidden` | Authenticated but insufficient permissions |
| `404` | `not-found` | Resource does not exist within tenant scope |
| `409` | `conflict` | State conflict (e.g. trying to modify a locked record) |
| `422` | `validation-error` | JSON Schema validation failure |
| `429` | `rate-limited` | Too many requests |
| `500` | `internal-error` | Unhandled server error (no internal detail exposed) |
| `503` | `service-unavailable` | Dependency unavailable |

The `correlationId` is always included and matches the `X-Correlation-ID` response header.

---

## Pagination

All list endpoints use **cursor-based pagination** (not offset). Cursor pagination is stable under concurrent inserts and deletions.

### Request parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `cursor` | `string` | — | Opaque cursor from previous response |
| `limit` | `integer` | `20` | Max items per page (max: `100`) |
| `sort` | `string` | Resource default | Sort field(s), e.g. `sort=familyName,-createdAt` |

The cursor is a base64-encoded JSON object containing the sort key values of the last item in the previous page. It is opaque to clients; do not construct or parse cursors directly.

### Response

```json
{
  "data": [ ... ],
  "pagination": {
    "cursor":   "eyJpZCI6IjEyMzQ1In0=",
    "hasMore":  true,
    "total":    1423
  }
}
```

`total` is included where inexpensive to compute (primary key lookups). For large result sets with complex filters, `total` may be omitted and `hasMore` used alone.

---

## Filtering and Sorting

### Filtering

Filter parameters use the field name as the query parameter key:

```
GET /api/v1/students?status=enrolled&facultyCode=SCI
GET /api/v1/module-registrations?academicYear=2024-25&enrolmentId=:id
```

Range filters use `{field}From` / `{field}To`:

```
GET /api/v1/students?createdAtFrom=2024-09-01&createdAtTo=2024-09-30
```

### Bitemporal queries

List endpoints that operate on bitemporal data accept two optional query parameters:

| Parameter | Default | Description |
|---|---|---|
| `asOf` | `NOW()` | Point-in-time for both valid and transaction time |
| `validAt` | `asOf` | Override valid-time axis independently |
| `recordedAt` | `asOf` | Override transaction-time axis independently |

```
GET /api/v1/students/:id/enrolments?validAt=2023-09-01
GET /api/v1/enrolments/:id?validAt=2023-06-01&recordedAt=2023-07-15
```

### Sorting

`sort` accepts a comma-separated list of field names. Prefix with `-` for descending:

```
sort=familyName          # ascending
sort=-createdAt          # descending
sort=familyName,-createdAt  # compound
```

---

## OpenAPI Toolchain

### Generation

OpenAPI 3.1 specifications are **generated from route schemas** using `@fastify/swagger`. They are never hand-written. The spec is generated at build time and committed to the repository at `apps/api/openapi/v1.json`.

### Serving

`@fastify/swagger-ui` serves a Swagger UI at `/api/docs` in development and staging environments. It is disabled in production.

### Contract testing

`dredd` runs against the committed OpenAPI spec in CI, making real requests to a locally started application instance. A test that passes in Dredd proves the implementation matches the published spec.

### Client generation

Frontend applications import generated TypeScript types from the OpenAPI spec using `openapi-typescript`. This ensures frontend types always reflect the current API contract without manual sync.

```
packages/domain/src/api-types/v1.d.ts   ← generated; do not edit
```

---

## Common Headers

### Request headers

| Header | Usage |
|---|---|
| `Authorization: Bearer {token}` | JWT access token (required on all endpoints) |
| `X-Correlation-ID` | Optional; if provided, echoed in response and all logs |
| `Content-Type: application/json` | Required for all POST/PUT/PATCH requests |

### Response headers

| Header | Always present | Description |
|---|---|---|
| `X-Correlation-ID` | Yes | Assigned if not provided by client |
| `X-Request-ID` | Yes | Server-generated unique request ID |
| `Location` | On 201 | URL of the created resource |
| `Deprecation` | When applicable | Date the endpoint version is deprecated |
| `Sunset` | When applicable | Date the endpoint version is removed |

---

## Rate Limiting

Rate limiting is applied at the tenant level (not per user) by default.

| Tier | Limit | Window |
|---|---|---|
| Default (read) | 1000 req | 60 seconds |
| Default (write) | 200 req | 60 seconds |
| Batch/export | 10 req | 60 seconds |
| Service accounts | Configurable per client | — |

Rate limit headers are always returned:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1717511640
```

On breach: `429 Too Many Requests` with RFC 7807 body and `Retry-After` header.
