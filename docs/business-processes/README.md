# UK Higher Education Business Process Library

> Status: Complete draft baseline — SME approval pending
> Documentation owner: TBC
> Editorial owner: TBC
> Started: 2026-07-26

This library documents UK higher education business processes that create, change, validate, consume, report, or govern student record data. It describes sector processes first and records current or proposed Revelation SRS behaviour separately.

## How to use this library

- Start with the [process map](process-map.md) to browse by student lifecycle domain.
- Use the [process inventory](process-inventory.md) for scope, priority, and drafting status.
- Read [terminology and conventions](terminology-and-conventions.md) before authoring or reviewing a page.
- Use the [process template](process-template.md) for new pages.
- Consult the [source register](source-register.md) for research currency and provenance.
- Use the [traceability matrix](traceability-matrix.md) to connect processes to Revelation workflows, integration flows, requirements, and data.
- Use the [SME review register](sme-review-register.md) to see which review roles remain unassigned.
- Read the [completion review](completion-review.md), use the [SME review pack](sme-review-pack.md), and assess the proposed [Revelation change backlog](revelation-change-backlog.md).

## Browse by lifecycle

| Domain | Scope | Status |
|---|---|---|
| [Recruitment and admissions](01-recruitment-and-admissions/README.md) | Application receipt through applicant-to-student conversion | Draft complete |
| [Registration and student status](02-registration-and-student-status/README.md) | Initial/annual registration and changes to student status | Draft complete |
| [Curriculum and module registration](03-curriculum-and-module-registration/README.md) | Catalogue intake, programme structure, module choice and changes | Draft complete |
| [Learning, engagement and support](04-learning-engagement-and-support/README.md) | Engagement, adjustments, circumstances and support outcomes | Draft complete |
| [Assessment and results](05-assessment-and-results/README.md) | Assessment setup through ratified and published results | Draft complete |
| [Progression, awards and graduation](06-progression-awards-and-graduation/README.md) | Progression decisions, reassessment, awards and completion | Draft complete |
| [Regulatory and statutory reporting](07-regulatory-and-statutory-reporting/README.md) | HESA, student finance, immigration and national regulator processes | Draft complete |
| [Record governance and lifecycle](08-record-governance-and-lifecycle/README.md) | Identity resolution, correction, rights, retention and audit | Draft complete |

## Browse by applicability

Every process page declares one or more applicability values:

- `UK` — the common process applies across the UK;
- `England`;
- `Scotland`;
- `Wales`;
- `Northern Ireland`; and
- `Institutional` — a provider policy or operating-model choice.

A `UK` label does not imply identical national regulation. Where the core sequence is common but a rule, body, funding exchange, terminology, or deadline differs, the page contains a named national variation.

## Documentation status

`Candidate` → `Researched` → `Draft` → `SME review` → `Approved` → `Superseded`

Only an authorised SME can move a page from `SME review` to `Approved`. Pages may be technically complete while remaining at `Draft` until reviewers are appointed.

The working inventory now has a draft page for every identifier from BP-001 through BP-063. Structural completeness does not imply policy approval: open decisions and source currency must be resolved through the [SME review register](sme-review-register.md).

## Identifier model

| Identifier | Meaning | Authority |
|---|---|---|
| `BP-nnn` | Business process page | This library |
| `Wnnn` | Durable Revelation workflow | [Workflow Catalogue](../requirements/workflow-catalogue.md) |
| `Fnnn` | Enterprise reference-model integration flow | [Reference Model](../reference/revelation-student-records-reference-model.md) |
| `REQ-AREA-nnn` | Revelation functional requirement | [Functional Requirements](../requirements/functional-requirements.md) |

These identifiers are related through traceability but are not interchangeable.

## Current baseline findings

The initial audit found:

- Revelation SRS reports v1.0.0 and all roadmap phases complete, while the actor catalogue, workflow catalogue, and workflow traceability matrix still carry draft phase labels.
- W001 combines admissions and enrolment, and W007 combines withdrawal and intermission; detailed business documentation needs smaller outcome-oriented processes.
- Existing documentation describes 69 interactions in the F001–F070 range (with no F054), while the integration catalogue also defines F071 for OfS extracts.
- PGR entities and integrations exist, but the durable workflow catalogue does not cover the full PGR lifecycle.
- Actor names vary between catalogues, workflow prose, transition tables, RBAC roles, and demo personas.
- Existing documents alternate between `SIS` and `SRS` for the core system.

These are reconciliation findings, not changes to the source catalogues. They remain visible until owners decide whether the original artefacts should be amended.

## Governance

The implementation and maintenance approach is defined in the [documentation plan](../business-process-documentation-plan.md). Material process changes must include:

1. source and applicability review;
2. terminology review;
3. integration and data impact assessment;
4. traceability updates;
5. Mermaid/prose consistency review; and
6. SME approval where the page is already approved.
