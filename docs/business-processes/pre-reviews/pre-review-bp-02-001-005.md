# Pre-review: BP-02-001 to BP-02-005 (initial registration, identity, finance and entitlement)

> Date: 2026-11-20
> Backlog item: BL-113
> Register row: BP-02-001–BP-02-005 in the [SME review register](../sme-review-register.md)
> Status: **AI pre-review.** This is not the institutional review or sign-off the register needs. Nothing here is approved, signed off or confirmed. A named registration, UKVI-compliance, student-finance, data-protection and integration reviewer must still review these pages.

## Header

**Items reviewed**

- [BP-02-001 Prepare a student for initial registration](../02-registration-and-student-status/bp-02-001-prepare-initial-registration.md)
- [BP-02-002 Verify identity and right to study](../02-registration-and-student-status/bp-02-002-verify-identity-and-right-to-study.md)
- [BP-02-003 Complete initial academic registration](../02-registration-and-student-status/bp-02-003-complete-initial-academic-registration.md)
- [BP-02-004 Complete financial registration](../02-registration-and-student-status/bp-02-004-complete-financial-registration.md)
- [BP-02-005 Activate access and entitlements](../02-registration-and-student-status/bp-02-005-activate-access-and-entitlements.md)
- What changed, from the [Phases 1–5 change review](../sme-change-review-phases-1-5.md) (R1 D-6, R2 D-8 and D-10, R3 D-14 and D-17 to D-19, R6 D-38) and the [Phase 2](../../decisions/phase-2-gap-closure-decisions.md) and [Phase 3](../../decisions/phase-3-gap-closure-decisions.md) decision records.
- What was built, from [current capabilities](../../product/current-capabilities.md) (`initial-annual-registration-and-status`, `person-identity-and-student-profile`, `integration-registry-and-exchange-operations`), [ADR-017](../../decisions/ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md), [ADR-019](../../decisions/ADR-019-per-target-exchange-ledger-and-reconciliation.md), [ADR-025](../../decisions/ADR-025-self-service-audiences-and-identity-binding.md) and [core principles](../../core-principles.md) §3.
- The code:
  - `apps/api/src/platform/registration/right-to-study-service.ts` and `financial-registration-service.ts`;
  - `apps/api/src/platform/registration-periods/service.ts`;
  - `apps/api/src/platform/admissions/applicant-conversion-service.ts`;
  - `apps/api/src/platform/delivery/producers/access.ts`;
  - `apps/api/src/app.ts`;
  - `packages/db/src/schema/enrolment.ts`;
  - `packages/domain/src/permissions.ts`.

**Roles taken:** UK HE academic registrar (registration and enrolment), UKVI Student sponsor compliance officer, student-finance and fees officer, and data-protection reviewer.

**Sources consulted**

