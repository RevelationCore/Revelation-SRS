# Revelation SRS — Project Roadmap

> Status: Draft for review
> Last updated: 2026-06-04

---

## Approach

The roadmap is organised into eleven sequential phases. Each phase has explicit prerequisites and named deliverables. No phase begins until the previous phase's deliverables are agreed.

The plan is structured so that every core principle is operationalised before the features that depend on it are built. Infrastructure and cross-cutting concerns (audit, bitemporality, workflow, multi-tenancy, integration layer) are established as a platform foundation before any domain functionality is layered on top. This avoids retrofitting and ensures every domain feature is built on a consistent, proven base.

Two worked examples are carried through the later phases to validate the architecture end-to-end:

- **Example first-party module**: Student Wellbeing & Disability — chosen because it is tightly coupled to core SRS data (it is the source of reasonable adjustment and exceptional circumstances outcomes that the SIS distributes to all downstream systems), exercises the workflow engine, the audit trail, direct database integration, and bitemporal records. It is the most demanding first-party module pattern.
- **Example external system**: VLE Connector — chosen because it is bidirectional (SIS pushes enrolment and adjustment outcomes; VLE returns assessment grades), exercises REST API, event subscription, and the adjustment distribution pattern (F015, F016, F059). It is present in every HEI and universally understood.

---

## Phase 0 — Principles and Planning *(complete)*

**Goal**: Establish the non-negotiable foundations that every subsequent decision is measured against.

**Deliverables**
- [x] Core principles document (`docs/core-principles.md`)
- [x] This project roadmap (`docs/project-roadmap.md`) — agreed and baselined
- [x] Technology stack decisions (`docs/decisions/`) — ADR-001 through ADR-011 plus summary

**Exit criterion**: Principles and roadmap agreed. Technology stack decisions recorded with rationale.

---

## Phase 1 — Requirements and Domain Definition *(complete)*

**Goal**: Define what the system must do in terms that can be directly traced to design and implementation decisions.

**Prerequisites**: Phase 0 complete.

**Work items**

1. **Core SRS functional requirements** — derived from the 70 reference model flows (F001–F070) and the 33 systems and actors. Each requirement is stated as a testable capability, assigned a unique identifier (REQ-xxx), and traced to the reference model flow(s) it satisfies.

2. **Non-functional requirements** — derived directly from the core principles. Covers: performance targets (§17), accessibility standard (§15), security controls (§6), regulatory obligations (§7), data retention classes (§16), availability and recovery objectives.

3. **Domain glossary** — the authoritative definition of every domain term used in the system (programme, module, enrolment, cohort, credit, award, ratification, reasonable adjustment, exceptional circumstances, CAS, etc.). UK HE conventions throughout; no US-centric alternatives.

4. **Actor catalogue** — every human and system actor that interacts with the SRS: their role, what they can read, what they can initiate, and what they are assigned in workflows. Input to the RBAC model (§6).

5. **Data subject register** — every category of personal data the system holds, its sensitivity classification, lawful basis for processing, retention period, and the regulatory obligation it serves. Directly supports §16 and §7.

6. **Workflow catalogue** — an enumeration of every long-running process to be managed by the workflow engine (§4), with the actors, states, transitions, and decision points for each.

**Deliverables**
- [x] `docs/requirements/functional-requirements.md`
- [x] `docs/requirements/non-functional-requirements.md`
- [x] `docs/domain-glossary.md`
- [x] `docs/requirements/actor-catalogue.md`
- [x] `docs/requirements/data-subject-register.md`
- [x] `docs/requirements/workflow-catalogue.md`

**Exit criterion**: All requirements reviewed and agreed. Glossary baselined. No open ambiguities on scope.

---

## Phase 2 — Architecture and Design *(complete)*

**Goal**: Define the target architecture at a level of detail sufficient to guide consistent implementation across all subsequent phases. Resolve all structural decisions before any code is written.

**Prerequisites**: Phase 1 complete.

**Work items**

1. **System architecture** — component diagram showing the SRS core, first-party modules, integration layer, and example external system. Establishes service and module boundaries. Defines what is "core SRS", what is "first-party module", and what is "external integration" in concrete architectural terms (reinforcing §2).

2. **Data model design** — logical and physical data model for the core SRS. Bitemporal schema patterns (valid-time and transaction-time columns, null conventions, query patterns). Multi-tenant partitioning strategy. Row-level security policy design. Covers all entities identified in Phase 1 requirements.

