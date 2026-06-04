# Revelation SRS — Core Principles

> Status: Draft for review
> Last updated: 2026-06-04

This document defines the foundational principles that govern the design, development, and operation of Revelation SRS. These principles apply across all modules, integrations, and deployment contexts and must be respected by any party contributing to or extending the system.

---

## 1. Student Records as the Authoritative System of Record

The Student Information System (SIS) is the single source of truth for all ratified information about a student: who they are, what they are studying, how they are progressing, and what outcomes have been confirmed. No other system may hold a conflicting or parallel authoritative student record.

Domain systems own their processes; confirmed outcomes are always written back to and held by the SIS. Where an inbound integration delivers data that conflicts with an existing SIS record, the conflict must be surfaced, logged, and resolved through a defined reconciliation process — silent overwrites are not permitted.

---

## 2. Pluggable, Modular Architecture

The system is designed for extensibility from inception. All integration points — whether to external institutional systems or to discrete SRS modules — are defined by versioned contracts and routed through the integration layer.

**First-party Revelation SRS modules** are components developed and maintained as part of the Revelation SRS codebase. They are defined by the following criteria: they share the SRS deployment, they are developed against the SRS domain model, and they are covered by the project's release and versioning cycle. First-party modules may integrate directly with the SRS database where that is the most appropriate design, but they must still be independently replaceable — any first-party module can be disabled or substituted without requiring changes to the core SRS.

**External system integrations** are connections to third-party or institutional systems (VLE, Finance, HR, UCAS, etc.). These must always interact through the published integration layer; direct database access by external systems is not permitted.

- **Integration contracts**: every integration point is defined by a versioned contract (REST API, event schema, or file format specification).
- **Backwards compatibility**: breaking changes to integration contracts follow a deprecation policy with a defined notice period. Non-breaking additions do not require a version increment.
- **Plugin registry**: the platform maintains a registry of active integrations, their contract versions, enabled status, and health.
- **Hot-swappable**: any module or integration adapter can be replaced without requiring changes to the core SRS.

This principle underpins compliance with the reference model's logical flow architecture (F001–F070) while allowing institutions to substitute their own system implementations.

---

## 3. Bitemporal Data Integrity

Any data record that may change over time is stored bitemporally, preserving two independent time axes:

- **Valid time**: the period during which a fact was true in the real world (e.g. a student was enrolled on a programme from 1 September to 31 May).
- **Transaction time**: the period during which that fact was recorded in the system (e.g. the enrolment was entered on 3 September; a correction was recorded on 10 October).

This distinction allows the system to answer both "what was true on date X?" and "what did the system believe to be true on date X?", which is essential for regulatory returns, board paper reconstruction, audit, and data subject access requests.

Open-ended records use a null transaction-time end rather than a sentinel date. Valid-time end is null for currently active records.

Bitemporal recording applies to (but is not limited to):

- Student enrolment status and programme registration
- Module registrations
- Tuition fee liability and financial holds
- Reasonable adjustments and exceptional circumstances flags
- Staff assignments (personal tutors, supervisors)
- Institutional rules, assessment regulations, and classification algorithms
- Address and contact data

There is no destructive update of temporal records. Prior states are always recoverable. This principle is distinct from, but complementary to, the audit trail (§5): bitemporal data records *what was true and when*; the audit trail records *who changed it and why*.

---

## 4. Workflow Engine for Long-Running Processes

Business processes that span multiple steps, actors, time periods, or system interactions are managed through a first-class embedded workflow engine. Workflows are not implemented as ad hoc state flags or procedural code.

Each workflow instance records its current state, history of transitions, actor task assignments, deadlines, and the identity of each participant at each step. The workflow engine:

- Supports durable execution — instances survive service restarts.
- Supports human task assignment with notification to assigned actors.
- Enforces deadlines and supports configurable escalation paths.
- Handles step failure with retry and compensating transaction support.
- Writes all state transitions to the audit trail (§5).

Examples of workflow-managed processes include:

- Student admissions (enquiry → application → offer → acceptance → enrolment)
- Reasonable adjustment case management (referral → assessment → approval → SIS distribution)
- Exceptional circumstances submission and determination
- Academic misconduct investigation, panel, and penalty
- Exam board preparation, ratification, and record lock
- Appeals and approved corrections post-ratification

---

## 5. Immutable Audit Trail

Every change to a data record — regardless of origin (user action, system integration, batch process, or workflow step) — generates an immutable audit entry recording:

- **What** changed: the entity, record identifier, and field(s) affected
- **Before** value: the previous state
- **After** value: the new state
- **Who**: the authenticated user or system actor responsible
- **When**: a precise UTC timestamp (transaction time, aligned with §3)
- **Why** (where applicable): a reason code, workflow step reference, or free-text justification

