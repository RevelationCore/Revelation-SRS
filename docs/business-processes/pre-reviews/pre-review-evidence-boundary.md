# Pre-review: evidence boundary for 43 process pages (BL-158)

> Status: AI pre-review. This is not a sign-off and approves nothing.
> Date: 2026-11-21
> Items reviewed: the standard open question owned by "Data protection/data owner" (OQ-3, "Which evidence stays in a specialist system and what minimum outcome enters the SRS?") on 43 pages in areas 01 and 04 to 08. [BP-04-004](../04-learning-engagement-and-support/bp-04-004-manage-a-reasonable-adjustment-case.md) already answered it on 2026-08-15 and is excluded. Areas 02 and 03 do not carry the question.
> Grounded in: [ADR-017](../../decisions/ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md), [ADR-022](../../decisions/ADR-022-cas-and-sponsor-compliance-evidence-boundary.md), [ADR-023](../../decisions/ADR-023-pgr-supervision-and-examination-authority.md), [ADR-028](../../decisions/ADR-028-exceptional-circumstances-decision-authority.md), and what `packages/db/src/schema` and `apps/api/src` store today.
> Roles taken: Data Protection Officer; records manager.

## Sources consulted

- **Regulation:** UK GDPR Articles 5(1)(c) and 9, and DPA 2018 Schedule 1, as amended by the DUAA 2025; Gender Recognition Act 2004 s.22.
- **ICO guidance:** [SRC-070](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/), read 2026-11-21.
- **Project:** [data-subject register](../../requirements/data-subject-register.md) and [coverage matrix](../../architecture/data-subject-coverage-matrix.md).
- **Code read:** these schemas and services: `circumstances.ts`, `business-case.ts`, `admissions-application.ts`, `identity.ts`, `right-to-study.ts`, `engagement-outcome.ts`, `pgr.ts`, `assessment.ts`, `governance.ts`, `progression.ts`, `award-documents.ts`, `adjustment.ts`, `regulatory.ts`. Also `routes/circumstances.ts`, `platform/governance/board-service.ts` and `platform/adjustments/distribution-dispatcher.ts`.

## Summary

ADR-017's two-layer rule fits all 43 processes, and most of the code already follows it, mainly through opaque references and outcome codes. These already conform:

- `case_evidence_reference`;
- the thesis `storage_ref` and examiner `report_ref`;
- adjustment events, which carry type, scope and validity only;
- board packs, which carry EC and adjustment codes without reasons;
- the attendance and wellbeing modules, each with its own database.

Two breaches stand out:

- **EC narrative in core:** the student's own exceptional-circumstances narrative is stored in the general SRS.
- **Unclassified free text:** about a dozen free-text "notes" columns on outcome tables have no visibility classification, though ADR-017 requires one.

For 37 of the 43 pages I propose closing OQ-3 with the default below. Six must stay open for a named decision: BP-01-001, BP-04-005, BP-05-003, BP-05-008, BP-07-001 and BP-08-003.

Findings: **0 Blocker, 2 Major, 2 Minor, 1 Observation.**

## Findings

