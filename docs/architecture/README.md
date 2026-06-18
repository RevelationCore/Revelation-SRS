# Architecture Documents

This directory contains the technical architecture documentation for Revelation SRS. Each document addresses a specific architectural concern. Read the [System Architecture](system-architecture.md) first if you are new to the codebase.

---

## Index

| Document | When to read it |
|---|---|
| [System Architecture](system-architecture.md) | Start here. Component diagram, modular monolith design, repository structure, and service boundaries. |
| [Data Model](data-model.md) | Designing or querying entities. Entity model, bitemporal schema pattern (`valid_from`/`valid_to`/`recorded_at`), and Row-Level Security multi-tenancy. |
| [Integration Layer](integration-layer.md) | Adding or modifying integrations. Event bus topology (NATS JetStream), REST API gateway, file exchange framework, and plugin registry. |
| [Domain Events](domain-events.md) | Publishing or consuming events. Complete event taxonomy (~95 events) with payload schemas, subjects, and consumers. |
| [Integration Contract Catalogue](integration-contract-catalogue.md) | Implementing a named integration flow. All 69 reference model flows with retry/failure handling and replay guarantees. |
| [Event Coverage Matrix](event-coverage-matrix.md) | Checking whether an entity change should emit an event. Every entity/operation mapped to its domain event or a documented no-event rationale. |
| [Workflow Traceability Matrix](workflow-traceability-matrix.md) | Tracing a business process end-to-end. W001–W012 mapped to entities, events, contracts, and audit obligations. |
| [API Resource Catalogue](api-resource-catalogue.md) | Adding or reviewing REST endpoints. All entities mapped to their resource class, endpoint set, and permission requirements. |
| [API Standards](api-standards.md) | Writing or reviewing API code. URL conventions, RFC 7807 error format, cursor pagination, and the OpenAPI toolchain. |
| [Data Subject Coverage Matrix](data-subject-coverage-matrix.md) | Privacy impact assessment or DSAR work. Data model reconciled against the data subject register; special-category field classification. |
| [Security Architecture](security-architecture.md) | Security controls, authentication, or secrets changes. Keycloak multi-realm OIDC, RBAC role hierarchy, RLS enforcement, auth flows, and OpenBao secrets management. |
| [Configuration Rules Framework](configuration-rules-framework.md) | Institutional configuration or feature flags. Business rules stored as bitemporal, versioned configuration; feature flag lifecycle. |
| [Workflow Engine Integration](workflow-engine-integration.md) | Adding or modifying a durable workflow. Temporal integration patterns, human task assignment, activity retry policies, and the audit bridge. |
| [Deployment Architecture](deployment-architecture.md) | Deploying or operating the system. Docker Compose (local + single institution), Kubernetes with Kustomize overlays, and environment promotion. |

---

## Related documents

- [Core Principles](../core-principles.md) — 21 non-negotiable principles; any architectural change must preserve these
- [Domain Glossary](../domain-glossary.md) — authoritative UK HE term definitions used throughout the architecture
- [Data Subject Register](../requirements/data-subject-register.md) — personal data categories, lawful basis, and retention periods
- [Non-Functional Requirements](../requirements/non-functional-requirements.md) — performance, security, accessibility, and compliance targets the architecture must meet
- [Technology Stack Decision](../decisions/technology-stack.md) — rationale for every technology choice
- [ADR Index](../../README.md#architecture-decision-records) — all architecture decision records in the root README
