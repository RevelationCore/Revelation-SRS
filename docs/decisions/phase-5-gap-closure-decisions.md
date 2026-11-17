# Phase 5 Gap-Closure Decisions

> Status: Adopted (2026-11-17), implementation in progress
> Date: 2026-11-17
> Context: [Academic journey gap-closure plan](../product/academic-journey-gap-closure-plan.md), Phase 5 (audiences and evidence)
> Made by: the project's solutions-architect agent (`.claude/agents/solutions-architect.md`). Numbering continues from [Phase 4](phase-4-gap-closure-decisions.md).

Each decision lists what an institution must confirm before go-live. All Phase 5 schema goes into one core migration, `0009_audiences_and_evidence.sql` (D-47).

## What the review of the code found

These findings, checked on `main` at bf3d3e2, changed the plan's assumptions:

- Calculation evidence is written outside the decision's transaction and failures are swallowed (`progression-service.ts` `#writeProgressionEvidence`, `award-service.ts` `#writeAwardEvidence`). The award evidence row hard-codes `outcome_count`/`total_credit_value` to 0 and `rule_snapshot` to `{}`.
- Conferment recalculates the classification instead of using what was recommended.
- Every rule lookup has a silent built-in fallback (pass mark 40, boundaries 70/60/50/40, `weighted-average`), and none is recorded.
- A board decision can cite any pack of the tenant, including another board's or a superseded one; ratification refers to neither packs nor decisions, contrary to ADR-020.
- A correction ends the superseded row's valid time (`validTo: now`) instead of only closing its transaction time (ADR-013), so history claims the old value was true until the correction.
- Examiner reports check only the case status: not that the appointment belongs to the case, is confirmed, independence-checked and not recused. Many reports per appointment are allowed.
- Exceptional-circumstances outcomes are a direct edit with no separate decider, and also end valid time.
- Applicant offer responses record no actor or channel; applicants cannot withdraw.
- `srs_person_id` is a student-only claim, so staff and external examiners have no binding to their person row.
- Some capability text is out of date (reassessment plans are created at ratification by D-12; portal documents download; reduced intensity is built by D-31).

## D-35: Every calculation records the rule versions it used

**Decision.**
- **Rule provenance.** `RulesEngine.getRuleWithProvenance()` returns `{ value, ruleId, versionId, programmeId, source: 'programme' | 'tenant-default' }`; `getRule` wraps it. `resolveForEnrolment` returns the same plus `exceptionId` with `source: 'exception'`.
- **Trace.** Each calculation carries a `RuleTrace`: every rule read, every component pass-mark override (`component-override`), every built-in fallback (`built-in-default`, with the value used). Element: `{ruleTypeCode, ruleKey, ruleId|null, versionId|null, programmeId|null, source, exceptionId?, value}`.
- **Storage.** `mark.rule_versions`, `module_result.rule_versions` (jsonb NOT NULL DEFAULT '[]', per bitemporal version), `progression_calculation_evidence.rule_versions`, `award_calculation_evidence.rule_versions` and `award_recommendation_id`.
- **Evidence is written in the decision's transaction.** The swallowing `try/catch` blocks go; an evidence failure fails the calculation.
- **Classification evidence is written at recommendation.** Conferment recomputes; if the classification or any cited `versionId` differs it refuses with 409 ("the calculation changed since the recommendation; recommend again"), otherwise it links the evidence to the award. `outcome_count` and `total_credit_value` are filled in.
- **The three rule types with no consumer are wired:** `progression-pass-requirement` in the progression decision; `award-credit-requirement` at recommendation (refused below the requirement unless an aegrotat with a policy authority); `classification-discretion-zone` flags "in zone" on the preview (discretion still needs a reason). Any not wired is removed from `RULE_TYPE_DOMAIN`.
- **Exposure.** `GET /module-results/:id/evidence`, `GET /award-recommendations/:id/evidence`; `GET /progression-decisions/:id/evidence` gains `ruleVersions`; an admin "How this was calculated" panel lists type, key, value, version, valid-from and source, with a warning on built-in defaults; candidate profile snapshots include their results' `rule_versions`.
- **Tests.** `rule-consumer-coverage.int.test.ts`: for every non-selection rule type, a distinctive configured value is cited by `versionId` in some calculation's `rule_versions`. Also: a built-in fallback is recorded as such; an evidence-write failure rolls the decision back; conferment after a rule change returns 409.