| # | Severity | Finding | Evidence | Change |
|---|---|---|---|---|
| EB-1 | Major | **The student's EC narrative is held in core.** The portal EC submission stores the student's `description` (up to 4,000 characters, typically health or bereavement detail) in `exceptional_circumstances.notes`, and `circumstances:read` (`registry-administrator`, `wellbeing-advisor`) can read it. `ec_determination.reason` is required free text. ADR-028 puts evidence and rationale in the wellbeing EC case. The board pack correctly drops `notes`. | `routes/circumstances.ts` lines 105 and 141; `circumstances.ts`; `board-service.ts` `#getEcFlags` | Send the narrative to the EC case system, leaving core with the outcome and an opaque case reference. Make `ec_determination.reason` a coded reason plus an optional, classified note. |
| EB-2 | Major | **Free text on outcome tables is unclassified.** These columns can carry special-category or third-party narrative, and none has the visibility classification or permitted-purpose metadata ADR-017 requires: `disability_declaration.notes`, `reasonable_adjustment.notes`, `right_to_study_check.note`, `application_assessment.note`, `status_case_assessment.note`, `status_case_condition.description`, `external_examiner_signoff.commentary`, `exam_board_decision.rationale`, `misconduct_penalty_effect.penalty_detail`, `award_recommendation.discretion_reason` and `thesis_submission.restriction_reason_text`. | Schemas listed | Add a visibility class, staff guidance ("no diagnosis, allegation or third-party detail") and length limits. Cover these columns in the DPIA. |
| EB-3 | Minor | **The full inbound application is kept.** `application_received_payload.payload` holds the whole application, which may include the personal statement, references and the disability or criminal-conviction declarations asked for some regulated courses, under the same retention as the student record. | `admissions-application.ts` | Keep the payload hash permanently, and the payload only until the cycle closes plus the complaint window. |
| EB-4 | Minor | **SRS outcome rows lack the ADR-017 envelope.** `exceptional_circumstances` and `disability_declaration` carry no source-case reference (to the wellbeing claim or case) and no visibility or supersession metadata. | `circumstances.ts`, `identity.ts` | Add the source case reference and visibility class. |
| EB-5 | Observation | **The code largely conforms.** It follows the boundary in: `case_evidence_reference` (opaque reference plus content hash); `condition_evidence`; the CAS `evidence_ref`; the `ukvi_engagement_evidence_snapshot` summary and hash; `engagement_outcome`; `thesis_submission.storage_ref`; `examiner_report.report_ref`; the adjustment event payloads; and the board-pack projections. | As listed | None. |

## Proposed answers per process

Every answer applies the same default: **detail stays in the specialist system; the SRS stores the coded outcome, its effective dates, the decider, the source case or evidence reference (opaque, access-checked on dereference) and provenance.** The table says what each process puts on each side of that line.