3. **Integration layer architecture** — detailed design of the pluggable integration layer:
   - Event bus topology (topics, partitions, consumer groups, retention, dead-letter queues)
   - REST API gateway design (routing, versioning, authentication, rate limiting)
   - File exchange framework (inbound and outbound, format validation, error handling)
   - Plugin registry schema and lifecycle (registration, versioning, health, enable/disable)
   - Contract versioning and deprecation policy

4. **Domain event taxonomy** — the complete catalogue of domain events the SIS emits (e.g. `student.enrolled`, `result.ratified`, `adjustment.approved`, `record.locked`). Each event has a versioned schema, a description of what triggered it, and the downstream consumers expected to react to it.

5. **API design standards** — URL structure and versioning convention, request/response standards (RFC 7807 error format), pagination and filtering conventions, OpenAPI template and toolchain.

6. **Security architecture** — identity provider integration model, RBAC role hierarchy, row-level security policy design, secrets management approach, API authentication flows (human and machine).

7. **Configuration-driven rules framework design** — how institutional rules (assessment regulations, progression rules, classification algorithms) are modelled, stored (bitemporally), evaluated at runtime, and administered without code changes (§13).

8. **Workflow engine selection and integration pattern** — evaluation of candidate embedded workflow engines against the requirements in §4. Decision record with rationale.

9. **Deployment architecture** — container topology, Docker Compose manifest for single-institution deployment, Kubernetes configuration path for multi-institution deployment, secrets injection pattern.

**Deliverables**
- [x] `docs/architecture/system-architecture.md`
- [x] `docs/architecture/data-model.md`
- [x] `docs/architecture/integration-layer.md`
- [x] `docs/architecture/domain-events.md`
- [x] `docs/architecture/api-standards.md`
- [x] `docs/architecture/security-architecture.md`
- [x] `docs/architecture/configuration-rules-framework.md`
- [x] `docs/architecture/workflow-engine-integration.md`
- [x] `docs/architecture/deployment-architecture.md`
- [x] `docs/decisions/ADR-012` through `ADR-014`

**Exit criterion**: Architecture documents reviewed and agreed. No unresolved structural decisions. ADRs baselined.

---

## Phase 3 — Platform Foundation *(current)*

**Goal**: Build the technical substrate on which all domain functionality will be built. No business logic in this phase — only cross-cutting infrastructure. Every subsequent phase depends on this being correct.

**Prerequisites**: Phase 2 complete. Technology stack confirmed.

**Work items**

1. **Repository structure and CI/CD pipeline** — monorepo layout, linting and static analysis, test runner, container image build and vulnerability scanning, OpenAPI validation, migration validation. All tests run on every pull request; no merge on failure (§20).

2. **Database foundation**
   - PostgreSQL schema with migration toolchain
   - Multi-tenancy framework (tenant table, tenant-scoped foreign keys, row-level security policies)
   - Bitemporal record framework — reusable table patterns, query helpers, and test utilities for valid-time and transaction-time columns
   - Audit trail tables and trigger/service infrastructure — append-only, covering all write operations from any origin

3. **Authentication and authorisation**
   - OAuth 2.0 / OIDC integration with institutional IAM
   - Local identity provider fallback (service accounts only)
   - RBAC framework — role definitions, permission matrix, middleware
   - Row-level security enforcement at database layer

4. **Workflow engine integration** — embedded workflow engine, durable execution, human task assignment, deadline and escalation support, failure/compensation handling, workflow-to-audit-trail bridge.

5. **Integration layer core**
   - Message broker deployment and topic provisioning
   - Event publishing library (consistent envelope format, correlation ID, schema validation)
   - Event subscription framework (consumer group management, retry, dead-letter)
   - REST API gateway (routing, auth middleware, versioning, RFC 7807 error handling)
   - File exchange framework (inbound validation, outbound generation, SFTP transport adapter)
   - Plugin registry — registration, versioning, health check polling, enable/disable lifecycle

6. **Configuration-driven rules engine** — runtime rule evaluation service, rule storage schema (bitemporal), administration API, audit of rule changes.

7. **Observability stack** — structured JSON logging with correlation IDs, Prometheus metrics exposition, distributed trace context propagation, `/health` and `/ready` endpoints on all services, alerting configuration.