For sensitive data classes (disability declarations, exceptional circumstances, misconduct records, safeguarding flags), read access is also audited, recording who accessed the record and when.

Audit records are append-only and may never be modified or deleted. The audit trail is accessible to authorised administrators and must support regulatory inspection, Freedom of Information requests, and data subject access requests under UK GDPR.

---

## 6. Authentication and Authorisation

All access to the system — human and machine — is authenticated and authorised.

- **Authentication**: the platform integrates with institutional Identity and Access Management (IAM) systems via OAuth 2.0 / OIDC. Multi-factor authentication is supported. Service-to-service integration uses client credentials or signed tokens. A local identity provider is available as a fallback when the institutional IAM is unavailable, scoped to designated service accounts only.
- **Authorisation**: access control is role-based (RBAC) with attribute-based extensions where required. Roles are defined at the application level; group membership is resolved from the institutional directory.
- **Row-level security**: data-access scoping (by institution, faculty, cohort, or individual student) is enforced at the database layer, not application code alone.
- **Least privilege**: every user and integration receives the minimum permissions required to perform its function.
- **API security**: all API endpoints are protected. No unauthenticated endpoints exist outside of publicly documented health and readiness probes.
- **Secrets management**: credentials, certificates, and API keys are managed through a dedicated secrets store; they are never baked into container images or committed to source control.

---

## 7. UK Regulatory Compliance as First-Class Requirements

Statutory and regulatory obligations are treated as core functional requirements, not afterthoughts. The system must natively support:

- **HESA** — annual statutory student data return (Student record)
- **Student Loans Company (SLC)** — enrolment confirmation for tuition fee and maintenance loan disbursement
- **UKVI** — CAS management and attendance compliance under sponsor licence obligations
- **UCAS** — admissions data exchange (application, offer, confirmation, clearing)
- **OfS (Office for Students)** — regulatory conditions including B3 student outcome and experience conditions; access and participation plan reporting
- **UK GDPR / Data Protection Act 2018** — data subject rights, retention schedules, lawful basis management per processing activity
- **Equality Act 2010** — reasonable adjustments and disability accommodation workflows
- **Prevent duty (Counter-Terrorism and Security Act 2015)** — safeguarding obligations and associated record-keeping
- **Freedom of Information Act 2000** — applies to publicly funded HE bodies; information requests must be supportable from system data
- **Consumer protection (CMA guidance)** — accurate and timely course information; transparent terms and conditions for students

Regulatory reporting outputs are derived from the same authoritative data held in the SIS; there are no separate compliance stores. The lawful basis for each category of personal data processing is documented in a data register maintained as part of the system.

---

## 8. Relational Database with Data Integrity Enforcement

The primary persistence layer is a relational database (PostgreSQL). Data integrity is enforced at the database level as well as the application level.

- **Referential integrity** is enforced via foreign key constraints.
- **Domain constraints** (not null, check constraints, unique constraints) are declared in the schema, not only in application code.
- **Row-level security** for data-access scoping is implemented at the database layer (see §6).
- **Schema migrations** are version-controlled and applied deterministically; no manual schema changes are made to production databases.
- **Encryption at rest**: the database and any backup media are encrypted at rest.
- **No destructive deletes**: records subject to audit and temporal history use bitemporal dating and are archived, not deleted, unless a specific and justified exception is documented (e.g. a verified right-to-erasure request under UK GDPR where no overriding legal obligation applies).
- **Auxiliary stores**: non-authoritative stores (e.g. a search index for full-text record discovery, a read-model for analytics) are permissible where justified, provided the relational database remains the system of record and the auxiliary store is derived from it.

---

## 9. Containerised Deployment

All services are containerised. The deployment topology is defined as code and version-controlled alongside the application. A single-command local developer environment is a hard requirement.

- Every service publishes a `Dockerfile` pinned to a specific base image version.
- Environment-specific configuration is injected via environment variables; no configuration is baked into images.
- Secrets are injected via a secrets store, not environment variables (see §6).
- Services run as non-root users inside containers.
- Container images are scanned for known vulnerabilities as part of the CI pipeline.
- Services expose `/health` (liveness) and `/ready` (readiness) endpoints consumed by the orchestrator.
- The deployment topology supports both single-institution (Docker Compose) and multi-institution (Kubernetes) configurations.

---

## 10. Multi-Tenancy and Institutional Isolation

The system is designed from inception to support multiple institutions within a single deployment (multi-tenant SaaS) while guaranteeing complete data isolation between tenants.

- Every data record is scoped to a tenant (institution) identifier.
- Row-level security at the database layer (§8) enforces tenant isolation; application-layer enforcement alone is insufficient.
- Institution-specific configuration (integration endpoints, business rules, branding, assessment regulations) is isolated per tenant and managed without code changes.
- A single-tenant deployment (one institution, one instance) is equally supported for institutions requiring dedicated infrastructure.

