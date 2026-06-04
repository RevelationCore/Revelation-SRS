# Phase 2 Remediation Pack

> Status: Draft for review
> Created: 2026-06-04
> Scope: Remediation actions required before Phase 3 platform implementation is treated as implementation-ready.

## Purpose

This folder records the remediation work identified during review of Phases 0-2 of Revelation SRS, with particular focus on core Student Records System coverage and external-system integration boundaries.

The remediation pack does not replace the Phase 1 and Phase 2 baseline documents. It identifies corrections and additions that should be applied to those documents before platform foundation work depends on them.

## Documents

| Document | Purpose |
|---|---|
| [reference-model-review.md](reference-model-review.md) | Issues found in the original reference files under `docs/reference`. |
| [requirements-to-architecture-traceability.md](requirements-to-architecture-traceability.md) | Gaps between functional requirements, data model, APIs, events, workflows, and adapters. |
| [integration-contract-catalogue.md](integration-contract-catalogue.md) | Required integration contracts for all system actors and reference flows. |
| [domain-event-taxonomy-remediation.md](domain-event-taxonomy-remediation.md) | Corrections and additions needed in the event taxonomy. |
| [data-model-remediation.md](data-model-remediation.md) | Core entities missing or under-specified in the Phase 2 data model. |

## Recommended Sequence

1. Resolve the reference-model issues and decide which reference gaps are in scope for Revelation SRS.
2. Update functional requirements traceability for uncovered or intentionally excluded flows.
3. Expand the data model to cover all Must Have core SRS facts and integration state.
4. Expand the integration contract catalogue and plugin registry model.
5. Reconcile workflow event names, domain event subjects, and adapter contracts.
6. Update `docs/project-roadmap.md` so Phase 2 is marked as requiring remediation until these actions are complete.

## Review Outcome

Phase 0-2 establish strong principles and a sensible architectural direction, but Phase 2 is not yet detailed enough to guide implementation safely. The main risk is traceability: several Must Have requirements imply records, events, APIs, workflows, and adapter responsibilities that are not yet represented in the architecture documents.
