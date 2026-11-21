# Pre-review: BP-01-001 to BP-01-007 (recruitment, offers, CAS, Clearing and conversion)

> Date: 2026-11-20
> Backlog item: BL-123
> Register row: BP-01-001–BP-01-007 in the [SME review register](../sme-review-register.md)
> Status: **AI pre-review.** This is not the institutional review or sign-off the register needs. Nothing here is approved, signed off or confirmed. A named admissions, UKVI-compliance, UCAS, national and data-protection reviewer must still review these pages.

## Header

**Items reviewed**

- [BP-01-001 Receive an application](../01-recruitment-and-admissions/bp-01-001-receive-an-application.md)
- [BP-01-002 Assess an application](../01-recruitment-and-admissions/bp-01-002-assess-an-application.md)
- [BP-01-003 Make and manage an offer](../01-recruitment-and-admissions/bp-01-003-make-and-manage-an-offer.md)
- [BP-01-004 Confirm offer conditions](../01-recruitment-and-admissions/bp-01-004-confirm-offer-conditions.md)
- [BP-01-005 Create and assign a CAS](../01-recruitment-and-admissions/bp-01-005-create-and-assign-a-cas.md)
- [BP-01-006 Place an applicant through Clearing](../01-recruitment-and-admissions/bp-01-006-place-an-applicant-through-clearing.md)
- [BP-01-007 Convert an accepted applicant to a prospective student record](../01-recruitment-and-admissions/bp-01-007-convert-an-accepted-applicant-to-a-prospective-student-record.md)
- What changed, from the [Phases 1–5 change review](../sme-change-review-phases-1-5.md) (R2 D-10 and D-13, R3 D-14 to D-16, R6 D-38 and D-39) and the [Phase 2](../../decisions/phase-2-gap-closure-decisions.md), [Phase 3](../../decisions/phase-3-gap-closure-decisions.md) and [Phase 5](../../decisions/phase-5-gap-closure-decisions.md) decision records.
- What was built, from [current capabilities](../../product/current-capabilities.md) (`admissions-and-applicant-conversion`, `cas-and-student-sponsor-compliance`, `person-identity-and-student-profile`), [ADR-017](../../decisions/ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md), [ADR-019](../../decisions/ADR-019-per-target-exchange-ledger-and-reconciliation.md), [ADR-022](../../decisions/ADR-022-cas-and-sponsor-compliance-evidence-boundary.md), [ADR-025](../../decisions/ADR-025-self-service-audiences-and-identity-binding.md) and [core principles](../../core-principles.md).
- The code:
  - `apps/api/src/platform/admissions/application-service.ts`, `clearing-service.ts`, `applicant-conversion-service.ts` and `applicant-portal-service.ts`;
  - `apps/api/src/platform/regulatory/cas-case-service.ts`;
  - `apps/api/src/routes/applications.ts`;
  - `packages/db/src/schema/admissions-application.ts`;
  - `packages/domain/src/permissions.ts`.

**Roles taken:** UK HE admissions manager (UCAS and direct admissions), UKVI Student sponsor compliance officer, and data-protection reviewer for applicant data.

**Sources consulted**

