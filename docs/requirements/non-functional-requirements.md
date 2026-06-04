# Non-Functional Requirements

> Status: Draft — Phase 1
> Last updated: 2026-06-04
> Each requirement is traced to the core principle(s) from which it is derived. See `docs/core-principles.md`.
> Priority: **M** = Must Have · **S** = Should Have · **C** = Could Have

---

## 1. Performance and Scalability

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-PERF-001 | Interactive API responses (read and write operations on individual records) shall return within 500ms at the 95th percentile under normal operating load. | §17 | M |
| NFR-PERF-002 | The system shall be designed to operate correctly and within performance targets with up to 50,000 enrolled students per tenant. | §17 | M |
| NFR-PERF-003 | Batch and bulk operations (HESA return generation, exam board data pack generation, BI extracts) shall execute asynchronously and shall not degrade interactive API performance. | §17 | M |
| NFR-PERF-004 | The system shall scale horizontally: adding application server instances shall increase overall throughput without requiring architectural changes. | §17 | M |
| NFR-PERF-005 | Performance benchmarks shall be defined, documented, and verified as part of the CI/CD release process. A release failing to meet benchmarks shall not be promoted to production. | §17, §20 | M |
| NFR-PERF-006 | The system shall maintain performance targets during peak load periods, specifically: start-of-year enrolment, results publication, and UCAS Clearing. | §17 | M |
| NFR-PERF-007 | Database query execution time for single-record lookups shall not exceed 50ms at the 95th percentile. | §17 | M |

---

## 2. Availability and Reliability

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-AVAIL-001 | The system shall target 99.5% availability during the institution's defined operational hours (typically 07:00–22:00 Monday–Friday, 09:00–18:00 weekends, excluding agreed maintenance windows). | §18 | M |
| NFR-AVAIL-002 | Planned maintenance windows shall be scheduled outside peak operational periods and communicated to users with a minimum of 48 hours notice. | §18 | S |
| NFR-AVAIL-003 | The system shall implement graceful degradation: if a non-critical integration (e.g. BI feed) is unavailable, core SRS operations shall continue unaffected. | §2, §12 | M |
| NFR-AVAIL-004 | The Recovery Time Objective (RTO) following an unplanned outage shall be no more than 4 hours. | §18 | M |
| NFR-AVAIL-005 | The Recovery Point Objective (RPO) shall be no more than 1 hour — no more than 1 hour of data shall be lost following a failure. | §18 | M |
| NFR-AVAIL-006 | Database backups shall be taken at minimum daily (full) and continuously (WAL streaming). Backup integrity shall be verified by regular restore testing. | §8, §18 | M |

---

## 3. Security

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-SEC-001 | All data in transit shall be encrypted using TLS 1.2 or higher. TLS 1.0 and 1.1 shall be disabled. | §6 | M |
| NFR-SEC-002 | All data at rest (database, backups, file storage) shall be encrypted. | §8 | M |
| NFR-SEC-003 | Authentication tokens shall expire within a configurable period (default: 1 hour for access tokens, 8 hours for refresh tokens). | §6 | M |
| NFR-SEC-004 | All API endpoints shall reject unauthenticated requests with a 401 response. There shall be no publicly accessible data endpoints. | §6 | M |
| NFR-SEC-005 | The system shall enforce a maximum failed authentication attempt limit before temporarily locking the account, with configurable thresholds per tenant. | §6 | M |
| NFR-SEC-006 | Secrets (database credentials, API keys, certificates) shall never be stored in source code, container images, or unencrypted configuration files. | §6 | M |
| NFR-SEC-007 | Container images shall be scanned for known vulnerabilities (CVEs) at build time. Critical or high severity vulnerabilities shall block deployment. | §9, §20 | M |
| NFR-SEC-008 | The system shall undergo SAST analysis on every pull request. Security findings at high or critical severity shall block merge. | §20 | M |
| NFR-SEC-009 | The system shall undergo DAST scanning against a running environment prior to each major release. | §20 | S |
| NFR-SEC-010 | Tenant data isolation shall be enforced at the PostgreSQL row-level security layer. A penetration test verifying cross-tenant data isolation shall be performed prior to production release. | §6, §10 | M |
| NFR-SEC-011 | The system shall not expose internal stack traces or database error details in API responses to clients. | §6 | M |