The multi-tenancy model does not compromise the pluggable architecture: each institution configures its own integration adapters and module set independently.

---

## 11. Open Source — GNU AGPL v3

Revelation SRS is published under the **GNU Affero General Public License v3 (AGPL-3.0)**, as declared in the repository `LICENSE` file. The AGPL ensures that:

- Anyone may use, study, modify, and distribute the software.
- Any modified version made available over a network must also be published under the AGPL — this closes the "SaaS loophole" and ensures that hosted derivatives remain open.
- Commercial use is permitted, but commercial parties may not distribute closed-source derivatives.

The codebase is structured so that institution-specific configuration (integration endpoints, business rules, branding) is separated from platform code, enabling institutions to customise without forking the core. The reference model (flows F001–F070, 33 systems and actors) provides the canonical integration vocabulary; institutions map their own systems against it.

---

## 12. Integration Architecture

System capabilities are exposed through a defined, documented integration layer before any user interface is built over them. The integration layer supports three complementary patterns:

**REST APIs** — synchronous request/response integrations. All endpoints are described by versioned OpenAPI specifications. Versioning uses URL path prefixes (`/v1/`, `/v2/`). Error responses follow RFC 7807 (Problem Details). Pagination, filtering, and sorting follow consistent conventions across all collection endpoints.

**Event-driven interfaces** — the SIS emits domain events for all significant state changes (enrolment confirmed, result ratified, adjustment approved, workflow state changed, etc.). External systems and SRS modules subscribe to these events rather than polling the SIS. Events are durable, ordered within a partition, and carried via a message broker. This is the primary integration mechanism for asynchronous and high-volume flows.

**File-based integration** — a legitimate and supported pattern for bulk data exchange with external systems, particularly statutory bodies. Supported formats and exchange protocols (e.g. SFTP, secure file drop) are defined per integration. File-based integrations are treated as first-class citizens of the integration layer and subject to the same versioning and audit requirements as API and event integrations.

Principles applying across all integration patterns:

- Breaking changes follow a deprecation policy with a defined notice period; non-breaking additions do not require a version increment.
- All inbound data is validated against the integration contract before processing.
- Integration failures are logged, alerted, and retried according to a defined retry and dead-letter policy.
- The plugin registry (§2) records all active integrations, their contract versions, and their operational health.

---

## 13. Configuration-Driven Business Rules

Institutional business rules that vary between institutions — or change over time within an institution — are configurable without code changes or redeployment.

This applies to (but is not limited to):

- Assessment regulations (marking schemes, late submission penalties, rounding rules)
- Progression rules (pass marks, credit requirements, compensation and condonement thresholds)
- Degree classification algorithms (boundary rules, discretionary uplift criteria)
- Fee liability rules and payment plan structures
- Attendance thresholds and UKVI compliance triggers
- Workflow routing rules (who approves what, in what sequence)

Rules are stored as versioned, audited configuration within the system. The history of which rules were active at any point in time is preserved (bitemporal, §3) so that past decisions can be reconstructed under the rules that applied at the time.

---

## 14. Record Lifecycle and Ratification Locking

Student academic records pass through a defined lifecycle from initial creation through to final ratification and long-term archiving. The lifecycle governs what changes are permissible at each stage and who may authorise them.

- **Pre-ratification**: records are mutable by authorised actors within defined workflow constraints.
- **Ratification**: the Exam Board formally ratifies outcomes. External examiner confirmation forms part of the ratification process. Once ratified, the record is locked.
- **Post-ratification lock**: a ratified academic record may not be amended except through a formal institutional process (appeal, approved correction under regulation). All such amendments are audited, workflow-managed, and must carry an authorisation trail.
- **Archiving**: records are retained for the periods required by regulatory obligation and institutional policy. Archived records remain readable and auditable but are immutable.

The record lock state is a first-class field on the academic record, not a derived or inferred condition.

---

## 15. Accessible User Interface

All user-facing interfaces must conform to **WCAG 2.1 Level AA** as a minimum standard. This is both a legal obligation (Public Sector Bodies Accessibility Regulations 2018) and a direct functional requirement given that the system manages disability declarations, reasonable adjustments, and support for students with accessibility needs.

- Accessibility is assessed at design time and verified through automated tooling and manual testing prior to release.
- Keyboard navigation, screen reader compatibility, and sufficient colour contrast are non-negotiable requirements.
- The accessibility statement is published and maintained in line with regulatory requirements.

---

## 16. Privacy by Design

Personal data handling is considered at the design stage of every feature, not as a retrofit.

