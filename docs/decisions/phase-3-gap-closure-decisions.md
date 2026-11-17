# Phase 3 Gap-Closure Decisions

> Status: Adopted
> Date: 2026-11-17
> Context: [Academic journey gap-closure plan](../product/academic-journey-gap-closure-plan.md), Phase 3 (integrations and outputs)
> Made by: the project's solutions-architect agent (`.claude/agents/solutions-architect.md`). Numbering continues from [Phase 2](phase-2-gap-closure-decisions.md).

Each decision lists what an institution must confirm before go-live. All schema changes go into one core migration, `0009_integrations_and_outputs.sql` (one slot is free since the 2026-11-17 squash). Update `_journal.json` with a `when` later than every earlier entry.

## D-14: What "done" means for a party we cannot reach

**Decision.** UCAS, the UKVI Sponsor Management System (SMS), Finance and the identity and access management system (IAM) are not available to us. For each of them, Phase 3 delivers four things:

1. A versioned contract in `schemas/file-contracts/<party>/` and the integration contract catalogue.
2. One ledger item per target and authoritative version (ADR-019): an `integration_exchange` row for regulatory parties, a `delivery_item` for adjacent systems. Its idempotency key is the id of the authoritative row.
3. Two transports behind a port. `manual-file` (staff export and import files) is the default everywhere and makes the process usable now. `simulator` is in the repo, with `endpointSafetyClass: 'simulator'`; integration tests, demo data and the golden Playwright suite use it.
4. Reconciliation by an application acknowledgement or an inbound snapshot. Transport delivery alone is not "applied".

A real transport is a deployment adapter, enabled per tenant through `liveTrafficApproved` (the guard already exists in `apps/api/src/platform/regulatory/exchange-service.ts`). In the traceability matrix such a process is "On screen (simulated link)", and it counts towards the Phase 3 exit.

**Why.** `exchange-service.ts` already separates `simulator`, `external-test` and `external-production` and blocks unapproved live traffic. The catalogue's simulated contracts follow the same model. The sandbox app it names does not exist, so the simulators must live in the repo.

**Consequences.** Correct the catalogue's sandbox claims. Simulators sit under `apps/api/src/platform/integration/simulators/` and are never selectable when `endpointSafetyClass` is `external-production`.

**Institution must confirm.** Its UCAS, SMS, Finance and IAM link agreements and test environments, and who runs manual file transfers.

**Reversibility.** Cheap: only the transports change.

## D-15: UCAS outbound decisions and results mapped to conditions (BP-01-003, BP-01-004)

**Decision.**

*Which events publish.* For applications on the UCAS channel (`student_application.ucas_application_id` is set), `ApplicationService` queues an outbound exchange (`ucas-decision`, contract `ucas-admissions-exchange.{cycle}`, status `queued`) in the same transaction as the decision:

- `decide`: a conditional or unconditional offer, or a rejection;
- `changeOffer`: a new offer version;
- `withdrawOffer`;
- `confirm`: confirmed, confirmed with an alternative course, or unsuccessful;
- a Clearing offer, only once a UCAS Clearing choice has been reconciled with it (D-13).

The exchange row acts as an outbox; a dispatcher sends queued items through the tenant's transport.

*No second approval.* The decision is already governed: the assess, recommend and decide separation of duties, and D-13's next-day review. The existing GovernedReview batch stays only for enrolment confirmations.

*Idempotency and ordering.* Each key is the id of the authoritative row: `ucas-decision:<offerId>` (offer versions are immutable rows), `ucas-withdraw:<offerId>`, `ucas-outcome:<offerConfirmationDecisionId>` and `ucas-reject:<applicationId>`. A later item supersedes a queued, unsent item for the same choice. A sent item is never resent; a correction is a new version. SRS outcomes map to UCAS decision codes through a value-set crosswalk, not hard-coded.

*Acknowledgement and reconciliation.* Transport acknowledgement means `sent`. When the next inbound UCAS status for that choice agrees, the item becomes `reconciled`. A mismatch, or no reconciliation within 2 working days, raises a reconciliation item on the integration worklist.

*Results.* Each result arrives as an inbound exchange (`ucas-result`, contract `ucas/results-inbound.v1.json`), keyed by Personal ID, awarding body, qualification, subject, series and grade. It is matched by UCAS Personal ID to the application's current offer (`made` or `accepted`). Automatic matching applies only to conditions with structured criteria in a new `offer_condition.match_criteria` (qualification type, optional subject, minimum grade, grade scale), compared on an ordered grade-scale value set. The matcher writes `condition_evidence` with provenance `ucas-results`, `verified = true` (the result comes from the awarding body through UCAS), `evidence_ref = integration-exchange:<id>`, `reported_value` = the grade, and a new `match_outcome_code` (`meets`, `below`, `needs-review`). Free-text conditions get the result attached as `needs-review`. Results that match no condition are listed on the application page. The matcher never sets a condition's status.