**Why.** Principles 5 and 13; ADR-020; BP-05-005, BP-06-001/002 need explainable results.

**Configurable.** `rules.builtInDefaults` = `allow` (default) or `refuse`.

**Institution must confirm.** Whether built-in defaults are acceptable in production (recommended: `refuse`); its pass mark, classification boundaries and algorithm; which award-credit and discretion-zone rules apply.

**Reversibility.** Cheap.

## D-36: Data pack hash, rule manifest, decisions that cite the hash, verification

**Decision.**
- **Canonical form.** RFC 8785 (JCS) in `packages/domain/src/canonical-json.ts`, tested against the RFC's vectors. SHA-256 stored as `sha256:<64 hex>`.
- **What is hashed (`revelation.exam-board-pack.v1`).** `{schema, tenantId, examBoardId, dataPackId, packVersion, sourceTransactionTime, ruleManifestRef, candidates: [{enrolmentId, personId, profileData}] sorted by enrolmentId}`. Not `supersededById`, `generatedAt/By`, row ids or `candidateCount`. Written in the pack's insert transaction.
- **Rule manifest.** Append-only `rule_manifest(id, tenant_id, manifest_hash, content, created_at, UNIQUE(tenant_id, manifest_hash))`; `rule_manifest_ref` holds the manifest hash. Content (`revelation.rule-manifest.v1`): `asOf`, `inForce` (per programme and assessment/progression/award rule type, the version resolved at `asOf`), `builtInDefaults`, `exceptions`, `cited` (D-35 traces) and `drift` (cited versions no longer in force).
- **Decisions cite the hash.** `POST /exam-boards/:boardId/decisions` requires `packHash` and refuses (409) another board's pack, a superseded pack or a different hash; the decision stores it in `exam_board_decision.pack_hash`. `createRatificationRecord` refuses if the pack has since been superseded.
- **The ratification lock is tied to the decision.** `POST /exam-boards/:boardId/ratification` requires `{packHash}`, a current pack with that hash and a latest `ratify` decision on it; it writes `exam_board.ratified_data_pack_id`/`ratified_pack_hash`, and the event carries `packHash`.
- **Verification.** `GET /exam-boards/:boardId/data-packs/:packId/verification` (audited) recomputes the hash: `verified | mismatch | unhashed`, supersession, manifest match, each decision's hash match, and what the board was ratified against. `GET .../rule-manifest` returns the manifest.
- **Admin.** The authority tab shows the short hash, Verify and drift warnings; Decide and Ratify send the displayed pack's hash.

**Configurable.** `examBoard.pack.blockOnRuleDrift`, default `false`.

**Institution must confirm.** That a board must re-decide after any pack regeneration; whether rule drift should block a decision.

**Reversibility.** Costly once boards ratify against hashes in production; the hash is versioned by `schema`.

## D-37: Before and after version references on corrections, and the correction time fix

**Decision.**
- `#dispatchAmendment` returns before and after version ids; in the same transaction two `source_version_reference` rows (`amendment-before`, `amendment-after`) are written and referenced from the amendment.
- Foreign keys from both references, and a CHECK that both are null or both set; value set `source-version-purpose-code`.
- **ADR-013 fix.** The superseded mark, module result or progression decision row gets only `recorded_until = now`; the new version keeps the old `valid_from`/`valid_to`. The same fix applies to exceptional-circumstances updates.
- Correction-case amendments expose `before`/`after` `{versionId, recordedAt}`; the Corrections tab shows them.

**Institution must confirm.** None.

**Reversibility.** Cheap now; costly once production corrections exist.

## D-38: Who can sign in to the portal: binding, roles and account provisioning