- **Data classification**: all data fields are classified by sensitivity tier. Disability status, health information, exceptional circumstances, and safeguarding flags are classified as special category or sensitive data and subject to stricter access controls, read-auditing (§5), and retention rules.
- **Data minimisation**: only collect and store the data required to fulfil the stated purpose.
- **Lawful basis**: the lawful basis for each category of personal data processing is documented in the system's data register. The SIS processes data under multiple bases (legal obligation for HESA/UKVI, legitimate interests for academic administration); these are not assumed — they are recorded.
- **Purpose limitation**: data collected for one purpose is not repurposed without a documented lawful basis.
- **Retention and erasure**: all data classes have a defined retention period. Automated or managed deletion and anonymisation processes are implemented. Right-to-erasure requests are handled through a workflow that respects overriding legal obligations (e.g. statutory retention requirements).
- **Subject access**: the system supports data subject access requests by design, drawing on the audit trail, bitemporal record, and data classification to produce accurate and complete disclosures.

---

## 17. Performance and Scalability

The system is designed to operate responsively under the load profile of a large UK HEI (up to 50,000 enrolled students, concurrent use by hundreds of staff, peak loads at enrolment, results publication, and clearing).

- Interactive API responses return within 500ms at the 95th percentile under normal load.
- Batch and bulk operations (HESA return generation, exam board data preparation) are non-blocking and run asynchronously.
- The system scales horizontally: adding instances increases throughput without requiring architectural changes.
- Performance benchmarks are defined, documented, and verified as part of the CI/release process.

---

## 18. Observability and Operational Readiness

The system is designed to be operated and diagnosed without requiring direct database access or code changes.

- **Structured logging**: all application logs are structured (JSON), include a correlation ID for request tracing, and are written to a centralised log store with a defined retention policy.
- **Metrics**: services expose Prometheus-compatible metrics covering throughput, error rates, latency, and queue depths. Alert thresholds are defined and maintained alongside the metrics.
- **Distributed tracing**: inter-service calls carry trace context to support end-to-end request tracing across the integration layer.
- **Health endpoints**: every service exposes `/health` (liveness) and `/ready` (readiness) endpoints.
- **Runbooks**: operational runbooks for common failure scenarios are maintained alongside the codebase.

---

## 19. UK Higher Education Domain Model Alignment

The data model and service boundaries align with the Revelation Student Records Enterprise Reference Model (v2.1) and the UK HE sector's established data standards.

- Domain terminology follows UK HE conventions (programme, module, enrolment, cohort, award, ratification) rather than generic or US-centric alternatives. A project domain glossary is maintained as part of the documentation.
- Data field definitions and coding structures are informed by the HESA Student Record coding manual and Jisc data definitions.
- The HEAR (Higher Education Achievement Record) is the target format for student achievement transcripts.
- The SIS is the hub for the flows defined in the reference model; no domain system holds authoritative outcome data independently.

---

## 20. Testability and Quality

Quality is a design-time concern. The codebase is structured to support automated testing at all levels.

- **Unit tests** cover business logic, domain rules, and configuration-driven rule evaluation.
- **Integration tests** cover persistence, workflow transitions, bitemporal query correctness, and inter-module contracts.
- **Contract tests** cover integration points with external systems, verified against published OpenAPI specifications and event schemas.
- **Performance tests** verify response time and throughput benchmarks (§17) under representative load.
- **Security tests**: static analysis (SAST), dependency vulnerability scanning, and dynamic analysis (DAST) run in CI.
- **Accessibility tests**: automated WCAG scanning runs against all UI components as part of CI; manual testing is performed prior to release.
- All tests run in CI on every pull request. No code is merged with a failing test suite or a regression in security or accessibility scanning.

---

## Summary Table

| # | Principle | Primary Concern |
|---|---|---|
| 1 | Student Records as System of Record | Data integrity |
| 2 | Pluggable Modular Architecture | Extensibility |
| 3 | Bitemporal Data Integrity | Temporal integrity |
| 4 | Workflow Engine | Process management |
| 5 | Immutable Audit Trail | Accountability |
| 6 | Authentication & Authorisation | Security |
| 7 | UK Regulatory Compliance | Legal obligation |
| 8 | Relational Database | Data integrity |
| 9 | Containerised Deployment | Operability |
| 10 | Multi-Tenancy & Institutional Isolation | Architecture |
| 11 | Open Source — GNU AGPL v3 | Governance |
| 12 | Integration Architecture | Integration |
| 13 | Configuration-Driven Business Rules | Adaptability |
| 14 | Record Lifecycle & Ratification Locking | Academic governance |
| 15 | Accessible User Interface | Inclusion & legal |
| 16 | Privacy by Design | Data protection |
| 17 | Performance & Scalability | Reliability |
| 18 | Observability & Operational Readiness | Operations |
| 19 | UK HE Domain Model Alignment | Semantic correctness |
| 20 | Testability & Quality | Reliability |
