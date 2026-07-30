# File Contract Specifications

This directory contains formal specifications for every file and structured-data exchange between Revelation SRS and external systems.

A file contract covers:
- the payload format (schema reference or field-by-field description)
- the transport mechanism (REST API, SFTP, HTTPS download)
- authentication and tenant context
- retry, idempotency, and reconciliation expectations
- audit and data-classification requirements

Machine-readable JSON Schema files are in `schemas/file-contracts/`. The registry of all contracts is `schemas/file-contracts/registry.json`.

---

## Index

| Contract | Statutory Body | Flows | Document |
|---|---|---|---|
| UCAS Admissions Exchange | UCAS | F-UCAS-SIS-01, F-SIS-UCAS-01 | [ucas-admissions-exchange.md](ucas-admissions-exchange.md) |
| HESA Student Return | HESA | F-SIS-HESA-01, F-HESA-SIS-01 | [hesa-student-return.md](hesa-student-return.md) |
| SLC Enrolment Exchange | SLC | F-SIS-SLC-01, F-SLC-SIS-01 | [slc-enrolment-exchange.md](slc-enrolment-exchange.md) |
| UKVI Sponsor Compliance | UKVI | F-SIS-UKVI-01, F-UKVI-SIS-01 | [ukvi-sponsor-compliance.md](ukvi-sponsor-compliance.md) |
| Exam Scheduling Exchange | (internal/vendor) | F-SIS-EXAMS-01, F-EXAMS-SIS-01 | [exam-scheduling.md](exam-scheduling.md) |

---

## Common Conventions

### Authentication

All file-contract endpoints require a Keycloak-issued JWT. The token must include the `srs_tenant_id` claim. Regulatory operations require the `regulatory:write` or `regulatory:read` role scope as documented per endpoint.

### Tenant context

All requests are tenant-scoped. The `srs_tenant_id` claim in the JWT determines which tenant's data is operated on. There is no cross-tenant access.

### Idempotency

Every outbound generate endpoint is safe to call multiple times. Calling `generate` again for the same period or batch returns fresh data but does not create duplicate records. Inbound endpoints use an idempotency key (documented per exchange) to deduplicate repeat submissions.

### Audit

Every mutating call is recorded in the audit log with actor identity, correlation ID, entity type, and action. Regulatory events trigger domain events on the NATS JetStream stream — see `docs/integrations/event-consumer-guide.md`.

### Transport profiles

| Profile | Description |
|---|---|
| `https-api` | REST API call over HTTPS. Adapter calls the SRS API directly. Standard for all implemented exchanges. |
| `sftp` | SFTP file drop. Not used in the current implementation; reserved for future bulk-file exchanges. |
| `secure-drop` | Secure file share. Not used in the current implementation. |

### Error responses

All endpoints return RFC 7807 Problem Detail on error:

```json
{
  "type": "https://problems.revelation-srs.io/{error-type}",
  "title": "Human-readable summary",
  "status": 422,
  "detail": "Specific description of what failed"
}
```

### Data classification

All regulatory exchanges carry at minimum `regulatory` data classification. Some carry `personal` (applicant data) or `special-category` (disability information in exam accommodations). Ensure your data handling meets UK GDPR requirements for the classification stated in the contract.
