# Platform Workflow, Feature Flag, and Environment Alignment: Stage 0 Baseline

> Date: 2026-06-13
> Status: Complete
> Related plan: `docs/platform-workflow-feature-flag-alignment-plan.md`

## Purpose

Stage 0 freezes the current process behaviour before workflow orchestration, feature flags, and environment-scoped configuration are introduced. It does not change production behaviour. It records where process order is currently encoded, which tests protect it, and where later stages should extract configurable workflow controls.

## Baseline Summary

| Process point | Current implementation | Current behaviour | Regression coverage | Later migration target |
|---|---|---|---|---|
| Enrolment status transitions | `apps/api/src/platform/enrolment/service.ts` `ALLOWED_TRANSITIONS` and `transitionStatus` | `enrolled` can move to `intermitting`, `withdrawn`, `suspended`, or `graduated`; `intermitting` and `suspended` can return to `enrolled` or move to `withdrawn`; `withdrawn` and `graduated` are terminal. Transitions create bitemporal versions and transition ledger rows. | `apps/api/test/enrolments.int.test.ts` covers intermit, reinstate, withdraw, history, transition reasons, invalid withdrawn-to-intermitting transition, and person-status lifecycle side effects. | Workflow transition definitions and decision audit, with the service still enforcing legal domain state and bitemporal writes. |
| Module registration transitions | `apps/api/src/platform/registration/service.ts` `#transitionRegistration` | A current registration starts as `registered`. Only current `registered` rows can move to `withdrawn` or `completed`; closed registrations cannot transition again. Transitions create bitemporal versions and publish registration events. | `apps/api/test/module-registrations.int.test.ts` covers withdrawal, completion through prerequisite flow, bitemporal history, and now rejects a withdrawn-to-completed transition. | Workflow step definitions for add/drop/complete windows, while `ModuleRegistrationService` keeps capacity, prerequisite, duplicate, and bitemporal invariants. |
| Correction case transitions | `apps/api/src/platform/governance/correction-service.ts` `ALLOWED_STATUS_TRANSITIONS` | Cases move from `submitted` to `under-review`, `dismissed`, or `not-eligible`; `under-review` can move to `upheld`, `dismissed`, or `not-eligible`; terminal statuses do not advance. Amendments are only allowed on upheld cases. | `apps/api/test/correction-cases.int.test.ts` covers invalid direct submitted-to-upheld transition, case version listing, upheld-only amendment, cross-enrolment guard, and post-ratification re-locking. | Case workflow definition with configurable review, eligibility, panel, appeal, and amendment steps; correction service retains locked-record amendment authority. |
| UCAS confirmed-to-enrolment path | `apps/api/src/platform/regulatory/ucas-service.ts` `ingestApplication` and confirmed application handling | UCAS applications with `statusCode = confirmed` create or link a person and create an enrolment from supplied enrolment data. Clearing applications are staged without auto-enrolment and may be manually linked later. | `apps/api/test/regulatory-ucas.int.test.ts` covers confirmed auto-enrolment, clearing staging, manual link, tenant isolation, and outbound confirmation idempotency. | Admissions workflow source adapter. UCAS is one source route; international/direct/agent routes should call the same admissions application and enrolment-confirmation interfaces. |
| Enrolment downstream trigger creation | `apps/api/src/platform/enrolment/service.ts` `createEnrolment` and `transitionStatus` | Creating an enrolment queues UCAS confirmation when `ucasPersonalId` is present, SLC confirmation when `fundingSourceCode = slc` or `slcReference` exists, and UKVI CAS when `ukviCasRequired` is true. Withdrawal/intermission queues an SLC status-change notification when an SLC reference exists. | `apps/api/test/enrolments.int.test.ts` covers UCAS/SLC/UKVI trigger ledger rows and trigger events. `apps/api/test/regulatory-trigger-processing.int.test.ts`, `regulatory-slc.int.test.ts`, `regulatory-ucas.int.test.ts`, and `regulatory-ukvi.int.test.ts` cover processing and idempotency. | Configurable workflow trigger rules and integration endpoint guardrails scoped by tenant, environment, source, and flag state. |
| Exam board external examiner prerequisite | `apps/api/src/platform/governance/board-service.ts` `ratifyBoard` | Exam board ratification is blocked until an external examiner signoff exists. Ratification then locks covered marks, module results, and progression decisions. | `apps/api/test/exam-boards.int.test.ts` covers signoff recording, signoff prerequisite rejection, ratification, locking, out-of-scope mutability, and duplicate ratification rejection. | Exam board workflow with configurable attendees, signoff roles, quorum/escalation rules, and ratification tasks; board service keeps record-locking invariants. |
| Progression decision algorithm shape | `apps/api/src/platform/progression/progression-service.ts` `#decide` and rules lookup | Earned credits include passed, compensated, and condoned results. Failed results can earn credits through configured compensation and condonement thresholds. Decision is `progress` when earned credits meet required credits, `resit` when unresolved credits or any outcomes remain below threshold, and `repeat-year` when there are no outcomes. | `apps/api/test/progression.int.test.ts` covers passing decisions, bitemporal re-evaluation, history, tenant isolation, and decision events. `apps/api/test/events/phase5-event-consumer-tests.int.test.ts` covers event publication. | Progression workflow should orchestrate data gathering, board preparation, approval, notification, and amendment routes; academic rules and service algorithm remain the authoritative decision calculation until a future rule-model change explicitly replaces it. |

## Additional Hard-Coded Controls Observed

These are not named Stage 0 process points, but they are relevant to the alignment plan:

- Static role-to-permission responsibility mapping is defined in `packages/domain/src/permissions.ts` through `PERMISSION_ROLES`.
- Several database migrations still use fixed `CHECK (...) IN (...)` constraints for business codes that should become value-set governed where tenant variation is expected.
- `packages/workflow` currently contains a minimal Temporal audit workflow scaffold rather than domain workflow implementations.

These controls are intentionally left unchanged in Stage 0 and are addressed by later stages of the alignment plan.

## Coverage Decision

Most named behaviours were already locked by integration tests. Stage 0 adds one missing regression assertion for module-registration transition closure: once a registration is withdrawn, attempting to complete it returns `422`.

No production service logic, migrations, schemas, APIs, routes, or seed data were changed in Stage 0.

## Exit Criteria

- Current behaviour is described above with implementation and test traceability.
- Hard-coded process points are known before orchestration extraction begins.
- Regression coverage exists for each named process point.
- The architecture and ADR set the boundary that domain services enforce data invariants while workflow controls process ordering.
- No production behaviour changes were introduced.