8. **Containerisation and deployment** — `Dockerfile` for every service (non-root, pinned base image), Docker Compose manifest (single-command local environment), secrets injection pattern, image scanning in CI.

**Deliverables**
- Working repository with CI/CD passing
- Database foundation with bitemporal and multi-tenancy patterns proven by tests
- All cross-cutting infrastructure services deployed and verified in local environment
- Platform foundation verified by a suite of infrastructure-level integration tests

**Exit criterion**: CI pipeline green. All platform infrastructure components deployed locally. Bitemporal, audit, workflow, and integration layer proven by tests before any domain code is written.

---

## Phase 4 — Core SRS: Student Identity and Enrolment

**Goal**: Implement the authoritative student record — from the point of admission through to active enrolment and module registration. This is the central hub all other phases depend on.

**Prerequisites**: Phase 3 complete.

**Work items**

1. **Tenant administration** — institution provisioning, tenant configuration management, configuration-scoped rule sets.

2. **Student identity and personal data** — student record creation, personal data management (name, contact, address, demographic), identity verification status, HESA student identifier storage, bitemporal personal data history.

3. **Programme catalogue** — programmes, modules, learning outcomes, prerequisites, credit frameworks, academic year and period structures. Consumed from Curriculum Management (F001) or managed within the SRS.

4. **Enrolment lifecycle** — enrolment creation from admissions data (F005/F045), enrolment status transitions (active, intermitting, withdrawn, graduated), fee liability generation (F009), UCAS confirmation (F046), SLC confirmation trigger (F049), UKVI CAS trigger (F051). All status changes bitemporal.

5. **Module registration** — student module selection and registration, registration windows, prerequisite checking, registration confirmation, timetable data provision (F003).

6. **Academic calendar** — term and period definitions, key dates (enrolment open/close, assessment submission windows, board dates), calendar distribution to downstream systems.

**Deliverables**
- All Phase 4 requirements satisfied and covered by integration tests
- REST API endpoints for all resources, documented in versioned OpenAPI specifications
- Domain events published for all significant state changes
- Admin UI for student identity and enrolment management

**Exit criterion**: All Phase 4 functional requirements passing. Domain events verified by consumer tests. Bitemporal queries verified.

---

## Phase 5 — Core SRS: Assessment, Progression, and Awards

**Goal**: Implement the full assessment lifecycle from result ingestion through to ratified awards and record locking.

**Prerequisites**: Phase 4 complete.

**Work items**

1. **Assessment records and result aggregation** — result ingestion from VLE and other assessment systems (F016), mark storage (bitemporal), aggregation rules (configuration-driven), moderation workflow support.

2. **Reasonable adjustments management** — storage of approved adjustment outcomes received from Wellbeing (F063), bitemporal effective dating, distribution to downstream systems (VLE: F059, Attendance: F060, Exams: F061). SIS is the sole distribution point; no system receives adjustment data except via the SIS.

3. **Exceptional circumstances management** — storage of approved exceptional circumstances outcomes received from Wellbeing (F066), flag against student and module record, surfacing in board data preparation.

4. **Exam board data preparation** — generation of candidate profiles, mark aggregation, pre-board classification calculations, exceptional circumstances flags, misconduct outcome flags, adjustment indicators (F064).

5. **Ratification workflow and record locking** — exam board ratification workflow (F065), external examiner confirmation step (F068), post-ratification record lock, formal correction and appeal workflows for post-lock amendments.

6. **Progression rules engine** — configuration-driven evaluation of progression requirements, compensation and condonement rules, resit determination, backed by bitemporal rule storage so past decisions can be reconstructed.

7. **Degree classification** — configuration-driven classification algorithm evaluation, boundary handling, discretionary uplift, classification recommendations for board consideration.

8. **Award management** — award creation on ratification, graduation record, HEAR generation, certificate record, distribution to downstream systems.

**Deliverables**
- All Phase 5 requirements satisfied and covered by integration tests
- Record locking verified — locked records cannot be mutated outside the correction workflow
- Board data preparation verified against known test cohorts
- Configuration-driven rules verified against multiple institutional rule sets

**Exit criterion**: All Phase 5 functional requirements passing. Record lock integrity proven. Classification engine verified.

---

## Phase 6 — Core SRS: Regulatory Compliance

