# Expanded academic journeys

Status: **Proposed narrative specifications v0.6**, 13 November 2026. See [status of these documents](#status-of-these-documents).

[Narrative catalogue](../academic-journey-narrative-catalogue.md) · [Product documentation](../README.md)

| Narrative | Readable story and structured walkthrough |
|---|---|
| AJ-01 | [Aisha: from a course idea to an approved catalogue and prospectus](aj-01-course-creation-and-publication.md) |
| AJ-02 | [Shared-module change](aj-02-shared-module-change.md) |
| AJ-03 | [Programme review and improvement](aj-03-programme-review-and-improvement.md) |
| AJ-06 | [Sam: from university discovery to arrival and first teaching](aj-06-discovery-application-and-arrival.md) |
| AJ-07 | [Clearing, deferral and changed plans](aj-07-clearing-deferral-and-changed-plans.md) |
| AJ-08 | [Part-time entry and prior learning](aj-08-part-time-entry-and-prior-learning.md) |
| AJ-16 | [Registration and entitlements](aj-16-registration-and-entitlements.md) |
| AJ-17 | [Campus, accommodation and library](aj-17-campus-accommodation-and-library.md) |
| AJ-18 | [Module selection and course diets](aj-18-module-selection-and-diets.md) |
| AJ-19 | [Timetabling and Estates](aj-19-timetabling-and-estates.md) |
| AJ-20 | [Teaching and personal tutoring](aj-20-teaching-and-tutoring.md) |
| AJ-21 | [Reasonable adjustments and their delivery](aj-21-reasonable-adjustments.md) |
| AJ-22 | [Exceptional circumstances](aj-22-exceptional-circumstances.md) |
| AJ-23 | [Engagement and intervention](aj-23-engagement-and-intervention.md) |
| AJ-24 | [Assessment, examination operations and results](aj-24-assessment-and-results.md) |
| AJ-25 | [Exam boards, ratification and publication](aj-25-exam-board-and-ratification.md) |
| AJ-26 | [Progression, reassessment and repeat routes](aj-26-progression-and-reassessment.md) |
| AJ-27 | [Appeals and record corrections](aj-27-appeals-and-record-corrections.md) |
| AJ-28 | [Study change and return](aj-28-study-change-and-return.md) |
| AJ-29 | [Awards, graduation and alumni transition](aj-29-awards-graduation-and-alumni.md) |
| AJ-34 | [Reporting and statutory returns](aj-34-reporting-and-statutory-returns.md) |
| AJ-38 | [Records, information rights and retention](aj-38-records-rights-and-retention.md) |

Twenty-two narratives are now expanded. The documents share the fictional scenario below and the [taught-student continuation](taught-student-fixture.md), which fixes the later policies, marks, roles and calendar. Each later story states its own independent starting pack and consumes preceding evidence in a connected run. The [change and exceptions extension](change-and-exceptions-fixture.md) adds the new students, policy branches, shared-module revision, future course release and Jo’s separately anchored part-time plan. Eighteen catalogue narratives remain to expand.

The first two documents establish the course and admissions hand-off. They are independently readable: AJ-01 begins before approval; AJ-06 begins with an approved, published release supplied as its starting fixture. In a connected walkthrough, AJ-01 must actually produce the evidence that AJ-06 assumes.

### Status of these documents

This statement applies to every expanded journey, so individual stories do not repeat it. All documents in the set share one version number.

- The journeys are **proposed specifications for discussion**. They are not delivered functionality, executed tests or an accepted institutional workflow.
- Acceptance cases describe expected results. None has been run against Revelation or an external system.
- A fixture is not a database seed or a working integration. A label such as a receipt, digest or external identifier does not mean one exists.
- Names, identifiers, dates and policies are synthetic. Dates show sequence, not actual UCAS deadlines or sector rules. The degree structure, offer conditions and approval gates are Northbridge's choices, not national requirements. No real applicant or personal evidence is used.
- Review slots name accountable roles. Real reviewers are **not yet assigned**, and no institution-specific policy is treated as approved.

## Shared scenario: Northbridge, entry cohort 2030

| Fact | Agreed value for the connected narratives |
|---|---|
| Institution / tenant | Northbridge University; `NBU-DEMO`. All exchanges stay in the isolated scenario environment. |
| Academic proposer | Dr Aisha Patel, School of Environment; may author and respond to reviews, but not approve her own proposal. |
| Programme identity | `NBU-EDS`: BSc (Honours) Environmental Data Science, main-campus, full-time, three stages; each normally one academic year. |
| Approved programme / route / diet | `NBU-EDS@1.0`; route `EDS-FT@1.0`; diet `EDS-2030@1.0`; target award `EDS-BSCHONS@1.0`. Applicable to entry cohort 2030. |
| Curriculum proposal | `CP-EDS-001`: revision `r1` is returned; `r2` contains the academic correction and is approved subject to blocking condition `C-01`. Condition evidence is appended separately; it does not secretly edit `r2`. |
| Release and provider | `REL-EDS-2030-01`; authority `internal-cm/epoch-1`. The external-provider variant must produce equivalent evidence through the canonical acceptance boundary. |
| Public content | `PROS-EDS-2030@1.0`, derived from the accepted release; no reviewer comments, cost model or personal evidence included. |
| Applicable policies | Fictional `APPROVAL-NEW-COURSE@1`, `ADMISSIONS-2030@1`, `FEES-2030@1`, `REGISTRATION-2030@1`; policy contents needed for a scene must be supplied in its starting pack. No real fee amount or national eligibility is inferred. |
| Approval panel | Under `APPROVAL-NEW-COURSE@1`: an internal chair, two internal academics from outside the School, an **external academic adviser** from another university, an **employer adviser** and a **student panel member**. The external academic's written scrutiny is required before the panel can approve. |
| Advertising and offers before approval | Two separate settings, both **off on the main path**: Northbridge advertises and makes offers only after approval. Advertising "subject to approval" is set in `APPROVAL-NEW-COURSE@1` (variant A01-AC14). Offers before approval are set in `ADMISSIONS-2030@1`, are possible only if advertising is permitted, and need joint authority from the admissions policy owner and the course's quality lead. Each such offer states the approval status and expected date, and no place is confirmed before approval (variants A01-AC16, A06-AC17). |
| Applicant | Sam Taylor, preferred name Sam; date of birth 14 March 2012, so **18 at the start of the course**. CRM enquiry `ENQ-SAM-001`, application `APP-SAM-2030-01`, offer `OFF-SAM-001@1`. An opaque UCAS test alias `UCAS-DEMO-SAM` is a fixture label, not a valid UCAS-format identifier. Sam is 17 while applying, which matters for visit and contact arrangements. An applicant under 18 at the start of the course is a variant (A06-AC18). |
| Fee status | Assessed by Admissions under `FEES-2030@1` before the offer: **home**, on the fictional evidence in Sam's application. The offer states the fee status. A query or dispute is a variant (A06-AC19). Fee status is not a selection criterion. |
| Person and enrolment | On governed conversion, `PERSON-SAM-001` and prospective-student record `STU-SAM-001`; on approved registration, `ENR-SAM-2030-01` bound to the approved route/diet. These are labels, not promised production ID formats. |
| Main-path offer | Three A levels at grade B or better, including Mathematics at B or better; no additional academic condition in this fixture. Admission assessment and later registration checks remain separate. |
| Main-path results | Mathematics A, Geography B, Computer Science B, independently verified from the permitted results source. Predicted grades or a self-reported screenshot do not discharge the conditions. |
| Capacity and options | Planned intake 40, subject to separate operational allocation. The approved diet permits options; it does not guarantee an individual seat or a clash-free timetable. |
| Applicant's visit need | Sam requests a step-free tour route. This is restricted event logistics, not a diagnosis, an admissions criterion or automatic approval of long-term study adjustments. |

## Course definition used in the stories

This is a compact illustrative specification sufficient to make the rework and hand-offs concrete, not a complete publishable academic handbook. Full module specifications, assessment rules, classification/exit-award policies and translations remain expansion artefacts to be agreed before executable acceptance.

The target is 360 institutional credits: 120 at each of levels 4, 5 and 6 under the scenario's selected framework. All listed module versions are `@1.0`; each has a stable identity distinct from its dated offering. `SCI420@1.0` and `SCI440@1.0` are existing approved shared modules in the starting pack; their academic content is reused unchanged, with capacity reviewed for this new programme. The remaining modules are newly approved with the release. Planned offerings follow each stage for this cohort; AJ-01/AJ-06 open the entry-year delivery; AJ-18/AJ-26 subsequently confirm later-period offerings and registrations under the continuation calendar.

| Stage | Compulsory modules | Optional group | Total selected |
|---|---|---|---|
| 1 / level 4 | `EDS410` Environmental Systems; `SCI420` Data and Programming; `EDS430` Mathematics for Environmental Science; `SCI440` Statistics; `EDS450` Evidence and Scientific Writing; `EDS460` Field and Laboratory Methods. Each 20 credits. | None. | 120 |
| 2 / level 5 | `EDS510` Environmental Modelling; `EDS520` Spatial Data; `EDS530` Research Design. Each 20 credits. | Choose exactly three of `EDS540` Community Field Study, `EDS550` Remote Sensing, `EDS560` Environmental Economics, `EDS570` Ecological Data. Each 20 credits. | 60 + 60 = 120 |
| 3 / level 6 | `EDS610` Independent Project (40 credits); `EDS620` Environmental Decisions (20); `EDS630` Communicating Evidence (20). | Choose exactly two of `EDS640` Advanced Spatial Analysis, `EDS650` Climate Data, `EDS660` Applied Ecology. Each 20 credits. | 80 + 40 = 120 |

For this fixture, `EDS510` requires a pass in `SCI420` and `SCI440`; `EDS520` requires `SCI420`; `EDS610` requires `EDS530`; `EDS640` requires `EDS520`; `EDS650` requires `EDS510`; `EDS660` requires `EDS570`. Other prerequisites are absent in this compact fixture. The project must be passed; reaching the total credit count alone does not meet the target award. No stage progression, condonement, compensation or exit award is invented from these totals.

A witness pathway takes `EDS540`, `EDS550`, `EDS570` at stage 2 and `EDS640`, `EDS660` at stage 3, assuming the required preceding passes. The combination `EDS540` + `EDS550` + `EDS560`, followed by `EDS660`, is invalid because `EDS570` was omitted. These are design checks, not actual student module allocations or marks.

| Programme outcome | Meaning | Assessed coverage in approved revision r2 |
|---|---|---|
| `PLO-EDS-01@1` | Explain environmental processes and limitations of evidence. | Compulsory `EDS410` case analysis and `EDS510` modelling report. |
| `PLO-EDS-02@1` | Analyse environmental data using reproducible methods. | Compulsory `SCI420` practical portfolio and `EDS610` project analysis. |
| `PLO-EDS-03@1` | Evaluate ethical, social and data-governance implications of an investigation. | Compulsory `EDS610` project ethics appraisal, a **must-pass component**; optional `EDS540` provides additional practice/assessment. |
| `PLO-EDS-04@1` | Communicate evidence and uncertainty to specialist and public audiences. | Compulsory `EDS450` written assessment and `EDS630` public briefing. |

In `r1`, the only claimed assessed coverage of `PLO-EDS-03@1` is in optional `EDS540`. The panel finds a valid route omitting that module. In `r2`, Aisha adds an explicit module outcome and assessed ethics-appraisal criterion in compulsory `EDS610`. A project proposal/ethics component contributes 20% and the final project report contributes 80%; each component has its own mapped criteria, and their weights total 100%.

Being assessed on every route is not the same as every graduate demonstrating the outcome. With a 20% weighting, a student could fail the ethics component and still pass `EDS610` on the strength of the report. The panel therefore decides explicitly how `PLO-EDS-03@1` is assured. In this fixture, the panel requires the ethics component to be **passed in its own right** at the component pass mark: it cannot be compensated by the report mark. The [continuation fixture](taught-student-fixture.md#explicit-scenario-policies) now supplies the synthetic threshold of 40, the permitted reassessment/cap rule and numerical negative cases in AJ-24/AJ-26. A failed component leads to reassessment of that component under the assessment regulations (AJ-26). This is recorded in r2's assessment design and in the panel decision. The alternative, accepting assessment on every route without a must-pass rule, is variant A01-AC15.

There are four stage-2 option sets and three stage-3 option sets. Two of the twelve cross-stage combinations omit `EDS570` but select `EDS660`; the ten remaining combinations are academically reachable under the stated prerequisites and assumed preceding passes. Every reachable combination now includes the compulsory, must-pass project ethics appraisal. Operational capacity and timetabling need separate evidence.

## Shared chronology and hand-off contract

### Timeline convention

**t is the start of the academic year for the entry cohort.** In this shared scenario **t is Monday 23 September 2030**, the start of Northbridge's academic year 2030/31. All connected narratives use this same anchor, including Aisha's work in earlier years. This is the only full statement of the convention; the catalogue and the stories link here.

The exact date matters. With an early-September anchor, the results week (t-6) would fall in July, before A-level results are published. With t on 23 September, t-6 is the week of 12 August 2030 and contains the fictional results day.

- **t-1** means one week before the start; **t-52** means 52 weeks before it.
- **t+1** means one week after the start; **t+2** means two weeks after it.
- Offsets count elapsed calendar weeks, including holidays, not teaching weeks. One week is seven calendar days; for a dated event, `event date = 23 September 2030 + (offset × 7 days)`. Every week therefore begins on a Monday.
- A range such as **t-3 to t-2** is a planned activity window. Milestones identify their planned week; detailed event timestamps and within-week ordering are retained separately when a walkthrough is executed.
- The anchor does not reset at approval, application, registration or the next September. A different cohort needs an explicitly labelled anchor; t+52 is not automatically the institution's next academic-year start date.

The following is an illustrative schedule for the fictional main path, not prescribed UCAS dates or service deadlines. Approval and evidence gates still apply if an activity takes longer: passing its planned week never counts as approval. At t, this fixture schedules arrival/induction; first teaching is at t+1, so those events are not conflated with the academic-year start.

### Combined weekly timeline

| Time relative to t | Week commencing | Narrative / scene | Milestone or activity | Dependency / outcome |
|---|---|---|---|---|
| t-100 | 23 Oct 2028 | AJ-01 / A01-01 | Aisha opens the proposal and receives permission to develop it. | Development permission is not approval or permission to recruit. |
| t-98 to t-82 | 6 Nov 2028 | AJ-01 / A01-02 | Develop course/modules, outcomes and diets; review resources. | Complete submission pack with attributable feasibility evidence. |
| t-80 | 12 Mar 2029 | AJ-01 / A01-03 | Panel, with the external academic's written scrutiny, reviews r1 and returns the outcome-mapping gap for rework. | Publication remains blocked; Aisha owns the response. |
| t-79 to t-76 | 19 Mar 2029 | AJ-01 / A01-04 | Rework and resubmit r2 with a must-pass ethics component; renew affected reviews. | Compulsory, must-pass assessment coverage checked across reachable pathways. |
| t-74 | 23 Apr 2029 | AJ-01 / A01-05 | Committee grants conditional approval. | Blocking condition C-01 has an owner, evidence requirement and verification route. |
| t-68 | 4 Jun 2029 | AJ-01 / A01-06 | Independently verify resource readiness and discharge C-01. | Final approval references unchanged r2 and verified condition evidence. |
| t-67 | 11 Jun 2029 | AJ-01 / A01-07 | Authorise release and obtain SRS acceptance. | Exact versions accepted for cohort 2030; no student enrolled. |
| t-66 to t-65 | 18 Jun 2029 | AJ-01 / A01-08 | Prospectus publication fails, then succeeds after recovery. | Correct public version acknowledged; failure history retained. |
| t-64 | 2 Jul 2029 | AJ-01 / A01-09 | Reconcile course listing/intake and open recruitment. | Required SRS, prospectus and listing checks complete. |
| t-63 | 9 Jul 2029 | AJ-01 / A01-10 | Reconcile/archive evidence and complete the AJ-06 starting pack. | Approved-course hand-off available before Sam's enquiry. |
| t-52 to t-48 | 24 Sep 2029 | AJ-06 / A06-01 | Sam compares universities and asks about field-study options. | Uses the approved course and public specification. |
| t-47 | 29 Oct 2029 | AJ-06 / A06-02 | Sam visits the university following accessible booking arrangements. | Visit/follow-up recorded separately from academic attendance. |
| t-36 | 14 Jan 2030 | AJ-06 / A06-03 | Receive Sam's UCAS application and reconcile identifiers. | One linked application; course/intake verified. |
| t-35 to t-33 | 21 Jan 2030 | AJ-06 / A06-04 | Check evidence, assess the application and assess fee status. | Authorised academic assessment and a separate fee-status decision under the applicable policies. |
| t-32; t-24 | 11 Feb 2030; 8 Apr 2030 | AJ-06 / A06-05 | Issue the conditional offer at t-32; record Sam's firm-choice response at t-24. | Exact offer and official-channel state reconciled; conditions still outstanding. |
| t-23 to t-7 | 15 Apr 2030 | AJ-06 / A06-06 | Pre-arrival preparation, housing/funding enquiries and support information. | Service-owned tasks; no premature full student entitlements. |
| t-6 to t-5 | 12 Aug 2030 | AJ-06 / A06-07 | Receive results at t-6; resolve missing Geography and confirm the place at t-5. | Verified ABB evidence and authorised decision; not yet enrolment. |
| t-4 | 26 Aug 2030 | AJ-06 / A06-08 | Govern prospective-student conversion and invite registration. | Reuse canonical identity; one registration case. |
| t-3 to t-2 | 2 Sep 2030 | AJ-06 / A06-09 | Complete registration checks and authorise enrolment by t-2. | Academic/financial outcomes recorded; enrolment bound to the approved diet. |
| t-2 to t-1 | 9 Sep 2030 | AJ-06 / A06-10 | Confirm first-stage registrations and reconcile service provisioning. | Each service applies the authorised version; pending failures remain owned. |
| t; t+1 | 23 Sep 2030; 30 Sep 2030 | AJ-06 / A06-11 | Academic year starts with arrival/induction at t; first teaching at t+1. | Arrival, registration and teaching are distinct evidenced events. |

The hand-off from AJ-01 to AJ-06 contains: tenant, programme/route/award/diet IDs and versions; cohort and mode/site; approved entry requirements; dependency manifest and actual content digest when generated; approval/condition references; SRS application receipt; authorised public specification and publication receipt; intake/listing aliases, approved recruitment window and policy versions. Public content and restricted governance evidence travel in separate access scopes. The curriculum release authorises definitions, not individual admission decisions.

In a future fixture implementation, generate the actual content digests and test receipts and assert equality at each hand-off. The main path must stop if the required starting evidence is missing.


### Continuation through graduation

The same anchor continues through the continuation stories (AJ-16 onwards). The [continuation calendar](taught-student-fixture.md#calendar-and-ordering) records their cross-story milestones; each narrative has its own weekly walkthrough. The first two stories above remain the course/admissions entry points. Sam, Nina and Ben have distinct records and branches; no one student is made to experience every exception.

| Main milestone | Week commencing | Evidence / next story |
|---|---|---|
| t+1 | 30 Sep 2030 | First teaching and usable support; AJ-20/AJ-21. |
| t+39 | 23 Jun 2031 | First-stage board ratification; AJ-25. |
| t+40 | 30 Jun 2031 | Results and progression published; AJ-26, then AJ-18/AJ-16. |
| t+52 | 22 Sep 2031 | Explicit fixture start of stage-2 academic year; teaching at t+53. |
| t+91 | 21 Jun 2032 | Second-stage ratification; publication at t+92. |
| t+104 | 20 Sep 2032 | Explicit fixture start of stage-3 academic year; teaching at t+105. |
| t+143 | 20 Jun 2033 | Final ratification: Sam recommended for award, Ben authorised for reassessment. |
| t+144 | 27 Jun 2033 | Final outcomes published; AJ-26/AJ-29 consume their distinct decisions. |
| t+145 | 04 Jul 2033 | Sam’s authorised award conferral; AJ-29. |
| t+146 | 11 Jul 2033 | Sam’s official documents issued/archived; AJ-29. |
| t+148 | 25 Jul 2033 | Ben’s ethics reassessment; AJ-26. |
| t+150 | 08 Aug 2033 | Sam’s ceremony; separately Ben’s supplementary board. Different events and authorities. |
| t+151 | 15 Aug 2033 | Ben’s supplementary outcome published. |
| t+152 | 22 Aug 2033 | Ben’s conferral: lower second (55.33), with the capped project counted at 40. |
| t+156 | 19 Sep 2033 | Sam’s planned leaver-service reconciliation window ends; owned exceptions remain visible. |

## Exchange and evidence convention

This convention applies to the interaction table in every journey, including AJ-01 and AJ-06. Each table defines the domain-specific payload, authority and success evidence. All rows inherit: tenant/environment, contract version, source object/version, effective and recorded times, sender authority, correlation ID, destination and content digest where applicable. “Key” in each table is the deduplication identity, additionally scoped by tenant, provider authority and destination. Same key/content returns the existing receipt; conflicting content is quarantined. New versions require new operations; a stale event cannot overwrite a newer applied version.

Logical internal commands and external adapters obey the same decision boundaries. Actual API/file/manual transport must be agreed, not inferred from a reference-model arrow. Acknowledgement means the consumer applied the intended version or supplied a reconcilable snapshot, not merely that a message was sent. Failures retain owner, last error, next action and retry history; no operator edits academic facts to clear an integration fault. Support evidence and identity documents are not copied into general logs or replay queues.

Every scene leaves actor/role, decision/reason, source and policy versions, timestamps and references to its evidence. Keep original records and append corrections. Reminders and escalations never imply approval.

## Review and test status

Document structure, links, identifiers, the anchor-date arithmetic, simple credit arithmetic and the stated finite pathway example can be checked without an institution. Academic validity, approval authority, course commitments, admissions practice, accessibility, privacy, external contracts and institutional operating policy require the designated reviewers named in each story.

Three scenario choices in AJ-01 and AJ-06 are Northbridge policy defaults, chosen to make the stories concrete and open to reversal at review: the composition of the approval panel (including external and student members), the must-pass ethics component, and no advertising or offers before approval (two separate settings).

The continuation adds explicit scenario defaults for registration, selection, assessment, progression, board authority, award classification and service closure. Four of them were settled at review and can also be reversed: a capped reassessment counts at its capped mark for classification; Nina's first-year adjustment runs to the end of the academic year (t+51); exam boards receive no reasonable-adjustment information by default; and field-study capacity is added as a second field-trip cohort. They remain proposed fictional policy choices, not changes to the application or institutional approval. AJ-22/23/27/28/34/38 now have expanded hand-offs, alongside AJ-02/03/07/08. AJ-35/37/39/40 and the other unexpanded catalogue entries remain discovery work; references to them identify required inputs or outcomes without asserting complete contracts.


### Extension review and chronology

The v0.6 extension adds ten stories: shared-module change, programme review, alternative admission, part-time recognition, exceptional circumstances, engagement intervention, appeals/corrections, interruption/return, reporting and records. Its [shared chronology](change-and-exceptions-fixture.md#time-anchors-and-connected-chronology) retains t and explicitly introduces tJ for Jo. The new policies are fictional defaults requiring review by the named institutional roles.

The connected examples include Leah's replacement first attempt, Omar's interruption and version-1 return, Priya's distinct appeal/correction branches, Alex's Clearing place, Robin's deferred entry and Jo's 20 recognised plus 340 planned credits. AJ-02 supplies an approved module dependency to AJ-03; their 2033 release leaves existing bindings unchanged. AJ-34 and AJ-38 follow the resulting evidence into reporting and records. These documents add proposed acceptance cases; they do not claim executed application journeys.


Authoring checks for this extension (13 November 2026): the set contains 22 stories, 147 scenes, 114 interaction specifications and 202 proposed acceptance cases. The ten new stories contribute 65 scenes, 51 interactions and 84 cases. Local links/anchors, definitions/references, requirement/process identifiers, table structure, 38 dated milestones, Jo's 14 time-anchor conversions and credit/prerequisite arithmetic were checked. The existing Sam/Ben classification calculations remain consistent. These are document checks, not execution of the acceptance cases or institutional validation.