---

## 4. Data Integrity and Bitemporality

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-DATA-001 | All temporal data shall be stored with valid-time and transaction-time columns. No temporal record shall be modified destructively; prior states shall be recoverable through point-in-time queries. | §3 | M |
| NFR-DATA-002 | Referential integrity between related entities shall be enforced at the database layer via foreign key constraints. Application-layer enforcement alone is not sufficient. | §8 | M |
| NFR-DATA-003 | Domain constraints (not null, check constraints, unique constraints) shall be declared in the database schema. | §8 | M |
| NFR-DATA-004 | Database schema changes shall be applied through version-controlled, deterministic migration scripts. Ad hoc schema changes to production databases are prohibited. | §8 | M |
| NFR-DATA-005 | The system shall be capable of reconstructing any past state of any student record (enrolment, results, adjustments, progression) using the bitemporal record. | §3 | M |
| NFR-DATA-006 | The system shall be capable of reconstructing the institutional rules (assessment regulations, classification algorithm) that were in force at any given date. | §3, §13 | M |

---

## 5. Audit

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-AUD-001 | Audit records shall be written atomically with the data change they record. There shall be no window in which a data change exists without a corresponding audit record. | §5 | M |
| NFR-AUD-002 | Audit records shall be stored in a dedicated append-only table with no DELETE or UPDATE permissions granted to any application role. | §5 | M |
| NFR-AUD-003 | The audit trail shall be retained for the lifetime of the student record plus the applicable regulatory retention period (minimum 6 years post-graduation). | §5, §16 | M |
| NFR-AUD-004 | The system shall record the identity of the authenticated actor responsible for every change, including automated system processes and integration events. | §5 | M |

---

## 6. Privacy and Data Protection

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-PRIV-001 | All personal data processing shall have a documented lawful basis under UK GDPR, recorded in the data subject register. | §16 | M |
| NFR-PRIV-002 | Special category data (disability, health, exceptional circumstances, safeguarding) shall be subject to access controls more restrictive than standard personal data, requiring explicit role assignment. | §16 | M |
| NFR-PRIV-003 | Each data class shall have a defined retention period. The system shall support automated or managed deletion and anonymisation of data that has passed its retention period, subject to overriding legal obligations. | §16 | M |
| NFR-PRIV-004 | The system shall support the production of a complete and accurate data subject access request response, drawing on the student record, audit trail, and bitemporal history. | §16 | M |
| NFR-PRIV-005 | The system shall support right-to-erasure requests through a workflow that validates the request against any overriding legal obligation (e.g. HESA retention requirements) before executing erasure or anonymisation. | §16 | M |
| NFR-PRIV-006 | Data fields shall be classified by sensitivity tier. The data subject register shall record the classification of each category. | §16 | M |

---

## 7. Accessibility

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-ACC-001 | All user-facing interfaces shall conform to WCAG 2.1 Level AA as a minimum standard. | §15 | M |
| NFR-ACC-002 | All interactive components shall be fully operable by keyboard alone, without requiring a mouse or pointer device. | §15 | M |
| NFR-ACC-003 | All interactive components shall be compatible with assistive technologies including screen readers (NVDA, JAWS, VoiceOver). | §15 | M |
| NFR-ACC-004 | Colour shall not be the sole means of conveying information. All colour-coded information shall have a non-colour alternative (text label, icon, pattern). | §15 | M |
| NFR-ACC-005 | Text shall meet a minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text against their backgrounds. | §15 | M |
| NFR-ACC-006 | Automated accessibility scanning (axe-core) shall run against all UI component trees in CI. Accessibility violations at WCAG 2.1 AA level shall block merge. | §15, §20 | M |
| NFR-ACC-007 | A manual accessibility audit against WCAG 2.1 AA shall be conducted prior to each major release. | §15 | M |
| NFR-ACC-008 | An accessibility statement shall be published and maintained for each user-facing interface. | §15 | M |

---

## 8. Internationalisation

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-I18N-001 | All dates shall be stored and transmitted in UTC. User-facing dates shall be displayed in the institution's configured locale. | §3 | M |
| NFR-I18N-002 | All timestamps in API responses and audit records shall be in ISO 8601 format with explicit UTC offset. | §12 | M |
| NFR-I18N-003 | The system shall support Unicode (UTF-8) for all text fields, including student names and addresses with non-ASCII characters. | — | M |

