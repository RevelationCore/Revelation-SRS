# AJ-24 — From assessment entry to confirmed marks

Status: **Proposed narrative v0.6**, 13 November 2026 · [Document status](README.md#status-of-these-documents) · [Shared marks and rules](taught-student-fixture.md#marks-and-results-that-interlock) · [Exam board](aj-25-exam-board-and-ratification.md)

**Perspective:** Sam, Nina, Ben, assessors, moderators and an examinations officer. **Boundary:** approved assessment definitions and registrations become candidate attempts, examination arrangements and confirmed results for a board. Ratification/publication belong to AJ-25. **Timeline:** t+8 to t+36 for stage 1; final-year example t+132 to t+140. Use the [same t](README.md#timeline-convention).

## The story

### Students know what they are being assessed on — t+8

The assessment owner checks that each offering consumes the approved module assessment version. Students see the component, deadline, criteria and relevant submission method. A marker cannot improvise a new weighting in a spreadsheet. Each candidate attempt links to the student registration, component and policy version, so another attempt is not mistaken for a replacement mark.

Sam submits work through the stated route and retains a receipt. The system distinguishes a submission, an absence, an unrecorded mark and a confirmed failure. Missing data is not zero merely because a board deadline is approaching. Physical or practical assessments also need an attributable source record; VLE integration is not the only permitted mark source.

### Examinations are ready in practice — t+24 to t+30

The examinations officer prepares entries from confirmed registrations and creates candidate numbers, rooms and seating arrangements. Nina's approved instruction arrives through SRS. Her specified 120-minute written exam becomes a 150-minute arrangement, with accessible resources as required, without changing its academic criteria.

Nina can check the published arrangements and raise an error. The officer verifies actual allocation/readiness rather than treating approval of an adjustment as proof that the exam service applied it. Exam scheduling produces logistics; it cannot pass a student or ratify a module result.

### Marks become a controlled set — t+30 to t+36

Assessors submit raw marks with the scale, attempt, marker and source version. A moderator works against a fixed mark-set snapshot, examines the selected work and records reasons for changes. The source and changed marks remain inspectable. The confirmed set has clear completeness and moderation status.

A suspected integrity issue is a separate branch, not an allegation about Sam, Nina or Ben. The investigator receives the necessary submission context, allows the response/evidence process and returns a formally authorised outcome. A suspicion alone is not a penalty. An unresolved case is represented accurately in board preparation; neither the marker nor the integration operator invents its result.

### The project exposes why a hurdle matters — t+132 to t+140

In the final year, Sam receives 60 for ethics and 68 for the project report. The result calculation retains `0.2 × 60 + 0.8 × 68 = 66.4`, the independent ethics pass and the project credit. Ben receives ethics 35 and report 70, giving `0.2 × 35 + 0.8 × 70 = 63`.

Ben's aggregate looks comfortably above 40, but the approved ethics hurdle requires at least 40 in that component. His result is therefore a failed hurdle with no project credit. The report is passed and its component outcome is preserved. A purely weighted-average implementation would be wrong. The interface explains the actual reason and indicates that the board will decide the authorised next step.

### Handing over evidence, not making the board's decision

The assessment owner supplies a reproducible result set: marks, attempts, policies, moderation, calculation and relevant approved case outcomes. Sam's and Ben's results are not yet labelled ratified. Any late correction creates a new set/version for AJ-25 rather than silently modifying an issued board pack. Post-ratification changes require [AJ-27’s governed correction and appeal process](aj-27-appeals-and-record-corrections.md), with exact predecessor/successor versions and recipient reconciliation.

## Starting pack and roles

Supply confirmed registrations/offerings, assessment patterns, configured scale/threshold/weight/cap rules, submission evidence, scoped staff authority and Nina's effective operational instruction where applicable. The final-year branch supplies the exact Sam/Ben inputs from the shared continuation, not invented prior passes. Identity and sensitive case evidence remain restricted.

Markers own attributable raw marks; moderators approve the mark set; the assessment service applies pinned deterministic rules; investigators own integrity decisions; exam staff own logistics. Academic authority is distinct from who uploaded a file. No actor in this story can bypass AJ-25 ratification to publish an official final result.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A24-01 | t+8 to t+24 | Establish attempts and record submissions. | Correct student/component/policy binding and receipt. |
| A24-02 | t+24 to t+30 | Prepare exam entries, arrangements and readiness. | Candidate logistics with applied approved accommodations. |
| A24-03 | t+30 to t+36 | Intake and moderate a frozen mark set. | Confirmed set or explicit missing/disputed evidence. |
| A24-04 | t+30 to t+36, separate branch | Process an integrity case and authorised consequence. | Governed case outcome, not automatic penalty from suspicion. |
| A24-05 | t+132 to t+140 | Calculate Sam/Ben project results with the hurdle. | Sam 66.4/pass; Ben 63/failed hurdle, no project credit. |
| A24-06 | t+36; t+140 | Supply controlled result snapshot to AJ-25. | Board-ready evidence with status/version and owned gaps. |

## Owned interactions

Use the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and minimum payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A24-I01 / F-SIS-EXAMS-01, F-EXAMS-SIS-01 | SRS ↔ EXAMS: confirmed entries/attempts, approved operational instructions; returned logistics version, candidate/seat/session allocations. | Entry/arrangement version + publication; exam authority, consuming A21-I03 instructions. | Applied arrangement snapshot and publication receipt; conflicts/missing support stay owned. No academic result inferred. |
| A24-I02 / F-VLE-SIS-01; GI-23 for other sources | VLE or controlled assessment source → SRS: attempt/component, raw mark or explicit status, scale, source/marker and prior version. | Source mark identity + attempt + version; authorised source. | Accepted/rejected mark receipt; duplicates do not add attempts, unknown mappings quarantine, absent data stays incomplete. |
| A24-I03 / BP-05-004/005 | Moderation/result service → controlled SRS set: frozen inputs, review evidence, rule manifest and explained calculation. | Mark-set version + moderation/calculation operation; designated authority. | Confirmed result set with reproducible intermediates; changed input creates a new version. |
| A24-I04 / F-SIS-AI-01, F-AI-SIS-01 | SRS ↔ Academic Integrity: permitted submission/registration context; returned authorised case outcome/penalty and scope. | Case decision version; integrity authority. | Outcome applies only to the identified attempt; pending allegation is not a confirmed penalty. AI means Academic Integrity here. |
| A24-I05 / BP-05-007; ABR-012 | Assessment → board preparation: result-set version, attempts, moderation/calculation references and unresolved-item list. | Set version + board scope; assessment owner supplies, board owner accepts. | Pack input receipt/reconciliation; prohibit raw/calculated status being relabelled ratified. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A24-AC01 | Receive, moderate and calculate complete authorised marks. | Traceable attempt and rule-version result; still unratified. |
| A24-AC02 | Ben has ethics 35 and report 70. | Weighted 63 but failed independent hurdle; zero project credit and no award eligibility. |
| A24-AC03 | Sam has ethics 60 and report 68. | 66.4, hurdle passed; prospective 40 project credits subject to ratification. |
| A24-AC04 | A required mark is missing or source mapping is uncertain. | Incomplete/quarantined result with owner, not fabricated zero/failure. |
| A24-AC05 | Duplicate mark event, wrong attempt or changed moderated input. | Replay idempotent; wrong attempt rejected; new version requires appropriate review. |
| A24-AC06 | Nina's approved exam instruction is absent at the receiver. | Readiness remains unresolved; 150-minute allocation verified before declaring success. |
| A24-AC07 | Integrity suspicion or raw mark is treated as final penalty/result. | Prevent that transition; require the proper authority and evidence. |
| A24-AC08 | Change a result already ratified, or access another tenant's work. | Governed correction/access restrictions enforced; no silent edit or disclosure. |

## Traceability, implementation and review

BP-05-001–006 in the [process inventory](../../business-processes/process-inventory.md); ASS-001–008, ACI-001–004 and GOV-008/GOV-009 in [core requirements](../../requirements/functional-requirements.md); ABR-001–006 and ABR-012 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md); CM-ASMT-002, CM-ASMT-003, CM-ASMT-004 and CM-ASMT-008 in [curriculum requirements](../../requirements/curriculum-management-system.md).

The [capability matrix](../current-capabilities.md) marks assessment partial and identifies incomplete rule-version explanation. Open decisions for assessment-regulation, module, moderation/exam, integrity and accessibility owners: criteria, pass/cap/rounding rules, source mappings and evidence visibility. The closing bundle is the exact board input.
