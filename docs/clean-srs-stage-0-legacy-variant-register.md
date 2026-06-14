# Clean SRS Convergence: Stage 0 Legacy and Variant Register

> Date: 2026-06-14
> Status: Complete
> Related plan: `docs/clean-srs-convergence-plan.md`

## Purpose

Stage 0 records the remaining compatibility paths, service-private process routes, and intended long-term variants before any removal work begins. The goal is to separate three things that can otherwise become tangled:

- **legacy paths** retained only to protect migration;
- **hard invariants** that must stay in services;
- **valid institutional variants** that should remain configurable through workflow, rules, flags, or tenant configuration.

No production behaviour is changed in this stage.

---

## Legacy and Process Register

| Area | Current implementation | Current guard or configuration | Replacement path | Retirement condition | Telemetry / proof of non-use | Coverage before removal |
|---|---|---|---|---|---|---|
| UCAS confirmed handoff | `apps/api/src/platform/regulatory/ucas-service.ts` starts Admissions workflow handoff for confirmed applications and keeps UCAS-specific storage/exchange evidence. | `admissions.enabled` and `admissions.ucas-adapter.enabled`; historical migration flag `admissions.legacy-ucas-auto-enrolment.enabled` remains as audit/configuration vocabulary. | Source-neutral Admissions application and handoff service. UCAS remains only an adapter and regulatory evidence owner. | No tenant relies on direct UCAS-to-enrolment creation; all confirmed UCAS, direct, agent, clearing, and international routes enter Admissions first. | Count UCAS confirmed ingests by handoff mode and application source; alert if any direct enrolment conversion path is invoked. | `apps/api/test/ucas-admissions-handoff.test.ts`, `apps/api/test/regulatory-ucas.int.test.ts`, future Admissions clean-cut parity tests. |
| Enrolment downstream triggers | `apps/api/src/platform/workflow/trigger-rule-service.ts` can evaluate legacy UCAS/SLC/UKVI trigger rules if configured mode is unavailable or off. | Feature flag `enrolment.downstream-triggers.configured-mode`; fallback is `legacy`. | Workflow trigger rules seeded in `workflow_trigger_rule`, evaluated as the default path. | Configured trigger mode is active for every tenant; legacy decisions have zero observed use for a full release cycle. | Log/evaluate trigger decisions with `evidence.ruleSource`; dashboard legacy-code versus workflow-trigger-rule decisions by tenant/event. | `apps/api/test/trigger-rule-service.test.ts`, `apps/api/test/enrolments.int.test.ts`, regulatory trigger processing tests. |
| Enrolment status transitions | `apps/api/src/platform/enrolment/service.ts` retains `ALLOWED_TRANSITIONS` as fallback/default transition matrix. | `TransitionValidator` checks configured value-set transitions where available and falls back to service matrix. | Workflow/status transition definitions with decision audit; service keeps bitemporal write and valid status invariants. | All enrolment status routes used in production tenants have configured workflow transitions and decision audit. | Count transition decisions by configured versus default source once exposed by transition decision evidence. | `apps/api/test/transition-service.test.ts`, `apps/api/test/enrolments.int.test.ts`. |
| Module registration transitions | `apps/api/src/platform/registration/service.ts` privately allows only current `registered` rows to become `withdrawn` or `completed`. | No workflow/flag guard yet. | Module registration workflow for add/drop/complete windows, prerequisite exceptions, approvals, and notifications; service keeps duplicate, capacity, prerequisite, credit, and bitemporal invariants. | Registration transition commands are invoked only from workflow-backed tasks or explicitly audited system activities. | Track registration status changes with workflow instance/task reference; report changes without workflow context. | `apps/api/test/module-registrations.int.test.ts`, future workflow registration tests. |
| Assessment mark ingestion and recalculation | `apps/api/src/platform/assessment/mark-service.ts` persists marks and calls `ModuleResultService.recalculate`. `apps/api/src/platform/assessment/module-result-service.ts` recalculates and can lock results. | Lock guard in `apps/api/src/platform/assessment/lock.ts`; no workflow/flag guard for moderation/review path yet. | Mark ingestion records facts; moderation, late penalty review, result review, override, and approval are workflow/rule driven. Calculation services remain deterministic engines. | Mark updates that affect ratifiable outcomes have workflow decision evidence unless they are pre-board automated recalculations. | Count mark/result changes by source command, workflow instance, and lock state; report manual changes without workflow context. | `apps/api/test/marks.int.test.ts`, `apps/api/test/module-results.int.test.ts`, future assessment workflow parity tests. |
| Progression decision algorithm | `apps/api/src/platform/progression/progression-service.ts` computes decision shape in `#decide` using configured numeric academic rules. | Academic rules for thresholds/credits; algorithm shape remains service code. | Rules select progression algorithm/version; workflow controls data gathering, review, discretionary decision, board approval, notification, and amendment. | Supported progression algorithm variants are modelled as rule values and selected by tenant/programme/cohort. | Record algorithm key/version and rule ids on each progression decision. | `apps/api/test/progression.int.test.ts`, event consumer tests, future algorithm-selection tests. |
| Award classification and graduation | `apps/api/src/platform/progression/award-service.ts` calculates classification from locked results and graduates via `EnrolmentService.transitionStatus`. | Academic rules for classification algorithm/boundaries; classification must match recommendation. | Classification algorithm remains rules-driven; award recommendation, discretionary uplift, approval, and graduation are workflow governed. | Award creation and graduation are workflow-backed except documented automated terminal paths. | Record workflow instance, algorithm rule ids, and uplift/discretionary gateway evidence on awards. | `apps/api/test/awards.int.test.ts`, future award workflow tests. |
| Exam board ratification | `apps/api/src/platform/governance/board-service.ts` checks external examiner signoff, ratifies board, locks module results/marks/progression decisions, and publishes governance events. | Hard service guard for external examiner signoff; lock invariants in service writes. | Board workflow for constitution, quorum, external examiner review, chair approval, deferral, escalation, and ratification task. Service keeps non-bypassable record-lock write. | Board ratification can only be completed from a workflow task with required prior steps, while service still rejects unsafe direct ratification. | Report ratification calls without workflow instance/task context; count board variants by workflow definition. | `apps/api/test/exam-boards.int.test.ts`, future board workflow tests. |
| Correction and appeal cases | `apps/api/src/platform/governance/correction-service.ts` retains `ALLOWED_STATUS_TRANSITIONS` as fallback/default matrix and performs locked-record amendments. | `TransitionValidator` plus service default matrix; amendment only allowed for upheld cases. | Correction/appeal workflow definitions own review, eligibility, panel, outcome, amendment, and notification steps. Service keeps locked-record amendment authority. | All correction status changes are workflow-backed and default matrix is unused. | Count correction transitions by configured/default source and workflow context. | `apps/api/test/correction-cases.int.test.ts`, `apps/api/test/transition-service.test.ts`. |
| Regulatory exchange submission | Regulatory services such as UCAS, SLC, UKVI, HESA, OfS own submission/extract flows; `RegulatoryExchangeService` now applies endpoint safety classes. | Environment safety class and `liveTrafficApproved`; service-specific trigger processing remains. | Regulatory workflows own prepare, validate, approve, submit, receive response, amend, and resubmit routes. Exchange service remains common ledger/safety guard. | Submission-capable regulatory flows are workflow/flag gated and environment safe by construction. | Dashboard outbound exchanges by environment, endpoint safety class, workflow context, and approval. | `apps/api/test/integration-endpoint-safety.test.ts`, regulatory integration tests, future regulatory workflow tests. |
| Finance and fee liability | `apps/api/src/platform/enrolment/service.ts` creates fee liability rows on enrolment with amount in pence; SLC formats fee amount from `amountPence`. | No multicurrency guard yet; UK/SLC paths imply GBP. | Monetary model with amount, currency code, precision, source rule, effective date, and conversion evidence. Fee/deposit/refund/commission workflows select finance route. | Fee facts are currency-aware and UK statutory outputs explicitly convert/format where required. | Report fee records missing currency context during migration; track statutory output currency assumptions. | Enrolment and SLC tests; future multicurrency finance tests. |
| Communications | Current communications are mostly represented as events, downstream triggers, or regulatory exchanges rather than a common communication workflow. | Trigger rules and integration endpoint safety classes; no locale/template abstraction yet. | Workflow-triggered communication tasks with endpoint selection, templates, locale fallback, audit, and optional CRM handoff. | Student/applicant/process communications use common communication workflow or documented integration event contract. | Count communications by workflow trigger, locale, template, endpoint, and manual override. | Future communication workflow, localisation, and notification tests. |
| Role responsibilities | `packages/domain/src/permissions.ts` retains static `PERMISSION_ROLES`; workflow assignment rules now exist for tenant variation. | RBAC permissions plus `workflow_assignment_rule`. | RBAC controls capabilities; workflow assignment rules control task ownership and institutional responsibility. | Workflow tasks do not infer owners solely from static role defaults where tenant variants exist. | Report task assignments by assignment rule versus fallback role. | `apps/api/test/workflow-responsibility-service.test.ts`, route permission tests. |