| BP | Stays in the specialist system | Minimum outcome in the SRS (and code today) | Confidence | Proposal |
|---|---|---|---|---|
| [BP-01-001](../01-recruitment-and-admissions/bp-01-001-receive-an-application.md) | UCAS or the direct-application portal holds the full application: personal statement, references, supporting documents and any criminal-conviction or fitness declarations. | The canonical application, choices and the received-payload hash. Today the full payload is kept (EB-3). | Medium | **Open:** the DPO and the admissions lead choose the payload retention |
| [BP-01-002](../01-recruitment-and-admissions/bp-01-002-assess-an-application.md) | The admissions system holds interview notes, portfolios, test scripts and DBS/fitness-to-practise evidence. | The assessment outcome, assessor, `evidence_ref` and version (`application_assessment`). `note` must be classified (EB-2). | High | Close |
| [BP-01-003](../01-recruitment-and-admissions/bp-01-003-make-and-manage-an-offer.md) | The CRM holds contextual-admissions source data (for example care-experience evidence). | The offer, its conditions and the contextual flag with its basis code. The SRS is authoritative. | High | Close |
| [BP-01-004](../01-recruitment-and-admissions/bp-01-004-confirm-offer-conditions.md) | Awarding bodies, UCAS and the document store hold certificates and transcripts. | `condition_evidence` reference, the matcher suggestion and the decision. Already conforms. | High | Close |
| [BP-01-005](../01-recruitment-and-admissions/bp-01-005-create-and-assign-a-cas.md) | The authorised immigration evidence store holds passport, financial, ATAS and English-language evidence (ADR-022). | The CAS case, each eligibility result with its guidance version and `evidence_ref`, the assigned-payload hash and the SMS receipt. Already conforms. | High | Close |
| [BP-01-006](../01-recruitment-and-admissions/bp-01-006-place-an-applicant-through-clearing.md) | The Clearing call system or CRM holds call notes and recordings. | The offer and decision only. | Medium | Close |
| [BP-01-007](../01-recruitment-and-admissions/bp-01-007-convert-an-accepted-applicant-to-a-prospective-student-record.md) | The identity-verification provider holds document images. | The verification status, fraud flag and provider reference (`identity_verification_check`), and the right-to-study outcome. Already conforms. | High | Close |
| [BP-04-001](../04-learning-engagement-and-support/bp-04-001-record-attendance-and-academic-engagement-evidence.md) | The attendance module and its sources (swipe, register, VLE logs) hold the raw events. | `engagement_outcome` with its evidence window and hash, plus the UKVI snapshot when referred. Already conforms. | High | Close |
| [BP-04-002](../04-learning-engagement-and-support/bp-04-002-investigate-and-respond-to-non-engagement.md) | Attendance and wellbeing hold welfare conversations and referral content. | The outcome code, severity and referral flag. Sponsor reporting stays a separate decision. | High | Close |
| [BP-04-003](../04-learning-engagement-and-support/bp-04-003-review-pgr-progress-and-milestones.md) | The research or document system holds panel reports, supervisor reports and the student's submission. | The review type, outcome, panel membership and milestone dates (`pgr_progress_review`, `research_milestone`). | Medium | Close |
| [BP-04-005](../04-learning-engagement-and-support/bp-04-005-manage-exceptional-circumstances.md) | The EC case system (the wellbeing module, ADR-028) holds the claim narrative, medical or third-party evidence and the evidence reviews. | The outcome code, the scope (module or assessment), the effective date and the source case reference. **The code breaches this today (EB-1).** | High (answer) | **Open:** until EB-1 is fixed. The DPO confirms, and the EC process owner decides whether core keeps any student-visible summary. |
| [BP-04-006](../04-learning-engagement-and-support/bp-04-006-distribute-an-approved-support-outcome.md) | Wellbeing holds the case and evidence. | Each target receives the type, scope, amount and validity only (`distribution-dispatcher.ts`). Already conforms. | High | Close |
| [BP-05-001](../05-assessment-and-results/bp-05-001-establish-assessment-structures.md) | None; this is curriculum configuration, not personal data. | Not applicable. | High | Close (not applicable) |
| [BP-05-002](../05-assessment-and-results/bp-05-002-create-examination-entries-and-accommodations.md) | Wellbeing holds the disability category and evidence. | The exam system receives the accommodation type and amount only, never a diagnosis or category. | High | Close |
| [BP-05-003](../05-assessment-and-results/bp-05-003-receive-or-enter-marks.md) | The VLE or e-assessment system holds scripts, submissions and feedback. | Marks and attempt facts. `assessment_submission.raw_payload` must hold metadata only, not content. | Medium | **Open:** the assessment lead confirms what the raw payload may hold |
| [BP-05-004](../05-assessment-and-results/bp-05-004-moderate-and-confirm-marks.md) | QA records and the VLE hold moderator commentary and samples. | Sample selection, reason codes, mark changes and the confirming actor. | Medium | Close |
| [BP-05-005](../05-assessment-and-results/bp-05-005-determine-a-module-result.md) | EC and misconduct case systems hold their evidence. | The result plus EC and misconduct outcome codes. | High | Close |
| [BP-05-006](../05-assessment-and-results/bp-05-006-investigate-academic-misconduct.md) | The misconduct case system holds allegations, similarity reports, interview notes and panel minutes. | The case reference, status, penalty code and structured effect. `penalty_detail` must not narrate the allegation (EB-2). | High | Close |
| [BP-05-007](../05-assessment-and-results/bp-05-007-prepare-an-exam-board-and-data-pack.md) | Specialist cases hold the reasons. | The pack holds outcomes and indicator codes only (`board-service.ts` drops EC notes). Already conforms. | High | Close |
| [BP-05-008](../05-assessment-and-results/bp-05-008-complete-external-examiner-review.md) | The QA or document system holds external examiner reports. | The sign-off, scope and date. `commentary` should be limited to decision-relevant text (EB-2). | Medium | **Open:** the quality lead decides whether commentary belongs in the SRS at all |
| [BP-05-009](../05-assessment-and-results/bp-05-009-ratify-and-publish-results.md) | None. | The ratification record and published results. The SRS is authoritative. | High | Close |
| [BP-05-010](../05-assessment-and-results/bp-05-010-submit-and-examine-a-pgr-thesis.md) | The repository holds the thesis (`storage_ref`). The examiner workspace holds the reports (`report_ref`). | The submission facts, examiner appointments, outcome and correction requirements. Already conforms. | High | Close |
| [BP-05-011](../05-assessment-and-results/bp-05-011-correct-a-ratified-academic-outcome.md) | The appeal or complaint case system holds appeal and complaint evidence. | The case, its error category, `evidence_ref` and the before/after amendment. Already conforms. | High | Close |
| [BP-06-001](../06-progression-awards-and-graduation/bp-06-001-determine-progression.md) | EC and misconduct systems hold the reasons. | The progression decision and its rule version. | High | Close |
| [BP-06-002](../06-progression-awards-and-graduation/bp-06-002-manage-reassessment-referral-or-repeat-study.md) | The EC case holds medical or EC reasons. | The reassessment plan and outcome. `outcome_note` is classified (EB-2). | High | Close |
| [BP-06-003](../06-progression-awards-and-graduation/bp-06-003-determine-and-confer-an-award.md) | EC cases hold the circumstances behind any discretion. | The recommendation and conferment. `discretion_reason` holds the academic rationale only. | High | Close |
| [BP-06-004](../06-progression-awards-and-graduation/bp-06-004-issue-award-documentation-and-hear.md) | None. Special-category data and misconduct history are excluded from the HEAR unless institutional policy says otherwise. | The document content snapshot, hash, verification events and consent reference. | High | Close |
| [BP-06-005](../06-progression-awards-and-graduation/bp-06-005-determine-graduation-eligibility-and-attendance.md) | The events system holds ceremony access needs and guest details. | Eligibility, invitation and allocation. | Medium | Close |
| [BP-06-006](../06-progression-awards-and-graduation/bp-06-006-record-successful-pgr-completion.md) | The repository holds the final thesis. | The deposit confirmation and completion outcome. | High | Close |
| [BP-07-001](../07-regulatory-and-statutory-reporting/bp-07-001-prepare-and-submit-hesa-student-data.md) | None external. HESA's sensitive fields (ethnicity, disability, religion, sexual orientation, gender identity) are statutory SRS fields, collected with a refusal option. Disability is the HESA category only, never DSA or clinical evidence. | The submitted payload, hash and receipt. Retention is to be defined (R07-13 in the [BP-07 record](pre-review-bp-07-001-008.md)). | Medium | **Open:** the DPO sets the Art. 9 condition and the retention of returned payloads |
| [BP-07-002](../07-regulatory-and-statutory-reporting/bp-07-002-exchange-registration-attendance-and-changes-with-student-finance-bodies.md) | Status cases hold the reasons for suspension or withdrawal (for example medical). SLC or SAAS hold entitlement. | The scheme reference, the confirmation or change with its effective date, and the response. Only SLC codes are sent, never reasons. | High | Close |
| [BP-07-003](../07-regulatory-and-statutory-reporting/bp-07-003-manage-student-sponsor-reporting-and-compliance.md) | The immigration evidence store holds documents. Wellbeing holds welfare detail. | The report version, evidence snapshot hash, decision and authorisation (ADR-022). Already conforms. | High | Close |
| [BP-07-004](../07-regulatory-and-statutory-reporting/bp-07-004-produce-ofs-regulatory-extracts.md) | None. | Aggregates with disclosure control (rounding and suppression) applied before release. | High | Close |
| [BP-07-005](../07-regulatory-and-statutory-reporting/bp-07-005-produce-scottish-funding-council-returns.md) | None. | Same as BP-07-001, per SFC specification. | Medium | Close |
| [BP-07-006](../07-regulatory-and-statutory-reporting/bp-07-006-produce-medr-regulatory-and-funding-returns.md) | None. | Same as BP-07-001, per Medr specification. | Medium | Close |
| [BP-07-007](../07-regulatory-and-statutory-reporting/bp-07-007-produce-department-for-the-economy-returns.md) | None. | Same as BP-07-001, per DfE specification. | Medium | Close |
| [BP-07-008](../07-regulatory-and-statutory-reporting/bp-07-008-resolve-a-statutory-submission-data-quality-issue.md) | None. | The issue, its classification, the before/after values and the acceptance. | High | Close |
| [BP-08-001](../08-record-governance-and-lifecycle/bp-08-001-resolve-a-duplicate-or-uncertain-identity.md) | The identity-verification provider or evidence store holds identity documents. A restricted case holds any identity-theft or safeguarding detail. | The match basis, candidates, decision, links and redirects. | High | Close |
| [BP-08-002](../08-record-governance-and-lifecycle/bp-08-002-correct-personal-or-enrolment-data.md) | The document store holds certificates and deed polls. A gender-recognition certificate is sighted and **not retained** (GRA 2004 s.22). | The new bitemporal version, its reason and the evidence reference. | High | Close |
| [BP-08-003](../08-record-governance-and-lifecycle/bp-08-003-fulfil-a-data-subject-access-request.md) | The DP casework store holds the disclosure bundle, redactions and correspondence. | The request case, search manifest, decision and dates, never a copy of the disclosed data. | Medium | **Open:** the DPO names the casework store |
| [BP-08-004](../08-record-governance-and-lifecycle/bp-08-004-assess-restriction-rectification-or-erasure-rights.md) | The DP case holds the detailed reasoning and correspondence. | The decision with reasons and exemption codes, the restriction marker and the propagation certificate. | High | Close |
| [BP-08-005](../08-record-governance-and-lifecycle/bp-08-005-retain-archive-and-dispose-of-student-records.md) | The archive holds transferred records. | The disposal or transfer certificate (class, count, targets, approver), never the content. | High | Close |
| [BP-08-006](../08-record-governance-and-lifecycle/bp-08-006-audit-access-and-material-record-changes.md) | HR, discipline and incident systems hold investigation evidence. | The audit store is append-only. Review findings reference audit rows. | High | Close |

