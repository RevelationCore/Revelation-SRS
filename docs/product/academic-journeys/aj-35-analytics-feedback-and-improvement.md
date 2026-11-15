# AJ-35 — Learning from the whole student experience

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Analytics fixture](flexible-learning-and-service-fixture.md) · [Programme review](aj-03-programme-review-and-improvement.md)

**Perspective:** a student representative, the institutional analyst, source-data stewards and Aisha as programme director. **Boundary:** authorised survey/source assembly through reconciled interpretation and owned improvement actions. **Timeline:** t+28 to t+44, with a separate follow-up at t+160; t = 23 September 2030.

## The story

### Ask the right population, for a stated purpose — t+28

The module evaluation owner prepares the SCI440 survey. The snapshot contains 40 eligible registered learners under `ANALYTICS-2030@1`; this number comes from supplied registration evidence, not the planned intake capacity. Withdrawn, interrupted, cancelled and duplicated registrations are checked against the applicable eligibility date. Omar's effective interruption is considered explicitly rather than treating an old VLE membership as proof of current participation.

The invitation service receives only the identifiers and contact context necessary to invite the eligible cohort. Response content and invitation tracking remain separated according to the survey design. Students are told the purpose, who receives the findings and any limits on anonymity. A tutor cannot obtain an individual's response merely because they taught the module. Reminders respect the survey design without exposing non-responders to teaching staff.

### Build a dated view before interpreting it — t+28 to t+32

The analyst assembles authorised enrolment and module facts, learning activity summaries and attendance evidence, retaining purpose, source versions, extraction times and each dataset's cut-off. A complete warehouse load establishes a baseline; subsequent increments carry an ordered watermark and reconcile inserts, corrections and removals. A successful transfer with a missing partition does not establish a complete dataset.

VLE-to-BI, attendance-to-BI and warehouse-to-BI are ecosystem contracts. The native attendance module still owns attendance evidence and human casework; these feeds do not justify a second raw-attendance intake into core SRS. Detailed wellbeing evidence and unrestricted support-case notes are excluded. An approved operational adjustment is used only where necessary to interpret the permitted activity accurately.

At this point first-stage ratification has not occurred. Provisional assessment indicators, if permitted at all, are labelled as such and cannot be presented as published progression or graduate outcomes. The first-year outcome extract is refreshed only after the established publication at t+40.

### Resolve a discrepancy at its owner — t+32 to t+40

The warehouse reconciliation initially treats Omar as active because its transformation derives participation from module registrations, which still show `registered` with a future end date, and does not apply the enrolment-level interruption effective from t+18. The analyst compares the extract with Registry's authoritative decision and opens a data-quality issue. The warehouse owner repairs that transformation, rebuilds the affected period and records the before/after counts and lineage. Registry's already correct status is not edited to make the dashboard agree.

