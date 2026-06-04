# ADR-005: Workflow Engine

**Status**: Accepted
**Date**: 2026-06-04

## Context

Principle §4 requires a first-class embedded workflow engine for managing long-running, multi-actor business processes (admissions, reasonable adjustment case management, exceptional circumstances, exam board ratification, appeals). The engine must provide: durable execution (workflow state survives service restarts), human task assignment, deadline enforcement with escalation, failure handling with retry and compensation, and integration with the audit trail. Workflows are written as code, not XML/BPMN configuration, to enable version control and testing alongside the application codebase.

## Decision

**Temporal** as the workflow engine.

## Rationale

- Purpose-built durable workflow execution platform; workflows survive server restarts, crashes, and deployments automatically.
- First-class TypeScript SDK (`@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`) — workflows and activities are ordinary TypeScript functions, testable with standard tooling.
- Deterministic replay model guarantees exactly-once workflow state progression even under failure.
- Activity retries with configurable backoff and timeout are built in; compensation logic (saga pattern) is straightforward to implement.
- Human task patterns are supported via signals and queries — external actors can interact with running workflows through the Temporal API.
- Deadline enforcement via workflow timers with escalation paths defined in code.
- Temporal UI provides visibility into all running and historical workflow instances, their state, and their event history — essential for operational support of exam board and case management processes.
- Open source server (MIT licence); client SDK is MIT.
- Runs as a Docker container; ships with a bundled development server suitable for the local environment.

## Alternatives Considered

| Engine | Reason rejected |
|---|---|
| Flowable / Activiti | BPMN 2.0 XML; Java-centric; workflow definitions are not code and are harder to test and version-control |
| Custom state machine | Adequate for simple linear flows; insufficient for complex multi-actor, long-running processes with compensation requirements; all the complexity of a workflow engine with none of the infrastructure |
| Camunda 8 | Excellent product; cloud-native version requires Camunda SaaS; self-hosted Zeebe is complex to operate and licensed under an SSPL-adjacent model that restricts open source use |
| AWS Step Functions | Cloud-specific; not self-hosted; not open source |

## Consequences

- Workflows are TypeScript code in the `/workflows` directory, tested with `@temporalio/testing`.
- The Temporal server runs as a Docker container with a PostgreSQL backend (shares the application database cluster with a separate schema).
- All workflow state transitions are visible in the Temporal UI and are additionally written to the application audit trail via a workflow activity.
- Human task assignment is implemented via Temporal signals; notification of assigned actors is a side-effect activity.
- Workflow definitions are versioned using Temporal's built-in versioning API to support safe deployment of updated workflow logic alongside running instances.