---

## Hard Invariants To Retain In Services

These controls should not be removed or made bypassable by flags:

- tenant isolation and row-level security;
- bitemporal write patterns and history preservation;
- value-set validation for active codes;
- record locks after ratification;
- correction authority for post-ratification amendment;
- duplicate current enrolment/module registration prevention;
- module capacity, prerequisite, and credit-limit checks;
- statutory/privacy/audit/security obligations;
- non-production live endpoint protection;
- currency precision and source/effective-date requirements once introduced.

Workflow may decide when and by whom a command is invoked. It must not make invalid data valid.

---

## Intended Long-Term Variants

The following differences are valid product capabilities, not legacy code to remove:

| Variant | Mechanism | Example use |
|---|---|---|
| Small institution direct approval | Workflow definition variant plus tenant flag | A single registry team approves enrolment changes, boards, and corrections. |
| Large institution staged approval | Workflow definition variant plus assignment rules | School review, faculty approval, registry ratification, and central audit. |
| Registry-led versus school-led module changes | Workflow assignment rules and tenant flags | Module add/drop exceptions owned by registry or schools. |
| Domestic UCAS, direct domestic, international direct, international agent, and clearing Admissions routes | Admissions workflow definitions and source flags | Different evidence, offer, deposit, CAS, and handoff steps. |
| Automated versus manual regulatory submission | Workflow and environment safety flags | Test tenants may rehearse file generation without live submission. |
| Centralised versus distributed exam boards | Board workflow definition variant | Central boards for small institutions; school boards with external examiner signoff for large institutions. |
| Simplified versus staged progression review | Academic rule set plus workflow variant | Automated progression for straightforward cases; discretionary cases route to panel. |
| Communication endpoint strategy | Feature flag plus communication workflow configuration | Manual tasks, email, CRM handoff, statutory file, or integration event. |
| Single-currency UK finance versus international multicurrency finance | Tenant finance configuration plus currency-aware monetary records | UK-only tenant can default GBP; international tenant can handle deposits/fees in multiple currencies. |

---

## Test and Evidence Plan

Stage 0 does not remove code, but it defines the evidence needed before later stages remove it.

| Evidence type | Required proof |
|---|---|
| Clean-path parity | For every legacy path, tests compare legacy outcome with configured workflow/rule/flag outcome before removal. |
| Non-use telemetry | Runtime decisions record legacy/configured source and workflow context where applicable. |
| Migration safety | Migrations preserve bitemporal history, audit records, external references, and regulatory evidence. |
| Mandatory control safety | Tests prove flags cannot disable audit, bitemporality, privacy, security, statutory, lock, or environment-safety controls. |
| Variant coverage | At least small-institution and large-institution tenant variants are covered for workflow assignment and approval paths. |
| Globalisation readiness | Future stages add tests for locale fallback, translated value labels, non-GBP money, precision, conversion evidence, and time-zone boundaries. |

---

## Stage 0 Exit Criteria

- Every retained legacy path has an owner, replacement path, retirement condition, telemetry requirement, and coverage target.
- Long-term variants are distinguished from temporary migration compatibility.
- Hard service invariants are explicitly protected from workflow or flag bypass.
- No production behaviour was changed.