**Goal**: Implement all statutory data exchange obligations as first-class system capabilities (§7).

**Prerequisites**: Phase 4 and Phase 5 complete.

**Work items**

1. **UCAS admissions exchange** (F045, F046) — inbound application, offer, and clearing data ingestion; outbound enrolment confirmation and withdrawal notification. File and API patterns.

2. **HESA statutory student return** (F047, F048) — extraction of all required data fields per the HESA Student Record coding manual, validation against HESA business rules, submission file generation, inbound validation report processing, HESA ID storage and propagation.

3. **Student Loans Company** (F049, F050) — enrolment confirmation for fee and maintenance loan release, inbound loan entitlement and overpayment notification processing.

4. **UKVI compliance** (F051, F052) — CAS creation request generation, ongoing attendance compliance data submission, inbound visa status update processing and sponsor compliance alert handling.

5. **OfS reporting** — student outcome data extraction aligned to B3 condition reporting requirements.

6. **FOI support** — administration tooling to support information requests drawn from system data.

**Deliverables**
- All regulatory exchange workflows operational and testable using representative test data
- HESA file generation validated against the coding manual
- Each statutory flow covered by a contract test against the relevant external system's published specification

**Exit criterion**: All regulatory requirements passing. HESA validation clean against test submission.

---

## Phase 7 — Integration Layer: Published Interfaces

**Goal**: Complete and formally publish the integration layer so that external systems and third parties can integrate against stable, documented contracts.

**Prerequisites**: Phases 4, 5, and 6 complete (all domain events and API resources exist).

**Work items**

1. **Full REST API surface** — all resources documented in versioned OpenAPI specifications, published to a developer portal. Authentication examples, pagination documentation, error catalogue, changelog.

2. **Domain event catalogue** — all events documented with versioned JSON Schema or Avro schemas, published to a schema registry. Event descriptions, guaranteed ordering characteristics, consumer group guidance.

3. **File exchange specification** — all supported inbound and outbound file formats documented with field-level descriptions, validation rules, and exchange protocol specifications.

4. **Plugin registry — runtime** — live registry showing all registered integrations, their contract versions, health status, and event subscription configuration. Administration interface for enabling, disabling, and configuring integrations.

5. **Integration developer guide** — documentation covering how to build an external integration (REST consumer), how to build an event subscriber, how to build a file-based integration, and how to build and register a first-party SRS module.

**Deliverables**
- Published OpenAPI specifications for all REST API versions
- Published event schema registry
- File exchange specification documents
- Plugin registry operational
- Integration developer guide

**Exit criterion**: Integration layer documented to the standard required for a third party to build a conformant integration without access to internal code.

---

## Phase 8 — Example First-Party Module: Student Wellbeing & Disability

**Goal**: Build the Student Wellbeing & Disability module as the reference implementation of the first-party module pattern, and validate that the platform foundation supports complex first-party modules correctly.

**Prerequisites**: Phase 7 complete.

**Scope and integration pattern**

This module integrates with the SRS using the first-party pattern defined in §2: it shares the deployment, accesses the SRS database directly for its own domain data, and publishes outcomes to the SRS integration layer for distribution to downstream systems. It does not bypass SRS domain logic for data that the SRS owns.

**Work items**

1. **Disability declaration management** — student disability declarations, DSA entitlement records, evidence management, EDRMS integration for document storage (F023).

2. **Reasonable adjustment case management workflow** — case creation and referral, assessment workflow, multi-actor approval, approved outcome transmission to SIS core (F063), event publication triggering SIS distribution to VLE (F059), Attendance (F060), and Exams (F061).

3. **Exceptional circumstances workflow** — student submission, evidence review, determination workflow, approved outcome transmission to SIS core (F066), flagging for board paper preparation.

4. **Mental health and early intervention** — case management, early-warning alert consumption from Attendance Monitoring and BI (F028, F056), intervention record keeping.

5. **Inbound data from SIS** — student profiles, disability declarations, academic performance indicators, and existing flags received from SIS (F053).

**What this phase validates**
- First-party module pattern: direct DB access for own-domain data + integration layer for cross-domain outcomes
- Workflow engine under realistic multi-actor, multi-step conditions
- Bitemporal adjustment records and their downstream distribution
- Audit trail covering sensitive (special category) data with read-access auditing
- The SIS-as-sole-distribution-point rule for adjustments