*Who confirms.* A holder of `offer:decide` decides each condition through the existing `decideCondition`. A bulk "confirm suggested met" action covers conditions whose evidence is all `meets`; each condition still records its own decider and time. `below` and `needs-review` are decided one at a time.

*Embargo (BP-01-004 E1).* Results can arrive before their publication date. Their evidence carries `embargoed_until` and stays hidden from the portal, non-admissions roles and communications until then.

**Why.** BP-01-003 (publishing offers) and BP-01-004 steps 2–6. ADR-019 requires one ledger item per version. `application-service.ts` already freezes conditions per version and requires verified evidence; only the channel and the matching are missing.

**Options considered.** Batch approval before sending (rejected: delays Confirmation and Clearing, governs the same decision twice); deciding conditions automatically (rejected: step 4 needs a human with authority); matching free text (rejected: unsafe); waiting for real UCAS access (rejected: blocks the phase).

**Configurable.** `ucas.outbound.transport` (default `manual-file`); `ucas.reconciliation.working-days` (default 2).

**Institution must confirm.** The UCAS link type and the code crosswalk per cycle; who may bulk-confirm; the near-miss and changed-course policy.

## D-16: One CAS record (BP-01-005)

**Decision.**

*System of record.* `cas_case` becomes the system of record and `ukvi_cas_request` is retired. The UKVI page's CAS tab reads `cas_case` with its latest `cas_assignment_version` (the CAS number and SMS receipt).

*What a case belongs to.* `cas_case` gains `person_id` and `application_id`, and `enrolment_id` becomes nullable; a CHECK requires an application or an enrolment (an application for a new entrant, an enrolment for an in-country extension or course change). Applicant conversion (D-10) writes `enrolment_id` onto the case. The conversion preview gets a blocker, `cas-not-assigned`, for an open, unassigned CAS case on the application, keeping D-10's promise that CAS problems are caught before the enrolment exists.

*Flow.* A worklist shows firm offers that need sponsorship; a compliance officer opens the case, records eligibility checks with their guidance version, prepares an assignment version with a snapshot hash, someone other than the preparer approves it, the CAS data is exported to SMS as a manual file, and the CAS number and SMS receipt are recorded on that version. Corrections create a new version; earlier versions are kept (ADR-022).

*What goes.* The `ukvi-cas` enrolment trigger type and the CAS submission-approval workflow: the case's approval step replaces them.

*What changes.* The sponsored-student check `isSponsoredEnrolment` reads assigned `cas_case` rows. New permissions: `cas:read` (regulatory officer, registry administrator), `cas:prepare` and `cas:approve` (regulatory officer). CAS work no longer runs under `regulatory:write`.

**Why.** ADR-022 calls for a CAS case with eligibility, an assigned version and an SMS receipt; `cas-case-service.ts` already has these, while `ukvi_cas_request` holds only a reference and a status. A CAS has to exist before the visa application, so before any enrolment.

**Options considered.** Keep `ukvi_cas_request` as the record (rejected: no evidence or versions); keep both, linked (rejected: two records); create the enrolment earlier (rejected: contradicts D-10).

**Configurable.** `cas.approver-must-differ` (default on).

**Institution must confirm.** At least two people hold CAS permissions; the sponsor licence scope; the guidance version in force.

**Reversibility.** Cheap now, costly once tenants hold CAS history.

**Implementation note (D-16).** Migration 0009 carries every current `ukvi_cas_request` row into `cas_case` (mapping its status), then drops the table. The case records the prepared payload and its preparer, so approval can refuse the same person; the payload hash is stored on the assignment version that approval creates. The `ukvi-cas-requested` and `ukvi-cas-assigned` events keep their v1 payloads, which require an enrolment, so they are published only once the case has one: at export or assignment for an in-country case, and at conversion for an applicant's assigned CAS. `ukvi_visa_status.enrolment_id` is now nullable and the status carries `cas_case_id`, because a visa is granted before the applicant is converted. The `ukviCasRequired` enrolment field no longer creates anything. The CAS file contract is now `ukvi/cas-request-outbound.v2`.

## D-17: Right to study as its own outcome (BP-02-002)

**Decision.**