**Decision.**
- `apps/portal` becomes the self-service portal for everyone outside the back office: students, applicants, supervisors, review panel members and examiners.
- New roles `applicant` and `pgr-examiner` (distinct from the taught `external-examiner`).
- `srs_person_id` names any person with an SRS person row. Scoping always matches `request.user.srsPersonId` to database rows, never `sub` or email.
- F-SIS-IAM-01 contract v2 adds `accountKind` (`student | applicant | external`) and `roles[]`; account state is computed per person from applications, enrolments, supervision assignments and examiner appointments, one state-sync item per person keyed by a hash of that state.
- Keycloak stays the identity provider (ADR-006); the SRS never issues credentials. Federated sign-in for external examiners is a Keycloak deployment setting.
- The portal's navigation and dashboard follow the signed-in roles.
- Recorded as ADR-025, "Self-service audiences and identity binding".

**Configurable.** `access.applicantAccountEndDays` (90), `pgr.examinerAccess.graceDays` (30).

**Institution must confirm.** That IAM will create applicant and guest accounts and set `srs_person_id`; whether federated sign-in is used for external examiners; that an HR feed creates person rows for staff.

**Reversibility.** Costly in production, cheap in Alpha.

## D-39: Applicant portal view (BP-01-003, BP-01-004)

**Decision.**
- **Binding.** An applicant sees applications whose `person_id` is their `srsPersonId` and whose identity match is `matched` or `created`; nothing while unmatched or `needs-review`. Resolving identity queues the account request in the same transaction.
- **Permissions (`applicant`).** `application:read:own`, `offer:respond:own`, `condition-evidence:submit:own`, `application:withdraw:own`.
- **Routes.** `GET /applicants/:personId/applications[/:applicationId]`; `POST .../offers/:offerId/response` (`accept | decline`); `POST .../conditions/:conditionId/evidence` (upload into `packages/documents`, classification `admissions-condition-evidence`); `POST .../applications/:applicationId/withdrawal`.
- **Shown (allow-list).** Programme, intake, mode, channel; an applicant-facing status; the current offer (type, expiry, response); conditions (description, required value, status); their own evidence and whether verified; the confirmation outcome; CAS status and number once assigned.
- **Withheld.** Assessments (notes, outcomes, assessors, safeguarding); recommendation, routing reason, identity match, payloads; decider names, condition decision notes and match outcomes; embargoed evidence; CAS eligibility checks.
- **Actions.** Respond and withdraw only on channels not in `admissions.applicantPortal.readOnlyChannels` (default `['ucas','clearing']`; UCAS applicants reply in UCAS Hub, 409). Withdrawal is refused after conversion, closes the current offer and flags any open CAS case. Evidence upload on any channel, unverified, for pending conditions on the current offer; a person still verifies and decides.
- **Schema.** `admissions_offer.responded_by`, `response_channel_code` (value set: `ucas`, `applicant-portal`, `staff-recorded`); `student_application.withdrawn_at`, `withdrawn_by`, `withdrawal_reason_code` (value set). Staff responses record `staff-recorded` and the actor.
- **Portal.** Applications list and detail (offer, conditions, upload, respond, withdraw), with a UCAS read-only banner. Two demo applicant personas.

**Configurable.** `admissions.applicantPortal.enabled`, `readOnlyChannels`, `access.applicantAccountEndDays`.

**Institution must confirm.** Whether its admissions CRM rather than the SRS is the applicant-facing channel; whether agent-channel applicants respond themselves; whether CAS numbers are shown; how long unsuccessful applicants keep accounts.

**Reversibility.** Cheap.

## D-40: PGR supervisor, review panel and examiner views (BP-03-007, BP-04-003, BP-05-010)