This is a warehouse issue, distinct from [AJ-34's later reporting transformation](aj-34-reporting-and-statutory-returns.md). Fixing one pipeline does not prove the other has changed. A source error would instead be referred to the relevant correction authority, with downstream refresh only after an authorised amendment. Old analytical snapshots remain reproducible and visibly superseded.

### Signals invite investigation, not a decision about a student — t+40

The updated first-year view combines only comparable periods and explicitly defined denominators. A separate risk-signal variant tests a missing-activity flag against a supplied active-student snapshot. Before referral, the analyst checks coverage, schedule, adjustments, outages and whether the student is even in scope. An inactive Omar must not enter a current-engagement intervention solely because old systems still contain his name.

An admissible signal contains its input versions, observation window, explanation and limitations. It opens [AJ-23's owned human review](aj-23-engagement-and-intervention.md), not an automatic withdrawal, sponsor report or restriction. The reviewer can reject a false signal after verifying an outage or legitimate study pattern. Any predictive-model variant also requires its model/version, evaluation, threshold and fairness review; this main scenario uses no invented validated prediction model.

### Students help interpret the aggregate — t+40 to t+44

The survey closes with 24 responses; 14 are coded as asking for more worked examples about uncertainty. The response rate is 24/40 = 60%. The theme occurs in 14/24 = 58.3% of responses, not 58.3% of all learners. The coding method and review are retained; illustrative summaries contain no copied personal comment or fabricated quotation.

Before sharing the pack, the analyst suppresses subgroup cells below five and any complementary cells or overlapping views that would reveal them by subtraction. Free text is checked separately. Suppression is not a reason to deny an authorised support team access to its own individual case; the public/representative analytical view and restricted operational purpose are different.

Student representatives explain why worked examples matter alongside the assessment sample and external-examiner evidence. The pack describes an issue to investigate rather than claiming Statistics caused a particular outcome. This is the feedback input to AJ-03's existing t+40–44 review, not a second competing review with different results.

### Close the loop when evidence exists — t+44 and t+160

Aisha records the owned action to review the Statistics design, which AJ-02/AJ-03 carry through rework and future approval. Operational issues such as a confusing message go directly to their service owner. The students receive an accessible account of what was heard, what will change and which proposals still need approval, through [AJ-37](aj-37-publication-and-communications.md).

At t+160 the analyst revisits the action log. The version-2 course only began delivery at t+156, with teaching at +157. Initial delivery checks may be available; improved completion or graduate outcomes cannot yet be attributed to it. The owner schedules a later effectiveness review using actual delivery and comparable cohorts. A closed action is evidence of implementation only when its required artefact exists, and implementation alone is not proof of educational benefit.

## Starting pack and authority

Supply `ANALYTICS-2030@1`, exact eligible rosters, permitted dataset manifests/watermarks, calculation and coding definitions, disclosure rules, Omar's effective decision and the authorised t+40 result snapshot. Survey owners own collection, source stewards own facts, warehouse owners own transformations, analytics/privacy owners approve processing, and programme authorities decide improvement. Representatives receive an approved aggregate, not identifiable support or response records.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A35-01 | t+28 | Verify survey population, purpose and invitation scope. | 40 eligible learners; separated invitation/response handling. |
| A35-02 | t+28 to t+32 | Assemble full/incremental sources and completeness controls. | Versioned analytical baseline; missing partitions remain visible. |
| A35-03 | t+32 to t+40 | Resolve Omar's warehouse mapping discrepancy and refresh published results. | Corrected transformation and dated source lineage. |
| A35-04 | t+40 | Check signal quality and human-referral boundary. | Explainable owned review or rejected false signal; no automatic status action. |
| A35-05 | t+40 to t+44 | Apply disclosure controls and interpret feedback with students. | AJ-03 pack with accurate denominators and limitations. |
| A35-06 | t+44; t+160 | Track improvement and review only evidence available at the date. | Owned actions, student feedback and later effectiveness plan. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A35-I01 / F-SIS-SETS-01, F-SETS-SIS-01 | SRS ↔ survey service: eligible roster, completion summary and approved aggregate feedback. | Survey + roster/summarisation versions; survey owner. | Reconciled population/denominator; no individual response return to tutors. |
| A35-I02 / F-SIS-DW-01, F-DW-SIS-01 | SRS ↔ warehouse: full/incremental dated facts and source-linked discrepancy. | Extract + watermark + transformation; respective owners. | Completeness checks, reproducible rebuild and owned correction. |
| A35-I03 / F-SIS-BI-01, F-VLE-BI-01, F-AM-BI-01, F-DW-BI-01 | Permitted source owners → BI: scoped analytical datasets and provenance. | Source snapshot + purpose + consumer. | Comparable definitions, permitted joins and disclosure controls; ecosystem feeds remain outside core ownership. |
| A35-I04 / F-BI-SIS-01; A23-I02 boundary | BI → authorised intervention owner: explainable candidate signal and evidence references. | Signal + observation/model or rule version. | Human disposition linked back; analytics cannot decide withdrawal or sponsor action. |
| A35-I05 / GI-21; A03-01 | Analyst/student review → programme quality owner: suppressed pack, interpretation and recommendations. | Review pack + cut-off/version. | Accepted review input and owned actions; proposal is not approved curriculum. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A35-AC01 | Invitation roster includes an ineligible or duplicated registration. | Reconcile against the declared cut-off; prevent duplicate/inappropriate invitations. |
| A35-AC02 | Incremental load skips a partition or repeats a watermark. | Incompleteness flagged or repeat deduplicated; no false complete-snapshot claim. |
| A35-AC03 | Warehouse shows interrupted Omar as active. | Fix owning transformation against effective source state; no Registry fact patch. |
| A35-AC04 | Report 14 thematic responses among 24 replies from 40 eligible learners. | 60% response rate and 58.3% of respondents; denominators explicit. |
| A35-AC05 | A subgroup has four members or can be inferred from totals. | Suppress it and necessary complementary views; review identifying free text. |
| A35-AC06 | Flag derives from an outage, adjustment or inactive record. | Check context and reject/reroute false signal; no automatic academic consequence. |
| A35-AC07 | Director requests first-year outcomes before publication or later cohort data at an earlier cut-off. | Exclude or explicitly label permitted provisional facts; no future knowledge. |
| A35-AC08 | At t+160, attribute graduate improvement to version 2. | Reject unsupported attribution; schedule an evidence-based later review. |

## Traceability, implementation and review

ANA-001–006 in [core requirements](../../requirements/functional-requirements.md); engagement, reporting-quality and audit processes in the [process inventory](../../business-processes/process-inventory.md); ESP and XIC requirements in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). The catalogue assigns all four analytics/survey exchange pairs and the three BI ecosystem feeds here; those assignments do not establish live adapters.

The [capability matrix](../current-capabilities.md) remains the implementation baseline. Review owners, unassigned: students, module evaluation, institutional analytics, data stewards, attendance/support, programme quality, security and privacy. Closing evidence is a reproducible, appropriately disclosed analytical pack, attributed interpretation and owned follow-up, not a dashboard alone.