*The record.* A new bitemporal table, `right_to_study_check`, per person, with optional `enrolment_id` and `cas_case_id`: `basis_code` (value set `right-to-study-basis-code`: British or Irish citizen, EUSS settled, EUSS pre-settled, sponsored Student route, other permission allowing study, indefinite leave), `method_code` (View and Prove online, document in person, document by remote video, passport from the identity check), `outcome_code` (`eligible`, `not-eligible`, `pending`, `referred`, `recheck-required`), `checked_by`, `checked_at`, `permission_expires_on` (null means not time-limited), `uk_entry_date` for sponsored students, `restriction_code`, `evidence_ref` (a restricted pointer into the documents store), an optional `identity_verification_check_id` and `recheck_due_on`. A `not-eligible` outcome is first `referred` to a regulatory officer; the specialist decision is a new version.

*Who it covers.* `right-to-study.scope` sets which entrants need a check; the default is all entrants. British and Irish citizens are recorded with the passport basis, so the system never assumes.

*Blocking.* Initial registration (the move from `pre-registration` to `enrolled`) is blocked without a current `eligible` outcome; for sponsored students it also needs a recorded entry date and an assigned CAS. Annual re-registration is blocked only if the recorded permission has expired. Both blocks come from a `RegistrationBlockerProvider`, composed with D-18's.

*Expiry.* A daily job raises a task 60 days before expiry. At expiry it raises a `ukvi_compliance_alert` (`permission-expired`) for a sponsored student, or a registry worklist item otherwise. It never changes the enrolment status. An inbound visa status change sets the current check to `recheck-required`; eligibility is never inferred from it.

*Portal.* The student sees the state and the next action, and can submit a share code, cleared once the check completes.

*Permissions.* `right-to-study:record` (registry administrator, regulatory officer) and `right-to-study:read` (those two plus the DPO), separate from `identity-verification:read` (D-6).

**Why.** BP-02-002 step 5 asks for separate outcomes with checker, method and dates. `identity_verification_check` records a provider check and fraud flag, with no basis, method or expiry. UKVI's Student sponsor guidance asks providers to check the entry date, keep the View and Prove copy, keep records for sponsorship plus one year, and check that unsponsored EU and EEA students have status that allows study, which is why scope defaults to all entrants.

**Options considered.** A check type on `identity_verification_check` (rejected: mixes in fraud data, no expiry); a business case (rejected: expiry not queryable); leaving it to UKVI (rejected: misses unsponsored students).

**Configurable.** `right-to-study.scope` (default all entrants); `right-to-study.expiry-warning-days` (default 60).

**Institution must confirm.** Its scope policy; accepted methods, including remote checks; who may refer and decide ineligibility.

## D-18: Financial registration (BP-02-004)

**Decision.**

*Definition.* An enrolment is financially registered for a year when that year's `fee_liability` has financial status `arranged` or `not-required`. This is separate from academic registration. The states are `pending` (default), `arranged`, `hold` and `not-required`.

*Fee status: the SRS owns it.* The provider determines fee status; Finance owns amounts, payments and debt. It is assessed in admissions and recorded on the offer (`fee_status_basis_code`); conversion copies it to a new `enrolment.fee_status_code`. After conversion, a change is a fee-status reassessment business case (process `BP-02-004`) decided by a finance administrator who did not propose it.

*Liability.* `fee_liability` gains `fee_status_code` (snapshot), `financial_status_code`, `payer_arrangement_code` (self-pay, SLC tuition loan, sponsor, scholarship, mixed), `finance_reference`, `hold_reason_code`, `status_source_code` (finance, SLC, manual), `status_updated_by` and `status_updated_at`.

*Flows.* Outbound F-SIS-FIN-01 (`finance-fee-liability.v1`) sends the liability snapshot; inbound F-FIN-SIS-01 (`finance-payment-and-hold.v1`) updates the status. With no integration, a finance administrator (`financial-registration:write`) updates the status by hand. An SLC notification confirming a tuition fee loan sets the arrangement to SLC tuition loan and the status to `arranged`.

*Blocking.* By default nothing academic is blocked. `registration.financialHoldBlocks` can be `none` (default) or `tuition-hold`; in `tuition-hold` mode, re-registration is blocked only when the status is `hold` with a tuition hold reason. Non-tuition reasons never block, and progression, awards and transcripts are never blocked.

**Why.** BP-02-004 calls for separate states with proportionate holds. D-8 set no fee-debt block and left a blocker-provider seam. The CMA's 2015 consumer-protection review treated withholding progression or graduation for non-tuition debt as potentially unfair. Today the offer's fee status is lost at conversion.