**Decision.**
- **Scope.** `PgrAssignmentScope.resolve(tenantId, personId)`: supervisees from current `staff_assignment` rows (`supervisor`, valid now, not end-dated; nominations give nothing); review panels from non-recused `pgr_review_member` rows; examinations from non-recused `examiner_appointment` rows.
- **Permissions.** `pgr-case:read:assigned` (`research-supervisor`, `pgr-examiner`), `pgr-review:contribute:assigned` (`research-supervisor`), `pgr-report:submit:own` (`pgr-examiner`). `research-supervisor` loses `pgr-case:read` and `employment-link:read`.
- **Routes** under `/research-staff/:personId/pgr/...`: assignments; supervisee detail (team, published milestones, review status and outcomes, examination stage, confirmed examiner names, ratified outcome, correction deadlines; never examiner reports or preliminary recommendations); supervisor report upload for an undecided review of a supervisee; panel review view with logged downloads; declare own conflict; examination view (thesis, own appointment, co-examiner, own report, co-examiner report per the exchange rule); submit report; declare own conflict.
- **Report rules (portal and staff route).** Case `examiners-confirmed`; the appointment belongs to the case, is confirmed and independence-checked and not recused; one report per appointment (unique index); `submitted_by`, `entry_channel_code` (`examiner-portal | staff-on-behalf`), `on_behalf_reason` (required for staff entry).
- Outcomes, nominations, independence checks, viva and ratification stay with staff.
- Portal pages "My research students", "My review panels", "My examinations"; demo personas for the supervisor and the external examiner.

**Configurable.** `pgr.examinerReports.exchange` = `after-all-submitted` (default), `after-own-submitted` or `staff-only`; `pgr.examinerAccess.graceDays`.

**Institution must confirm.** When reports are exchanged; whether supervisors may see examiner names; which staff hold `research-supervisor`; whether external examiners use federated or guest accounts.

**Reversibility.** Cheap.

## D-41: Exceptional-circumstances outcomes go through a governed determination (BP-04-005)

**Decision.** Changing an EC `outcome_code` becomes a proposal and a decision through `GovernedReview` (`ec-determination`, effect decisions `upheld`, `not-upheld`). The decider differs from the proposer and from whoever recorded the submission; the effect writes a new version per D-37. The PATCH route keeps non-outcome fields; new determination-proposal and decision routes; an admin worklist of pending determinations.

**Institution must confirm.** Who decides EC (panel or delegated officer).

**Reversibility.** Cheap.

## D-42: Working-day calendar for statutory deadlines

**Decision.** `non_working_day(tenant_id, date, division_code, description, source)` with RLS; division value set (`england-and-wales`, `scotland`, `northern-ireland`, plus tenant closures); import of the GOV.UK bank holidays JSON by upload (or worker fetch when `calendar.bankHolidays.source = gov-uk`); one `addWorkingDays(tenantId, from, n)` replaces the weekday-only arithmetic in non-registration, FOI, UCAS reconciliation and Clearing.

**Configurable.** `calendar.division` (`england-and-wales`), `calendar.bankHolidays.source` (`manual`).

**Institution must confirm.** Its division and closure days, and the UKVI working-day interpretation.

**Reversibility.** Cheap.

## D-43: Two small blockers

**Decision.** (a) CAS sponsor report versions are listed and recorded on the CAS panel. (b) The reassessment mark cap is applied when a repeat registration's result is aggregated, and recorded in `rule_versions` as `reassessment-plan` with the plan id.

**Institution must confirm.** None beyond the cap value already in the plan.

**Reversibility.** Cheap.

## D-44: The independent professional review of the adjustments workflow (BP-04-004)

**Decision.** Software cannot provide the review. The project writes a review pack (`bp-04-004-review-pack.md`: what is built and where, the tests that evidence each control, a demo walkthrough, the decisions for the reviewer, the Northern Ireland variant, EC free text in core) and adds a "Submitted for review" row to BP-04-004's review record. The reviewer is "Awaiting nomination" and the outcome Pending; nobody is named and nothing is marked Approved.

**Institution must confirm.** A named disability-service practitioner and a DPO as reviewers, and their outcome.

**Reversibility.** Cheap.

## D-45: SME review of Phases 1–4, and splitting the Phase 5 exit