---

## 9. Observability

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-OBS-001 | All application services shall emit structured JSON logs including a correlation ID on every log entry. | §18 | M |
| NFR-OBS-002 | All application services shall expose Prometheus-compatible metrics covering: request rate, error rate, request latency (p50, p95, p99), and queue depths for message broker consumers. | §18 | M |
| NFR-OBS-003 | Inter-service calls shall propagate OpenTelemetry trace context, enabling end-to-end distributed tracing across all services and integrations. | §18 | M |
| NFR-OBS-004 | All services shall expose `/health` (liveness) and `/ready` (readiness) endpoints consumed by the container orchestrator. | §18 | M |
| NFR-OBS-005 | Alert thresholds shall be defined for critical metrics (error rate, latency, queue depth, disk usage) and maintained in version control alongside the application. | §18 | M |
| NFR-OBS-006 | Logs shall be retained for a minimum of 90 days in the observability stack, configurable per deployment. | §18 | S |

---

## 10. Deployment and Operations

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-OPS-001 | The complete local development environment shall start with a single `docker compose up` command. The setup time from a clean machine shall not exceed 15 minutes. | §9 | M |
| NFR-OPS-002 | Container images shall run as non-root users. No container shall require privileged execution. | §9 | M |
| NFR-OPS-003 | All environment-specific configuration shall be injected via environment variables. No configuration shall be baked into container images. | §9 | M |
| NFR-OPS-004 | Each service shall have a documented operational runbook covering startup, shutdown, common failure scenarios, and diagnostic procedures. | §18 | S |
| NFR-OPS-005 | The system shall support zero-downtime deployments via rolling update strategies. | §9 | S |
| NFR-OPS-006 | Base container images shall be pinned to a specific version and updated on a defined schedule. | §9 | M |

---

## 11. Multi-Tenancy

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-MT-001 | The failure of one tenant's data or configuration shall not affect any other tenant. | §10 | M |
| NFR-MT-002 | A misconfiguration in one tenant's integration adapter shall not propagate errors to or affect other tenants. | §10 | M |
| NFR-MT-003 | Performance degradation caused by one tenant's workload (e.g. a large batch job) shall not materially degrade performance for other tenants. | §10, §17 | S |

---

## 12. Testability and Quality

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-TEST-001 | All pull requests shall pass the full automated test suite (unit, integration, contract, accessibility) before merge is permitted. | §20 | M |
| NFR-TEST-002 | Integration tests shall run against real infrastructure (PostgreSQL, NATS, Temporal) via Testcontainers. Mocking of infrastructure components in integration tests is not permitted. | §20 | M |
| NFR-TEST-003 | Test coverage for domain logic (business rules, progression calculations, classification algorithms) shall be maintained at a minimum of 90% line coverage. | §20 | M |
| NFR-TEST-004 | Each integration contract (REST API, event schema, file format) shall have a corresponding contract test verifying the implementation against the published specification. | §20 | M |
| NFR-TEST-005 | Performance benchmarks (NFR-PERF-001 through NFR-PERF-007) shall be verified by automated load tests run against a staging environment on a scheduled basis. | §17, §20 | M |
| NFR-TEST-006 | TypeScript strict mode shall be enabled. Type errors are build failures and are not exempt from the merge gate. | §20 | M |

---

## 13. Regulatory

| ID | Requirement | Principle | Priority |
|---|---|---|---|
| NFR-REG-001 | The HESA Student Record return shall conform to the current HESA coding manual and pass HESA's published validation rules before submission. | §7 | M |
| NFR-REG-002 | The system shall maintain records sufficient for the institution to demonstrate sponsor licence compliance under UKVI inspection at any time. | §7 | M |
| NFR-REG-003 | The system shall be capable of producing an accurate data subject access request disclosure within the statutory 30-day response window. | §7, §16 | M |
| NFR-REG-004 | The system shall retain student records for the regulatory minimum period: duration of study plus 6 years for academic records; 7 years for financial records; as specified per data class in the data subject register. | §7, §16 | M |