**Options considered.** Copying the payment ledger (rejected); blocking registration by default (rejected: CMA risk); Finance owning fee status (rejected: a provider determination).

**Institution must confirm.** Its fee-status assessment policy and appeal route, and whether any tuition hold is used.

## D-19: Access and entitlements follow status, then leaver closure (BP-02-005)

**Decision.** Access ends in two stages, by kind of entitlement:

| Kind | Examples | Follows | Effective |
|---|---|---|---|
| Study entitlements | VLE module access, library borrowing, accommodation and CMS cohort data | The enrolment status change: a status-case decision or award conferment (as today) | From the status effective date |
| Identity-level entitlements | Institutional account (IAM), email, portal login | Leaver closure: an approved leaver-closure case schedules the account's end at the decision date plus a grace period | Before closure, a withdrawn or graduated student keeps the account but has no study access |

*Default matrix* (code-defined, tenant override):

| State | Study access | Account and portal |
|---|---|---|
| Pre-registration | None | Limited |
| Enrolled | Full | Full |
| Intermitting | Suspended | Kept |
| Suspended | Suspended | Limited |
| Withdrawn | Revoked at the effective date | Until leaver closure plus 30 days |
| Graduated | Revoked at conferment | Until leaver closure plus 90 days |

*Mechanism.* A new delivery flow, F-SIS-IAM-01, carries identity, enrolment status and access level (`limited`, `full`, `suspended`, `ended`) with an effective date; a later item supersedes an undelivered one. It is produced at conversion, at each status change, and from a new leaver-closure hook (a leaver-closure approval makes no status transition). The student record gains an entitlements view.

**Why.** BP-02-005 steps 1–7. Waiting for leaver closure before removing study access would leave a withdrawn student on module rosters; removing the account at withdrawal would cut the student off from final results and appeals.

**Configurable.** The grace days per end state.

**Institution must confirm.** Its grace periods, alumni email policy, and whether open complaints or OIA cases keep access.

## D-20: Rendering and signing award documents (BP-06-004)

**Decision.**

*Rendering.* A `DocumentRenderer` port; the reference implementation is pdfmake (MIT, pure JavaScript, no browser binary). Templates are versioned layouts per document type (certificate, transcript, HEAR); neutral built-in templates ship in the repo. Documents render only from the issue's `content_snapshot`, never from live data.

*Storage.* The PDF is stored through `@revelation-srs/documents` (`ownerService: 'award-documents'`, `ownerRef` = the issue id). `document_issue` gains `rendered_document_id`, `template_code`, `template_version` and `pdf_sha256`.

*Signing.* A `DocumentSigner` port makes a detached ECDSA P-256 JWS over `{issueId, contentHash, pdfSha256, verificationCode}`. Implementations: `local-key` (development, test and demo, PEM from the environment or generated per tenant); `openbao-transit` (production default, a non-exportable key per tenant); a seam for a trust-service or PAdES provider (not built). A new table, `document_signing_key`, holds tenant, key id, algorithm, public key PEM, provider, status (`active`, `retired`, `compromised`), dates and who registered it. Public keys are published at an unauthenticated JWKS endpoint per tenant; retired keys stay published. Embedded PAdES signatures only when the tenant configures its own certificate (default off: an AGPL product cannot ship a trusted certificate); otherwise the PDF carries the verification code and a link to D-21.

*Key management.* The institution owns its key. Tenant administrators register and rotate keys (`document-signing-key:manage`). Signing happens only inside `issue()`; no endpoint signs arbitrary bytes. A compromised key makes verification report that the issuer withdrew the key.

*Revocation.* Revoking an issued document needs a second person: a request under `document:revoke`, decided by a different registry administrator (`document:revoke:approve`), as a `business_case` (process BP-06-004) with a `case_decision`.

*Portal.* Students download their own issued PDFs.

**Why.** `award-document-service.ts` already freezes a snapshot, content hash and verification code, but renders nothing. Trusted PAdES signatures need a commercial certificate, so the signature must stay independent of the provider.

**Options considered.** Headless Chromium (rejected: heavy binary, attack surface); Typst (deferred: extra binary, later PDF/A adapter); signing provider only (rejected: no contract, lock-in); no signing (rejected: no offline verification).

**Institution must confirm.** Who owns the signing key, rotation and compromise procedure; the template content (signatories, crest, wording); whether a qualified certificate is wanted.

## D-21: Third-party verification without an account

**Decision.** Public verification works only from what the holder chose to share: the code, or the file itself.

- `GET /public/v1/verify/{tenantCode}/{code}`
- `POST /public/v1/verify/{tenantCode}/file`: the uploaded PDF's SHA-256 is compared with `pdf_sha256`; the file is not kept.