**Decision.**
- **Code exit (verifiable now):** every journey capability meets the D-46 test. **Review exit (institution-owned):** a change review pack is submitted for every batch and the register rows are marked submitted. Approval is tracked in the register and is not a Phase 5 completion criterion.
- `docs/business-processes/sme-change-review-phases-1-5.md`: per batch, the processes changed, what changed (decisions and commits), the demo path, and every "Institution must confirm" item as a sign-off table.
- `check:review-pack` fails if a decision's "Institution must confirm" item (other than "None") is missing from the pack.
- The register gains "Submitted" and "Pack" columns; rows stay Reviewer "TBC (nomination requested)", Outcome "Pending — awaiting reviewer". Nothing is fabricated.

**Institution must confirm.** Nominations for every register role, and each batch's outcome.

**Reversibility.** Cheap.

## D-46: The objective re-rating test

**Decision.** A journey capability is **Implemented baseline** when:
1. schema exists, with RLS and a migration;
2. a service and API exist for every step of the BP's main flow;
3. every human step has a screen (an external party may be reached by manual file or the in-repo simulator, D-14);
4. every consequential state change on the main flow is a governed or recorded decision with audit, with separation of duties where the BP names it;
5. at least one integration test exercises the main flow end to end, plus a Playwright test where there is UI;
6. no stated limitation describes wrong behaviour (a wrong result, an ungoverned consequential change, lost evidence, a wrong statutory date).

Scope bounds, variants, institution policy, deployment transport, production hardening and Temporal not being live are compatible with baseline. The matrix gains a "Principal-path tests" column, checked by `check:capability-baseline`.

| Capability | Blocker | Closed by |
|---|---|---|
| admissions-and-applicant-conversion | No applicant view; responses record no actor | D-39 |
| cas-and-student-sponsor-compliance | Sponsor report versions are API only | D-43a |
| initial-annual-registration-and-status | UKVI deadline counts weekdays only | D-42 |
| curriculum-and-catalogue | None | — |
| module-selection-and-registration | None once the mark cap moves to assessment | — |
| reasonable-adjustments-and-exceptional-circumstances | EC outcome is a direct edit | D-41 |
| assessment-marks-and-module-results | No rule-version explanation; repeat mark cap not applied | D-35, D-43b |
| exam-boards-and-ratification | Pack hash and manifest unpopulated; decisions accept other boards' or superseded packs; lock independent of decisions | D-35, D-36 |
| post-ratification-correction | Version references unpopulated; valid time misstated | D-37 |
| progression-awards-and-hear | Evidence swallowed and outside the transaction; recalculated at conferment; unconsumed award rules | D-35 |
| pgr-lifecycle | No supervisor or examiner views; examiner report checks missing; supervisors read every case | D-40 |

**Institution must confirm.** None.

## D-47: Migration

**Decision.** One core migration, `0009_audiences_and_evidence.sql`, journal idx 9, `when` 1785000048000, holding every Phase 5 schema change. The core set is then at 10 of 10; the next phase squashes first.

## Build order and deferrals

S1 D-35 · S2 D-36 · S3 D-37 · S4 D-38 · S5 D-39 · S6 D-40 · S7 D-41, D-42, D-43 · S8 D-44, D-45 · S9 D-46.

**Deferred out of Phase 5:** applicant change requests and messaging; supervisors proposing milestones or examiners; examiners entering the joint report or viva outcome, and the Independent Chair acting in the portal; EC outcomes sourced from the wellbeing module; federation and Keycloak deployment configuration; PAdES/PDF-A and the ZAP scan of public verification routes.

## Risks raised for later phases

1. Academic rule edits are direct (`POST /academic-rules`); D-36 proves which rule was used, not that it was approved.
2. The rules engine's 5-minute in-process cache can serve a superseded version on other instances.
3. The taught `external-examiner` role reads all students, enrolments and registrations.
4. Board decisions and ratification records have no separation of duties.
5. Award document hashes sort only top-level keys; new issues should move to JCS under a version tag.
6. Applicant exposure depends on identity matching; keep `needs-review` strict and log portal reads.