## Open questions

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| OQ-3 on the 37 pages marked Close above | Evidence and minimum outcome | As in the row for that page | High or medium, as stated | DPO, to accept the default for all 37 at once |
| BP-01-001 OQ-3 | As above | Hash permanently; full payload until the cycle closes plus the complaint window | Medium | DPO and admissions lead |
| BP-04-005 OQ-3 | As above | Narrative and evidence in the EC case system only; core holds the outcome and reference | High | DPO and EC process owner, after EB-1 is fixed |
| BP-05-003 OQ-3 | As above | Submission metadata only in the SRS | Medium | Assessment lead |
| BP-05-008 OQ-3 | As above | Sign-off only; reports stay in the QA system | Medium | Academic quality lead |
| BP-07-001 OQ-3 | As above | Statutory sensitive fields stay in the SRS under a named Art. 9 condition | Medium | DPO |
| BP-08-003 OQ-3 | As above | The bundle lives in the DP casework store | Medium | DPO |

## Still needs a named person

- **DPO:** accept the default for the 37 pages to close; decide the six that stay open; run a DPIA covering the free-text columns in EB-2.
- **EC process owner:** decide whether core shows students any summary of their own claim (EB-1).
- **Records manager:** set the retention of application payloads and statutory return payloads.

## Not checked

- **Specialist databases:** the internal contents of the wellbeing and attendance module databases, and the documents store.
- **Free-text use in practice:** what staff actually write in the free-text columns. Only a demo-data or production sample would show that.
- **The UCAS application payload:** its field list, which is not in the repository.