**Deliverables**
- Student Wellbeing & Disability module operational
- All adjustment and exceptional circumstances flows end-to-end verified
- First-party module integration pattern documented and validated

**Exit criterion**: Adjustment outcome flows verified end-to-end from case approval through SIS distribution to downstream consumers. All workflow states and transitions covered by tests.

---

## Phase 9 — Example External System Integration: VLE Connector

**Goal**: Build the VLE Connector as the reference implementation of the external system integration pattern, and validate the integration layer under realistic bidirectional load.

**Prerequisites**: Phase 7 complete. Phase 8 complete (adjustment distribution must be proven before F059 is tested here).

**Scope and integration pattern**

The VLE Connector integrates exclusively via the published integration layer — no direct database access. It demonstrates all three integration mechanisms: event subscription (inbound enrolment changes), REST API (grade submission), and the adjustment distribution pattern.

**Work items**

1. **Outbound: enrolment sync to VLE** (F015) — the connector subscribes to `student.enrolled`, `student.module-registered`, `student.status-changed` events and maintains the VLE course population in real time. Term dates pushed on calendar events.

2. **Outbound: approved adjustment distribution to VLE** (F059) — the connector subscribes to `adjustment.distributed` events published by the SIS core (triggered by Phase 8 adjustment approvals) and applies the adjustment in the VLE (extended deadlines, alternative formats, accessible content flags).

3. **Inbound: assessment grade ingestion from VLE** (F016) — the connector exposes a REST endpoint (authenticated, versioned) through which the VLE posts completed assessment grades. The SIS validates, records, and triggers the result aggregation pipeline.

4. **Connector configuration** — the VLE endpoint URL, authentication credentials, and topic subscriptions are configured per tenant via the plugin registry; no code changes are needed to point the connector at a different VLE instance.

**What this phase validates**
- External integration pattern: integration layer only, no direct DB access
- Event subscription and reliable delivery under realistic conditions
- REST API security and versioning under real inbound traffic
- The adjustment distribution chain end-to-end: Wellbeing approval → SIS core → VLE Connector → VLE
- Plugin registry lifecycle: registration, configuration, health, disable/re-enable

**Deliverables**
- VLE Connector operational and configurable per tenant
- All three integration flows (F015, F016, F059) verified end-to-end
- External integration pattern documented and validated
- Contract tests covering the VLE Connector's integration surface

**Exit criterion**: All three flows verified end-to-end in a local environment with a stub VLE. Contract tests passing. Connector reconfigurable to a different endpoint without code changes.

---

## Phase 10 — User Interfaces

**Goal**: Build the student-facing portal and staff administrative interface, consuming the REST APIs and event streams established in earlier phases.

**Prerequisites**: Phases 4–7 complete (all APIs and domain events exist).

**Work items**

1. **Student self-service portal**
   - Authentication and identity (SSO via IAM)
   - Personal data management and contact details self-service (F011)
   - Module selection and registration
   - Results and progression view, notifications
   - Exam timetable and candidate number display (F012)
   - WCAG 2.1 AA compliance throughout (§15)

2. **Staff administrative interface**
   - Student record search, view, and administration
   - Enrolment and registration management
   - Assessment record management
   - Exam board tooling (candidate profile review, ratification workflow)
   - Regulatory return management (HESA, SLC, UKVI)
   - Workflow task inbox (for all workflow-managed processes)

3. **Tenant and system administration**
   - Tenant provisioning and configuration
   - Business rule configuration and versioning
   - Integration registry management
   - User and role administration
   - Audit log viewer

4. **Reporting and BI feeds** (F027–F030)
   - Structured data extracts for Business Intelligence and Data Warehouse
   - Standard operational reports (enrolment volumes, module completion rates, award outcomes)

**Deliverables**
- Student portal operational and WCAG 2.1 AA verified
- Staff administrative interface operational
- System administration interface operational
- All UI components covered by automated accessibility scanning in CI

**Exit criterion**: All golden-path user journeys verified manually in a local environment. WCAG 2.1 AA automated scan clean. No regressions against Phase 4–7 API tests.

---

## Phase 11 — Hardening and Open Source Release

**Goal**: Bring the system to a state suitable for adoption by an institution and release to the open source community.

**Prerequisites**: Phases 1–10 complete.

**Work items**

