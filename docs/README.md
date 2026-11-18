# Revelation SRS Documentation

> Status: Current collaborator-facing documentation index
>
> Last reviewed: 2026-11-18

This index separates maintained product knowledge from superseded delivery evidence. Start with the current capability matrix before relying on a document's implementation claims.

## Start here

| Need | Document |
|---|---|
| Understand what works now | [Current capabilities](product/current-capabilities.md) |
| Understand product intent | [Core principles](core-principles.md) |
| Learn UK HE terminology | [Domain glossary](domain-glossary.md) |
| Browse business processes | [UK HE business process library](business-processes/README.md) |
| Set up a development environment | [Developer setup](developer-setup.md) |
| Try and appraise the product | [Appraisal pack](appraisal/README.md) |
| See what was built, phase by phase | [Academic journey gap-closure plan](product/academic-journey-gap-closure-plan.md) |
| Use the app for a business area | [User guides](user-guides/) |
| Contribute a change | [Contributor guide](../CONTRIBUTING.md) |

## Product analysis

- [Product documentation](product/README.md) establishes the status authority and links the principal analysis.
- [Business process map](business-processes/process-map.md) decomposes the student lifecycle into navigable process pages.
- [P0 functional requirements](requirements/business-process-p0-functional-requirements.md) specify priority controls derived from the process review.
- [Curriculum management requirements](requirements/curriculum-management-system.md) define the proposed optional internal module: academic definitions, diets, approval/rework, versioning, publication and third-party provider substitution.
- [Academic journey narrative catalogue](product/academic-journey-narrative-catalogue.md) proposes 40 interlocking stories across student, academic, research and institutional perspectives, with reference-model coverage and an interaction-discovery register.
- [Expanded academic journeys](product/academic-journeys/README.md) develops twelve connected stories from course creation to graduation, with shared fictional people, course/rule versions, weekly timelines and explicit service hand-offs.
- [P0 traceability](business-processes/p0-requirements-and-adr-traceability.md) connects backlog items, requirements, processes and decisions.
- [Revelation change backlog](business-processes/revelation-change-backlog.md) records implementation impacts discovered by the review.
- [Attendance and engagement vertical slice](product/attendance-engagement-vertical-slice.md) specifies the first end-to-end implementation.
- [Attendance Increment A approval pack](product/attendance-engagement-increment-a-approval-pack.md) collects the decisions required before physical implementation.

## Requirements and decisions

- [Requirements](requirements/) contains functional, non-functional, actor, workflow and data-subject catalogues.
- [Architecture](architecture/README.md) explains the current and target technical design.
- [Architecture decisions](decisions/) records accepted and proposed design choices: ADR-001 to ADR-025, and the decision records for each gap-closure phase ([Phase 1](decisions/phase-1-gap-closure-decisions.md) to [Phase 5](decisions/phase-5-gap-closure-decisions.md)).
- [SME review register](business-processes/sme-review-register.md) records which processes have been submitted for subject-matter-expert review; the [Phases 1 to 5 change review](business-processes/sme-change-review-phases-1-5.md) is the pack awaiting reviewers.
- [Reference model](reference/revelation-student-records-reference-model.md) describes the wider UK HE systems landscape.

## Build, integrate and operate

- [Integration guides](integrations/developer-guide.md) cover REST, events, file contracts and worked examples; [outbound delivery](integrations/outbound-delivery.md) explains the delivery ledger used for systems with no live link.
- [Demo scenarios](demo-scenarios/README.md) provide repeatable application walkthroughs and datasets.
- [Migration runbook](migration-runbook.md) covers legacy data import.
- [Operational runbooks](runbooks/README.md) cover service operation and incident response.
- [Admin portal user guide](admin-portal-user-guide.md) covers administrative use.

## Document authority

When documents disagree:

1. accepted architecture decision records govern architectural choices;
2. the [current capability matrix](product/current-capabilities.md) governs implementation status;
3. approved requirements govern expected behaviour;
4. business process pages govern the researched target process, subject to their recorded SME status.

Superseded phase plans, reviews, UAT records and release assertions are intentionally absent from `main`. See [documentation history](history.md) to inspect them.