Valid or superseded returns the outcome, the facts printed on the document, the signature check result and the issuer. Revoked and not found return the outcome only. Rate limit per IP (default 30 per minute). Each check is logged in `document_verification` with `requested_by: 'public'` and a salted hash of the IP, not the IP.

A check by name and date of birth (an employer or HEDD request) is not public: it stays on the staff lookup (`document:verify`), which gains a required consent evidence reference. Student-controlled share links are deferred to Phase 5.

**Why.** UK practice is consent-led: HEDD verifications need the graduate's consent, and HEARs are shared by student-issued tokens. A code-based check reveals nothing the requester does not already hold, which meets minimum necessary disclosure under UK GDPR.

**Consequences.** The first unauthenticated route that returns data: it needs a security review and a ZAP scan.

**Configurable.** `documents.publicVerification.enabled` (default on); `documents.publicVerification.discloseFacts` (default on; off returns the outcome only).

**Institution must confirm.** The lawful basis and privacy-notice wording; whether to join HEDD.

## D-22: Curriculum publication beyond programmes and modules (BP-03-001)

**Decision.** Publications add four object types in the same atomic unit:

| Object type | Key |
|---|---|
| Route (`programme_route`) | Programme code + route code |
| Rule set (`programme_rule_set`, with its `module_group` and `module_group_member` rows) | Programme code + rule-set code, plus route and entry year |
| Learning outcome | Owner type + owner code + outcome code |
| Module offering | Module code + academic period code |

Out of scope: assessment patterns (the SRS owns them), academic rules (rules engine), module relationships (deferred).

*Ordering.* Items are classified and applied in dependency order: programme, module, route, rule set, group, group member, learning outcome, offering. A reference resolves first to an item in the same publication, then to the current catalogue. An unresolved reference is invalid, and so is a reference to an item the same publication closes.

*Conflict rules.*

1. The existing base-version check applies to every item.
2. Protected items: a rule set, route or group with a current `enrolment_curriculum_binding`; a module with registrations in the current year; an offering with module registrations. Closing a protected item is invalid. Changing one is invalid unless the publication carries a correction rationale; it is then flagged `affects-students` with a count, and the publication must be applied by a holder of `curriculum-binding:approve` who did not receive it (D-7, D-11).
3. A new cohort gets a new rule set, published with an entry year. Bindings point at the rule set's id, so an in-place change would alter the rules for students already bound to it.
4. Cutting an offering's capacity below its registrations is invalid.
5. Each object type has one master: `curriculum.masteredBy.<type>` set to `curriculum-system` makes the SRS's direct write routes for that type refuse with 409.

**Why.** BP-03-001 and the traceability gap ("no protection for assigned cohorts"). `publication-service.ts` is already atomic, base-versioned and separated by D-7; `object_type_code` is text and the payload is jsonb, so no schema change is needed.

**Institution must confirm.** Which system masters each object type; who approves corrections that affect students.

## Implementation order

1. Start the external-party conversations for UCAS, SMS, Finance and IAM now; they take the longest.
2. Create `0009_integrations_and_outputs.sql`, then fix conversion and activation so they carry the UCAS Personal ID, SLC reference, funding, fee status and CAS link (risks 2 and 3).
3. D-16 CAS, which D-17 and the conversion blocker depend on.
4. D-17 right to study, then D-18 financial registration (both feed the composite blocker provider).
5. D-19 access.
6. In parallel: D-22 curriculum publication, then D-20 and D-21 award documents.
7. D-15 UCAS last on the shared path, built on the D-14 transports.

## Risks

1. **The sandbox app does not exist.** `apps/partner-systems-sandbox` is named in the integration catalogue but is absent from the repo and its history, so the simulated-contract claims are unbacked.
2. **Converted students send no UCAS or SLC confirmations.** Activation omits `ucasPersonalId`, `slcReference` and `ukviCasRequired`, and applicant conversion never sets them.
3. **CAS is unreachable for converted applicants.** The CAS request is created only at enrolment creation, which `pre-registration` suppresses.
4. **CAS and UKVI permissions are too broad.** `regulatory:write` lets the DPO and tenant and system administrators write CAS and UKVI records.
5. **One person can verify and decide a condition.** `recordEvidence` lets the recorder mark manual evidence verified, and the same person can then decide the condition met.
6. **No PDF/A.** pdfmake does not produce PDF/A; a Typst adapter is a later option.
7. **Verification codes are slightly biased.** `verificationCode()` uses `b % 30`; rejection sampling is a cheap fix before the endpoint goes public.