1. **Performance testing** — load testing against the benchmarks defined in §17 (500ms p95 for interactive APIs, 50,000-student design point). Identify and resolve bottlenecks.

2. **Security review** — SAST clean, dependency vulnerability scan clean, DAST against the running application, penetration test of authentication and authorisation controls, data isolation test across tenant boundaries.

3. **Accessibility audit** — full manual WCAG 2.1 AA audit of all UI surfaces, remediation of findings.

4. **Data migration tooling** — documented migration framework and example migration scripts for institutions moving from common UK SRS platforms (SITS, Banner). Validation tooling to verify migration completeness.

5. **Production deployment configuration** — hardened container configuration, Kubernetes manifests, backup and recovery procedures, secrets management integration, resource limit and network policy definitions.

6. **Operational documentation** — runbooks for common operational scenarios, on-call guide, upgrade procedure, backup/restore procedure.

7. **Open source release preparation** — AGPL v3 licence headers on all source files, contribution guide, code of conduct, issue and PR templates, developer setup guide, architecture documentation review.

**Deliverables**
- Performance benchmarks met and documented
- Security review findings resolved
- Accessibility audit clean
- Data migration framework published
- Production deployment configuration tested
- Full operational documentation
- Open source repository published with complete release artefacts

**Exit criterion**: System meets all non-functional requirements. Security and accessibility reviews clean. Repository published under AGPL v3.

---

## Principle Coverage Map

| Principle | Phase where operationalised |
|---|---|
| 1 — System of Record | 4 (enrolment), 5 (ratification lock) |
| 2 — Pluggable Architecture | 3 (integration layer core), 7 (published interfaces), 8 (first-party module), 9 (external integration) |
| 3 — Bitemporal Data | 3 (framework), 4, 5 (applied throughout) |
| 4 — Workflow Engine | 3 (engine), 5 (ratification), 8 (adjustments) |
| 5 — Audit Trail | 3 (infrastructure), applied in every subsequent phase |
| 6 — Authentication & Authorisation | 3 (framework), applied in every subsequent phase |
| 7 — UK Regulatory Compliance | 6 (HESA, SLC, UKVI, UCAS, OfS) |
| 8 — Relational Database | 3 (foundation) |
| 9 — Containerised Deployment | 3 (local), 11 (production hardening) |
| 10 — Multi-Tenancy | 3 (framework), 4 (applied), 10 (tenant admin) |
| 11 — AGPL v3 | 11 (release) |
| 12 — Integration Architecture | 3 (core), 7 (published interfaces), 9 (VLE connector) |
| 13 — Configuration-Driven Rules | 3 (engine), 5 (progression, classification) |
| 14 — Record Lifecycle & Locking | 5 (ratification workflow and lock) |
| 15 — Accessible UI | 10 (portal), 11 (audit) |
| 16 — Privacy by Design | 1 (data register), 3 (RLS), 5 (read auditing), 16 (retention) |
| 17 — Performance & Scalability | 11 (load testing and benchmarking) |
| 18 — Observability | 3 (stack), applied in every subsequent phase |
| 19 — UK HE Domain Model | 1 (glossary, requirements), applied throughout |
| 20 — Testability & Quality | 3 (CI pipeline), applied throughout |

---

## Summary

| Phase | Title | Key output |
|---|---|---|
| 0 | Principles and Planning | Principles agreed, technology stack decided |
| 1 | Requirements and Domain Definition | Requirements, glossary, workflow catalogue |
| 2 | Architecture and Design | Architecture documents, ADRs, data model |
| 3 | Platform Foundation | Database, auth, audit, workflow, integration layer core |
| 4 | Core SRS: Student Identity and Enrolment | Student record, enrolment, module registration |
| 5 | Core SRS: Assessment, Progression, Awards | Results, board prep, ratification lock, awards |
| 6 | Core SRS: Regulatory Compliance | HESA, SLC, UKVI, UCAS, OfS |
| 7 | Integration Layer: Published Interfaces | OpenAPI specs, event schemas, developer guide |
| 8 | Example First-Party Module: Wellbeing | Adjustments and EC workflows end-to-end |
| 9 | Example External Integration: VLE | Enrolment sync, grade ingestion, adjustment distribution |
| 10 | User Interfaces | Student portal, staff admin, tenant admin |
| 11 | Hardening and Open Source Release | Performance, security, accessibility, release |