| Source | Version or date read |
|---|---|
| UKVI, [Student sponsor guidance, Document 2: Sponsorship duties](https://www.gov.uk/government/publications/student-sponsor-guidance/sponsorship-duties-accessible) | Version 10/2026, for use from 8 October 2026. The paragraphs read were 2.7–2.10, 2.17, 2.28–2.31, 7.5 and 7.7–7.8. |
| CMA, [UK higher education providers: advice on consumer protection law (CMA182)](https://www.gov.uk/government/publications/higher-education-consumer-law-advice-for-providers) | May 2023, last updated 31 May 2023. It predates the DMCC Act 2024 unfair-practice provisions, in force from 6 April 2025. |
| UK GDPR articles 5(1)(c), 6, 9 (biometric data for unique identification) and 35 (DPIA), with ICO guidance on special category and biometric data | Read as at 2026-11-20. ICO biometric guidance edition not recorded. |
| [Source register](../source-register.md) | SRC-001 to SRC-005, SRC-014, SRC-031 to SRC-037 |

## Summary

The registration chain is now real:
- conversion creates a `pre-registration` enrolment;
- an initial registration period confirmation records the terms version and channel;
- right to study is its own bitemporal record, with referral to a second person and expiry scanning;
- financial status is separate from academic status, and holds do not block by default;
- the IAM and study access levels follow a status matrix.

The gaps that matter:
- a student can register without any identity-verification outcome;
- fee liability and financial holds are overwritten in place, against principle §3;
- API routes do not enforce the access matrix;
- "core access ready" has no definition or acknowledgement model.

The process pages are still the July v0.1 drafts.

**Findings:** 0 Blocker, 5 Major, 6 Minor, 3 Observations.

## Findings

| # | Severity | Process | What is wrong | Evidence | What to change |
|---|---|---|---|---|---|
| F1 | Major | BP-02-002, BP-02-003 | Initial registration does not require an identity-verification outcome. The only blockers are right to study and financial registration. With `rightToStudy.scope` set to `sponsored` or `none`, a UK student registers with no identity check at all. This contradicts BP-02-002 BR-1 and step 6 ("permits BP-02-003 when required checks pass"). | `composeBlockers(rightToStudy, financialRegistration)` (`app.ts:443`). `registration-periods/service.ts` has no identity-verification reference. | Add an identity-verification blocker provider for `initial` periods, with configurable scope (default all new entrants). Accept the passport-based right-to-study check as satisfying it where the methods coincide. |
| F2 | Major | BP-02-004 | `fee_liability`, including financial status, hold reason and payer arrangement, is not bitemporal and is updated in place. Earlier statuses and holds cannot be recovered except from audit rows and outbound snapshots. Core principle §3 names "tuition fee liability and financial holds" as bitemporal. A disputed hold (CMA risk) needs its history. | `feeLiabilities` has no `bitemporalColumns` (`packages/db/src/schema/enrolment.ts:72–94`). `updateStatus` does `tx.update(feeLiabilities).set(...)` (`financial-registration-service.ts:99–121`). | Make `fee_liability` bitemporal, or add an append-only `financial_status_history` with valid and transaction time. Migrate the current rows as the first versions. |
| F3 | Major | BP-02-001, BP-02-005 | A `pre-registration` student signs in with the `student` role. API routes do not enforce the access matrix ("limited" in D-19), so student-scoped routes are reachable before registration. This is Phase 2 risk 2, and the D-19 implementation note admits it ("API routes for students do not yet enforce the matrix themselves"). | `pre-registration` appears in no file under `apps/api/src/routes/` except the conversion audit text. Matrix: `delivery/producers/access.ts:24`. | Add a route guard driven by the matrix: a `pre-registration` student may use only the registration, right-to-study, profile and notification routes. Test it. |
| F4 | Major | BP-02-005 | No per-target application acknowledgement exists, and "core access ready" is undefined. Step 5 ("without treating partial success as complete") and step 6 (notify when core access is ready) cannot be met. Every delivery flow defaults to a staff task. | `integration-registry-and-exchange-operations` limitation: "Attempt rows do not yet form the proposed durable target/application-acknowledgement model". `GET /students/{id}/entitlements` shows only the latest instruction. | Define the core-ready set (BP-02-005 OQ-1 below) and record a per-target `applied` acknowledgement (ADR-019). Compute overall readiness from those acknowledgements, and notify the student once. |
| F5 | Major | All five | The pages are v0.1 of 2026-07-26, but the change pack lists BP-02-001, BP-02-002, BP-02-004 and BP-02-005 as changed. The data entities named do not match the schema: `student_obligation`, `account_access_state`, `payment_confirmation` and `student_hold` versus the real `right_to_study_check`, `reenrolment_confirmation` and `fee_liability.financial_status_code`. The BR-3 "REVELATION" rows are stale. | Page headers and Traceability rows; schema files. | Update each page to the built states, permissions (`right-to-study:record`/`decide`, `financial-registration:write`, `registration-period:manage`), configuration keys and remaining gaps. Bump the version. |
| F6 | Minor | BP-02-002 | The right-to-study scope default ("all entrants") goes beyond what UKVI requires. UKVI requires checks for sponsored students and for unsponsored EU/EEA nationals enrolling on or after 1 July 2021 (Doc 2 2.28–2.31). Checking British and Irish citizens is a choice, and needs a stated lawful basis and the minimum evidence kept (art. 5(1)(c)). | D-17 "Who it covers"; `rightToStudy.scope`. | Keep the default if the institution wants it, but record the lawful basis in the privacy notice, and for non-sponsored students keep the outcome, not the document. |
| F7 | Minor | BP-02-003 | One tenant-wide `registrationTermsVersion` cannot vary by programme, route or audience (PGR, partner-delivered, apprenticeship, Student route). Only one version is recorded, not a set of declarations. | `registration-periods/service.ts:102,220–222`; `reenrolment_confirmation.terms_version`. | Allow a terms bundle per period or per programme group. Record the declaration codes accepted with their versions. |
| F8 | Minor | BP-02-004 | A fee-status reassessment is governed (another finance administrator decides), but the original assessment in admissions has no recorded evidence or questionnaire, and no appeal route is modelled. D-18 leaves the appeal route open. | `feeStatusBasisCode` is a bare code on the offer; `proposeFeeStatusChange` (`financial-registration-service.ts:143`). | Record the assessment evidence reference on the offer. Add an appeal outcome to the reassessment case. |
| F9 | Minor | BP-02-002 | Who may decide a referred right-to-study check is the regulatory officer only, which suits sponsored students. Unsponsored non-eligibility, such as EUSS status, is also decided by the compliance team. Some institutions route that to Registry. | `permissions.ts:153`. | Leave as is; the institution confirms (D-17). |
| F10 | Minor | Sources | SRC-002 lists 04/2026 (current: 10/2026). D-8 and D-18 cite the CMA 2015 guidance, which is withdrawn; CMA182 (2023) and the DMCCA 2024 are current. | [Source register](../source-register.md); decision records. | Refresh the citations. |
| F11 | Minor | Capability page | The `person-identity-and-student-profile` row says right to study is not a separate outcome, which contradicts the registration row and D-17. | [Current capabilities](../../product/current-capabilities.md), line 31. | Remove the stale clause. |
| O1 | Observation | BP-02-002 | The UKVI non-enrolment report (10 working days after the enrolment period ends, Doc 2 7.5) is implemented through D-9 with working days (D-42). It matches the guidance read. | `initial-annual-registration-and-status` row. | None. |
| O2 | Observation | BP-02-004 | `pre-registration` raises no fee liability and is left out of SLC, HESA, OfS and FOI counts, as D-10 says. The HESA exclusion was seen at `hesa-service.ts:649`; the SLC and OfS exclusions were not traced line by line. | D-10 implementation note. | A test asserting each exclusion is advisable. |
| O3 | Observation | BP-02-003 | Sending UCAS the registration confirmation (step 7) depends on `ucasPersonalId` reaching the enrolment at conversion. It is now set (`applicant-conversion-service.ts`), but the outbound message itself was not traced. | Phase 3 risk 2. | Confirm in the demo. |

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| BP-02-001 OQ-1 | Is an explicit registration-case or worklist entity required? | **Propose closing: no new entity.** The `pre-registration` enrolment, its `reenrolment_confirmation` in an `initial` registration period, and the composed blockers already form the worklist. Each blocker is computed with its own message, and lapses go to BP-02-011. Add a derived, read-only pre-arrival checklist (identity, right to study, CAS and entry date, finance, declarations) to the registration screen rather than a stored case. Revisit only if institutions need manual tasks that no blocker can express. | Medium | Registration product owner |
| BP-02-002 OQ-1 | Canonical evidence retention, and governance of automated biometrics | **Stays open.** Proposed default:<br>• Sponsored students: keep the passport, eVisa or View and Prove copy and the entry-date evidence for the period of sponsorship plus one year, or until a compliance officer has approved them if that is sooner (Doc 2 2.7, 2.10 and 2.17).<br>• Everyone else: keep only the outcome, basis, method, checker and date; delete document images within 6 months of registration.<br>• Automated facial matching by an online identity-verification provider processes biometric special-category data (art. 9). It needs a DPIA (art. 35), an art. 9 condition (explicit consent is the realistic one), a non-biometric alternative of equal standing (A3), and processor terms that bar the provider from reusing templates. Keep `evidence_ref` as a restricted pointer only (ADR-017). | Medium | DPO and the information security owner |
| BP-02-003 OQ-1 | Add the declaration and terms version, and the channel, to the registration entity? | **Propose closing: largely done.** `reenrolment_confirmation` already records `terms_version`, `channel_code` (`portal` or `assisted`), `assisted_reason_code`, `confirmed_by` and `confirmed_at` for initial and annual periods. The remaining work is the set of declarations per programme group (F7). | High | Data owner with the DPO; the institution names the declarations (D-10) |
| BP-02-004 OQ-1 | Explicit academic and financial registration sub-statuses? | **Propose closing.** D-18 is built: `fee_liability.financial_status_code` (`pending`, `arranged`, `hold`, `not-required`) sits alongside the enrolment status. Non-tuition holds never block, and `registration.financialHoldBlocks` defaults to `none`. Closing assumes F2 (bitemporal history) is accepted as new work. | High | Student finance product owner |
| BP-02-005 OQ-1 | The canonical entitlement policy matrix and the core-ready threshold | **Partly closable.** The matrix is decided and built (D-19: `pre-registration` limited, `enrolled` full, through to `graduated` until leaver closure plus 90 days). **Core-ready stays open.** Proposed default: core-ready means IAM `full` applied, plus portal, plus a base VLE course, plus library borrower, each acknowledged by its target. Module rosters follow BP-03-006 and do not hold back core-ready. | Medium | IT services or integration owner with the Registry product owner |

## Still needs a named person

- **Academic Registrar:**
  - the declarations required at registration, and anything that must be done in person (D-10);
  - whether identity verification blocks initial registration, and for whom (F1).
- **Authorising Officer / Compliance lead:**
  - the right-to-study scope policy and the methods accepted, including remote video checks (D-17);
  - who may refer and decide ineligibility.
- **Head of Student Finance:**
  - the fee-status assessment policy and appeal route;
  - whether any tuition hold is used (`registration.financialHoldBlocks`, D-18).
- **DPO and information security owner:** BP-02-002 OQ-1 (retention and biometrics), and the lawful basis for checking British and Irish citizens (F6).
- **IT services or integration owner:**
  - the core-ready threshold;
  - the grace periods and alumni email policy;
  - whether open complaints or OIA cases keep access (D-19);
  - the IAM link agreement (D-14, D-38).
- **Four-nation reviewers:** SAAS, SFW and SFNI arrangement codes for `payer_arrangement_code`, and the Welsh-language registration terms.

## Not checked

- Tests were not run, and no figure here depends on one.
- The portal registration journey and the admin Registration screens were not exercised.
- Online identity-verification provider contracts and any DPIA were not available.
- The SLC, SAAS and SFNI confirmation flows (BP-07-002) are out of scope and were not traced.
- The institution's registration regulations, terms and fee policy were not available.
- How the Finance inbound contract `finance-payment-and-hold.v1` behaves against a real finance system: there is no live link (D-14).