| Source | Version or date read |
|---|---|
| UKVI, [Student sponsor guidance, Document 2: Sponsorship duties](https://www.gov.uk/government/publications/student-sponsor-guidance/sponsorship-duties-accessible) | Version 10/2026, for use from 8 October 2026. The paragraphs read were 2.3, 2.7–2.10, 2.22, 2.28–2.31, 3.11, 3.22, 5.10–5.42 and 7.5. |
| CMA, [UK higher education providers: advice on consumer protection law (CMA182)](https://www.gov.uk/government/publications/higher-education-consumer-law-advice-for-providers) | May 2023, last updated 31 May 2023. It was published before the Digital Markets, Competition and Consumers Act 2024 unfair-practice provisions came into force on 6 April 2025. The 2015 advice is withdrawn. |
| UCAS, [changed course offers](https://www.ucas.com/undergraduate/after-you-apply/types-offer/replying-your-ucas-undergraduate-offers) and [unconditional change confirmation (UCC) decisions](https://www.ucas.com/providers/services/news/unconditional-change-confirmation-ucc-decisions) | Read 2026-11-20. Applicants reply to a changed-course offer within 5 days. UCAS news item, June 2024. |
| OfS, [initial condition C5: treating students fairly](https://www.officeforstudents.org.uk/media/30xmpwxj/initial-condition-c5-treating-students-fairly.pdf) | In force for registration applications from 28 August 2025. It went into the regulatory framework in the September 2025 consolidated amendments. |
| UK GDPR articles 9 and 10, and DPA 2018 section 10 and Schedule 1 | Read as at 2026-11-20, as amended by the Data (Use and Access) Act 2025. Commencement of every DUAA provision was not checked. |
| [Source register](../source-register.md) | SRC-001, SRC-002, SRC-015 to SRC-019, SRC-051 to SRC-054, as listed |

## Summary

The software now covers far more than the July process pages describe:
- a channel-neutral application with an immutable received payload;
- assess, recommend and decide kept apart;
- versioned offers and per-condition evidence;
- the UCAS outbox and results matching;
- a governed Clearing fast path;
- one CAS case record;
- idempotent conversion into `pre-registration`.

The pages themselves are still the July v0.1 drafts and no longer describe the system. Reviewers would be reviewing stale text.

Six control gaps matter most:
- one person can verify and decide the same condition;
- an offer can be changed or confirmed onto another course without the applicant's consent;
- an offer withdrawal records no reason;
- an identity is matched automatically on a student number alone;
- Clearing has no capacity check;
- a CAS can be prepared on a conditional offer without the full set of eligibility checks.

**Findings:** 0 Blocker, 11 Major, 10 Minor, 4 Observations.

## Findings

| # | Severity | Process | What is wrong | Evidence | What to change |
|---|---|---|---|---|---|
| F1 | Major | BP-01-004 | One person can record evidence as verified and then decide the condition met, so verification and decision are not separated. This is Phase 3 Risk 5, still open. | `recordEvidence` accepts `verified: true` from the caller (`application-service.ts:368`). The route needs `application:receive` (`routes/applications.ts:116`), and `registry-administrator` holds both that and `offer:decide` (`permissions.ts:270,273`). `decideCondition` does not compare the decider with `receivedBy`. | Only `ucas-results` (or another trusted feed) may set `verified`. Otherwise require a separate verify action, and refuse a `met` decision by the person who verified the evidence. |
| F2 | Major | BP-01-003, BP-01-004 | A change to an accepted offer keeps it `accepted`, and a `confirmed-alternative` outcome starts the enrolment hand-off without the applicant agreeing. UCAS requires the applicant to accept a changed-course offer (5 days). Under CMA182 a material change to an accepted offer is a contract variation needing consent. This contradicts BP-01-003 A1.1 and E2.1. | `application-service.ts:341` ("An accepted offer stays accepted through an authorised change"); `confirm()` at :398 starts `startHandoff` for `confirmed-alternative`. | A change to programme, mode, intake or offer type after acceptance, and a changed-course confirmation, should create a version awaiting the applicant's response, with an expiry. Conversion is blocked until the applicant accepts. |
| F3 | Major | BP-01-003 | Withdrawing an offer records no actor and no reason on the offer, accepts any `made` or `accepted` offer, and does no impact review. Withdrawing an accepted offer is a breach-of-contract risk. | `withdrawOffer(tenantId, offerId)` takes no actor or reason (`application-service.ts:353`). The route body is `Type.Object({})` (`routes/applications.ts:109`). Only the generic audit row records the actor. | Require a value-set reason code and free text. Record `withdrawnBy`. Require a second approver, or at least a reason category, for withdrawing an accepted offer. |
| F4 | Major | BP-01-003, BP-01-007 | Deferred entry and advanced entry cannot be recorded. `changeOffer` cannot change the intake, and the offer has no entry stage or year of programme. Direct entry to year 2 is routine in Scotland, and both are common for RPL. | `changeOffer` input lacks `intakeCode` (`application-service.ts:320`). The `admissions_offer` columns (`admissions-application.ts:72–86`) have no stage, location or campus. | Add intake change (deferral) as an offer version needing applicant acceptance (see F2). Add `entry_stage_code` and `teaching_location` to the offer, and carry both through conversion. |
| F5 | Major | BP-01-003 | Nothing records what pre-contract material information was given (terms and conditions version, fee amount, delivery mode and location) when the offer was made and accepted. CMA182 expects material information before acceptance, and OfS C5 assesses fairness to students. | `admissions_offer` has no terms version, fee amount or offer-letter reference. `respond()` stores only the response, timestamp and channel. | Record `terms_version` and an `offer_letter_document_ref` on each offer version, and snapshot them at acceptance, as `reenrolment_confirmation.terms_version` already does for registration. |
| F6 | Major | BP-01-001, BP-01-006, BP-01-007 | Identity matching treats a supplied `studentNumber` or `personId` as certain, without checking name or date of birth. A mistyped or false number binds the application to someone else's person record and starts an applicant account request for that person (D-39). The duplicate check is an exact, case-insensitive first-name and family-name match only, so spelling variants and name changes create duplicates. This is ADR-025 risk 6 ("keep `needs-review` strict"). | `#matchApplicant` (`application-service.ts:473–499`); the account request at :155. The Clearing call body accepts `personId` and `studentNumber` (`routes/applications.ts` Clearing schema). | Require corroboration (date of birth plus surname, or a verified UCAS Personal ID) before `matched`; otherwise `needs-review`. Add date-of-birth and normalised-name candidates. Never queue an account for an uncorroborated match. |
| F7 | Major | BP-01-006 | There is no vacancy or capacity check or reservation. The page's purpose ("never confirms more places than it has vacancies for"), step 2 and E2.1 are not met. Eligibility is only "programme listed in `clearing.programmeIds`". | `ClearingService.takeCall` (`clearing-service.ts:96`). No capacity or vacancy column for programmes or intakes exists in the schema (searched `packages/db/src/schema`). | Add an intake capacity and Clearing vacancy count per programme, intake and mode. Decrement it on a verbal or firm offer, release it when an offer expires, and refuse or queue a call when no places are left. |
| F8 | Major | BP-01-005 | A CAS can be prepared when the latest check of each *recorded* type has passed. No mandatory set of check types is enforced, and the course is taken from an offer that may still be `made` or `accepted` (conditional). UKVI requires a CAS only after an unconditional offer has been accepted, and confirmation that the student meets the requirements before assignment (Doc 2 3.22, 5.10). | `prepare()` (`cas-case-service.ts:205–219`) builds `latest` from whichever checks exist. `#personData` takes offers in `made`, `accepted` or `confirmed` (:371). | Refuse `prepare` unless the offer is unconditional (or confirmed) and accepted. Make the required check types (identity, immigration history, academic progression, English language, financial, ATAS where applicable, genuine student) a value set of mandatory checks, with an "exempt with reason" outcome. |
| F9 | Major | BP-01-005 | The prepared CAS payload does not include the evidence UKVI expects on the CAS. A manual SMS entry will rely on the officer rekeying it, outside the snapshot hash (ADR-022). | `#personData` returns name, date of birth, nationality, programme, mode, intake and start date only (`cas-case-service.ts:361–387`). It has no course end date, fees, fees paid, English assessment method, academic progression or exemption reason, ATAS, main study address or passport number. Doc 2 3.11, 5.26–5.27 and 5.39. | Extend `ukvi/cas-request-outbound.v2` to a v3 with these fields, populated from the eligibility checks and the offer, so the hash covers what is sent. |
| F10 | Major | All seven | The process pages are still v0.1 of 2026-07-26, although the change pack lists BP-01-003 to BP-01-007 as changed. Their BR-3 "REVELATION" rows describe gaps that are now closed, for example BP-01-001 ("does not separate immutable received payload…") and BP-01-005 ("W012 needs a durable eligibility checklist…"). The steps name actors and permissions that do not exist, and the sequence diagrams are generic. | The page headers; `git log` on `docs/business-processes/01-recruitment-and-admissions/` (last content change 7e7bad3); the change pack R2, R3 and R6. | Before a named reviewer is asked to sign, update each page: actual states, permissions (`offer:decide`, `clearing:decide`, `cas:prepare`, `cas:approve`), configuration keys and the remaining gaps from this record. Bump the version. |
| F11 | Major | BP-01-002, BP-01-006 | Criminal-offence and safeguarding data are not restricted. The Clearing call's `convictionDeclared` and `safeguardingConcern` flags are stored in the general received payload. Safeguarding assessment notes are readable by every `application:read` holder (registry administrators, programme approvers and the integration service). This conflicts with ADR-017 and UK GDPR art. 10 / DPA 2018 Sch. 1 (an appropriate policy document and the minimum necessary). | `clearing-service.ts` `takeCall` payload; `routes/applications.ts` `GET /applications/:id` (`application:read`); `permissions.ts:269`. | Store only "routed to the standard route" in the payload. Hold conviction, fitness-to-practise and safeguarding detail as restricted evidence with its own read permission, and leave it out of the general application DTO. |
| F12 | Minor | BP-01-002 | Only the recommender is barred from deciding. An assessor who did not recommend may decide their own assessment. | `decide()` checks only `recommendedBy` (`application-service.ts:226–227`). | Make it configurable whether assessors are barred too. Default off; the institution chooses. |
| F13 | Minor | BP-01-006 | The fast path writes an `academic` `meets` assessment without saying which entry requirements were checked. The next-day review has a due date but nothing escalates when it is overdue, and `correction-needed` is not linked to the offer change that should follow. | `clearingFastPath` (`application-service.ts:261`); `ClearingService.review`. | Record the criteria version checked. Raise an overdue item on the worklist. Keep the review case open until an offer change or a stated "no change" is recorded. |
| F14 | Minor | BP-01-007 | A person with two confirmed applications can be converted twice into two `pre-registration` enrolments. Nothing implements A1.1 ("one selected enrolment intention"). | `ApplicantConversionService.preview` checks only this application's blockers. | Add a blocker or warning when the person already has a `pre-registration` or `enrolled` enrolment for the same entry year. |
| F15 | Minor | BP-01-004 | `confirm()` starts the enrolment hand-off before it inserts the confirmation decision, so a failure leaves a hand-off without a decision. | `application-service.ts:414–437`. | Start the hand-off from an outbox written in the same transaction. |
| F16 | Minor | BP-01-001 | The payload hash uses `JSON.stringify`, which is not canonical, so a resend with its keys reordered is stored as a new payload. | `application-service.ts:118`. | Use the JCS canonical form already planned for award documents (Phase 5 risk 5). |
| F17 | Minor | BP-01-003 | The only responses are accept and decline. "Request a change" (step 5) and UCAS replies such as firm or insurance are not modelled. | `respond()` input union; `routes/applications.ts` response schema. | Add firm and insurance from the UCAS feed, and a change-request response on direct channels that opens a worklist item. |
| F18 | Minor | BP-01-005 | `cas.approverMustDiffer` can be switched off in tenant configuration with no record of who did it or why. | `cas-case-service.ts:389–392`. | Keep it, but audit configuration changes. Show the setting on the CAS panel when it is off. |
| F19 | Minor | All | There is no admissions role. `registry-administrator` combines admissions decisions, Clearing decisions, enrolment and right-to-study recording, which is wide for least privilege. | `permissions.ts:228,270–273,45,152`. | Add an `admissions-officer` role and move the application and offer permissions to it. Registry keeps conversion. |
| F20 | Minor | Sources | Four citations are out of date:<br>• SRC-002 lists Version 04/2026, but the current Sponsorship duties is 10/2026 (8 October 2026).<br>• SRC-053 cites the 2018 QAA advice and guidance, which the 2024 UK Quality Code superseded.<br>• D-8 and D-18 cite the CMA's 2015 guidance, which is withdrawn (CMA182 of May 2023 is current, read with the DMCC Act 2024).<br>• The BP-01-007 sources table cites SRC-015 to SRC-019 (internal documents) as external evidence. | The [source register](../source-register.md) and the decision records. | Refresh the source register, and re-cite CMA182 and the DMCCA in D-8 and D-18. |
| F21 | Minor | Capability page | The `person-identity-and-student-profile` row still says "right to study is still recorded with UKVI, not as a separate identity outcome". The registration row and D-17 say it is now separate. | [current capabilities](../../product/current-capabilities.md), line 31. | Remove the stale clause. |
| O1 | Observation | BP-01-003, BP-01-004 | The UCAS decision codes in `ucas-decision-crosswalk` are placeholders, and no UCAS or SMS link is live (manual file only, D-14). | Implementation note to D-15. | The institution must load the code crosswalk for each cycle before any UCAS-channel use. |
| O2 | Observation | BP-01-001 to BP-01-004 | Welsh-language applicant communications and a Welsh-medium course flag are not evidenced. Welsh Language Standards apply to Welsh providers. | Page "Wales" sections; `globalisation-locale-and-currency` is Partial. | Confirm with the Medr and Welsh-language reviewer. |
| O3 | Observation | BP-01-002 | There are no explicit fields for contextual admissions or PGR assessment (proposal, supervisory capacity). They depend on the assessment-type value set. | `application_assessment.assessment_type_code` is a value-set field. | This is configuration, not code: add value-set members per institution. |
| O4 | Observation | BP-01-001 to BP-01-004 | No admissions complaint or appeal route is modelled. The UUK Fair admissions code and the OIA expect one. | No process, route or case type found. | Record it as an institutional policy point. It could be a `business_case` process later. |

## Open questions

Every BP-01 page carries the same three generic questions. Each is answered here for its page.

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| BP-01-001 OQ-1 | Owner, workflow boundary, requirement and contract mapping | **Propose closing the boundary and mapping.** The SRS `student_application` and the append-only `application_received_payload` are the system of record for every channel. UCAS stays authoritative for a UCAS choice's status. Inbound comes through the UCAS adapter (`ucas_application` bridge), outbound through `ucas-admissions-exchange.{cycle}` (D-15), and the coverage is in the `admissions-and-applicant-conversion` capability. The named process owner stays open. | Medium | Head of Admissions (name) |
| BP-01-001 OQ-2 | National, provider and mode variants | **Propose closing.** Configuration covers:<br>• qualification types and grade scales (Scottish Highers and Advanced Highers, Welsh Baccalaureate, Irish Leaving Certificate) in `qualification-type-code` and `grade-scale-*`;<br>• channel codes;<br>• results publication dates per awarding body (embargo).<br>Code is needed for advanced entry (F4) and Welsh-language preference (O2). Part-time and PGR use the direct channel. | Medium | Four-nation SME |
| BP-01-001 OQ-3 | Specialist evidence versus minimum outcome | **Stays open.** Proposed default: the received payload stays immutable but restricted. Disability, conviction and safeguarding answers are split out into restricted evidence (ADR-017, F11). The general record keeps only routing flags. | Medium | DPO |
| BP-01-002 OQ-1 | Owner, boundary, mapping | **Propose closing the mapping.** Append-only `application_assessment` rows (type, outcome, assessor, evidence reference and version), then the recommendation, then the decision by another person. The owner stays open. | Medium | Head of Admissions |
| BP-01-002 OQ-2 | Variants | **Propose closing.** Contextual admissions, RPL and PGR factors are assessment-type value-set members (O3); there is no national code difference. The QAA 2024 Quality Code and the UUK Fair admissions code apply UK-wide. | Medium | Admissions SME |
| BP-01-002 OQ-3 | Evidence location | **Stays open.** Proposed default: references, statements and interview records stay in `packages/documents`, and the SRS holds the outcome and `evidence_ref`. For sponsored students, the evidence used to make the offer is kept for the period of sponsorship plus one year (Doc 2 2.7 and 2.22). For others, the end of the cycle plus the institution's admissions retention period. | Medium | DPO with the Compliance lead |
| BP-01-003 OQ-1 | Owner, boundary, mapping | **Propose closing.** The SRS `admissions_offer` (versioned) and `offer_condition` are the system of record. On UCAS channels the applicant's reply is UCAS's and arrives through the feed, and the portal is read-only (`admissions.applicantPortal.readOnlyChannels`). The outbound contract is per D-15. | High | Head of Admissions |
| BP-01-003 OQ-2 | Variants | **Propose closing, with new work.** Configuration covers fee-status basis codes per nation (SAAS, SFW, SFNI and SFE funding bases), offer types and expiry. Code is needed for deferral and intake change, entry stage (F4) and recorded material information (F5). | Medium | Four-nation SME |
| BP-01-003 OQ-3 | Evidence location | **Propose closing.** The SRS keeps the offer terms, the terms version and the offer-letter document reference (F5). Letters are stored in `packages/documents`. | Medium | Data owner |
| BP-01-004 OQ-1 | Owner, boundary, mapping | **Propose closing.** Results arrive through `ucas/results-inbound.v1`. The matcher writes `condition_evidence` and never decides. A holder of `offer:decide` decides each condition, then confirms; the confirmation freezes the condition snapshot. Directly submitted evidence comes through the portal, unverified. Closing assumes F1 is fixed. | High | Head of Admissions |
| BP-01-004 OQ-2 | Variants | **Propose closing.** Configure the publication dates per awarding body and series: Qualifications Scotland in early August, JCQ in mid August, the IB in early July, the Irish Leaving Certificate in late August. The embargo already uses them. Near-miss and changed-course policy is institutional (D-15). | Medium | Admissions SME |
| BP-01-004 OQ-3 | Evidence location | **Propose closing.** The SRS holds grade, provenance, `verified` and the match outcome. Certificates and transcripts stay in documents. Embargoed evidence is hidden until release. | Medium | DPO (to confirm retention) |
| BP-01-005 OQ-1 | Owner, boundary, mapping | **Propose closing the boundary.** `cas_case` and `cas_assignment_version` are the SRS record. SMS is authoritative for the CAS number and its status. Assignment is a manual file (`ukvi/cas-request-outbound.v2`). The owner must be someone UKVI accepts as key personnel or a Level 1 user (Doc 2 9.4), and stays open. | High | Authorising Officer / Head of Compliance |
| BP-01-005 OQ-2 | Variants | **Propose closing.** The Student route is reserved and the same UK-wide, so there are no national variants. Provider and route variants are configuration:<br>• sponsor licence scope;<br>• track-record status, which allows the sponsor to assess English itself (Doc 2 5.15);<br>• partner and teaching locations (A2.1, which needs the F4 location field);<br>• Child Student is out of scope. | Medium | Compliance lead |
| BP-01-005 OQ-3 | Evidence location | **Stays open.** Proposed default: keep the passport, eVisa or visa document, and the offer evidence, in restricted documents for the period of sponsorship plus one year, or until a compliance officer has approved them if that is sooner (Doc 2 2.7, 2.10 and 2.22). The SRS holds the checks with their guidance version and evidence references. | High (rule), Medium (implementation) | DPO with the Authorising Officer |
| BP-01-006 OQ-1 | Owner, boundary, mapping | **Propose closing the mapping; capacity stays open.** A Clearing call creates a `clearing` channel application. The UCAS Clearing choice reconciles to it by `cycle:ucasPersonalId`, and outbound decisions are sent only after that reconciliation (D-13, D-15). Which system masters vacancies, the SRS or a CRM, is undecided (F7). | Medium | Head of Admissions with the Planning lead |
| BP-01-006 OQ-2 | Variants | **Propose closing.** UCAS Clearing is UK-wide. Only the window dates (`clearing.opensAt`/`closesAt`) differ, and Scotland's earlier results day is covered by them. Part-time and PGT direct vacancies use the direct channel. | Medium | Four-nation SME |
| BP-01-006 OQ-3 | Evidence location | **Stays open.** Proposed default: keep the call reference, the reason and the criteria version. Do not store the declaration detail (convictions, safeguarding); record only that the applicant was routed to the standard route (F11). | Medium | DPO |
| BP-01-007 OQ-1 | Owner, boundary, mapping | **Propose closing.** Conversion is Registry's (`enrolment:write`), and completing the hand-off creates the `pre-registration` enrolment (D-10). The enrolment ID comes from the offer, so conversion is idempotent. Blockers are a confirmed offer, resolved identity, an open CAS case and a known intake. F-SIS-IAM-01 v2 is sent at conversion. | High | Academic Registrar |
| BP-01-007 OQ-2 | Variants | **Propose closing.** No national variance in conversion. Deferral (F4) and multiple confirmed applications (F14) need code. | Medium | Registration SME |
| BP-01-007 OQ-3 | Evidence location | **Propose closing.** Copy forward only the identity, programme, mode, intake, fee status, UCAS Personal ID and CAS link. The application, its assessments and its payloads stay on the application under admissions retention. | Medium | Data owner |

## Still needs a named person

- **Head of Admissions:**
  - who holds `offer:decide` and `clearing:decide`;
  - the Clearing criteria, verbal-offer hold and capacity source (D-13, F7);
  - the near-miss and changed-course policy, and who may bulk-confirm (D-15);
  - whether the admissions CRM, rather than the SRS portal, is the applicant channel (D-39);
  - whether agent-channel applicants respond themselves.
- **Authorising Officer / Compliance lead:**
  - that at least two people hold the CAS permissions;
  - the licence scope;
  - the guidance version in force (now 10/2026);
  - the mandatory CAS check list (F8);
  - whether applicants see CAS numbers (D-39).
- **UCAS link owner:** the link type and the decision-code crosswalk for each cycle (D-14, D-15, O1).
- **DPO:**
  - the restriction of criminal-offence and safeguarding data (F11);
  - the admissions evidence retention (BP-01-002 OQ-3, BP-01-005 OQ-3);
  - how long unsuccessful applicants keep accounts (`access.applicantAccountEndDays`).
- **Legal or consumer-law adviser:**
  - offer-change consent;
  - the treatment of withdrawals;
  - recording material information under CMA182 and the DMCCA 2024 (F2, F3, F5).
- **Four-nation reviewers (SFC, Medr, DfE NI sector):** advanced entry, Welsh language, and the fee-status bases.

## Not checked

- Tests were not run. No claim here rests on a test result; the evidence is the code read.
- The admin and portal screens were not exercised in the demo.
- UCAS's current-cycle provider rules (Apply/Hub decision codes, Clearing Plus) were not checked against a UCAS provider contract. Those are only available to providers.
- SMS CAS field requirements were checked against Document 2, not against the SMS CAS guide for sponsors.
- The institution's own admissions policy, terms and conditions, and sponsor licence were not available.
- The UCAS adapter's inbound mapping (`apps/api/src/platform/regulatory/ucas-service.ts`) was not read in detail.
