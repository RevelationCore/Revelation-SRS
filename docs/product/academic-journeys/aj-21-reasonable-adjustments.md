# AJ-21 — Support agreed once and delivered where it is needed

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Shared continuation](taught-student-fixture.md) · [Assessment](aj-24-assessment-and-results.md)

**Perspective:** Nina, a support adviser and the teaching/examination teams responsible for delivery. **Boundary:** a separate request for study support through an authorised adjustment and verified operational implementation, review or expiry. Exceptional circumstances remain AJ-22's separate process. **Timeline:** t-24 to t+51 with review at t+32; use the [shared t](README.md#timeline-convention).

## The story

### Nina asks for support — t-24 to t-8

Nina is considering how she will manage her studies and contacts the designated support service. She is a separate fictional student, not a reinterpretation of Sam's step-free open-day request. Nina receives a clear explanation of what evidence is needed, who can see it and what can happen before registration.

The adviser opens case `SUPPORT-NINA-001` and helps Nina submit the required information through an accessible route. A parent or other helper has only any explicitly authorised scope. Evidence stays within the specialist service. The general academic record need not contain a diagnosis for staff to implement an accessible-format or examination instruction.

### A decision describes the practical effect — t-8 to t-3

The adviser assesses the request and documents the recommendation. A designated approver verifies the scope, evidence and delivery implications. The decision in this fixture authorises accessible learning formats and 25% additional time for specified timed written exams. It does not authorise a blanket absence exemption or unlimited extensions to every assessment.

Nina can see the outcome, its effective dates, review point and how to ask for reconsideration. If a request is returned for evidence, the case has a reason and owner. Being referred is not the same as being approved; a pending case cannot be published as an implemented adjustment. Where provisional support is permitted, it needs its own explicit authority, scope and expiry rather than pretending final approval has occurred.

### Services receive instructions, not the case file — t-3 to t-1

The approved outcome, linked to the governed person and source decision, reaches SRS. SRS stores the operational version effective from t through t+51, the end of the stage-1 academic year, and derives the minimum payload for each necessary consumer. The VLE receives the learning-format instruction. Exam planning receives the applicable timed-assessment instruction. Attendance needs no exception in this main path; a separate variant with an approved attendance treatment uses its own scoped payload.

Each consumer acknowledges application. A lecturer seeing “approved” cannot assume the file conversion or exam-room arrangement is already complete. The case view shows Nina and authorised staff which actions are ready and who owns anything pending. When a recipient is unavailable, the approval remains valid and an operational recovery task is opened.

### Nina can use the support — t+1 to t+30

Nina opens accessible teaching material at the first session. Before the relevant written exam, she checks the published arrangements and can report a discrepancy. For the fixture's 120-minute exam, 25% adds 30 minutes, giving 150 minutes; this instruction does not change the marking criteria or guarantee a mark.

An examination-service receipt is lost in an exception branch. The operator queries the applied version before retrying, rather than booking a second special arrangement or asking Nina to restart her case. If the arrangement is genuinely absent, the examination owner must resolve it before declaring the exam ready. Sensitive support evidence is not sent with the operational retry.

### Review preserves continuity and history — t+32 to t+51

The adviser reviews the support with Nina at t+32. The first version deliberately runs to t+51, so it still covers any summer reassessment. The review issues the stage-2 version, effective from t+52, before the first one ends, so there is no gap between years. If the next year needs revised arrangements, that new decision/version identifies its period and recipients. The initial approval does not silently extend to all three years. Any changed or withdrawn instruction produces the required recipient updates with dates and acknowledgement.

The first-year version expires at its authorised end. Historic examinations still retain the arrangement that applied at the time; expiry is not permission to rewrite past deadlines or marks. The adviser checks future assessments so an expiry does not leave an unowned delivery gap. A separate time-bound personal disruption would enter AJ-22, not alter this ongoing adjustment by stealth.

## Starting pack and actors

Supply Nina's permitted applicant/student identity, a restricted synthetic case/evidence pack, the configured assessment/approval policy and target-specific instructions from the shared continuation. No real medical evidence is required. Introduce the enrolment/linkage outcome when available; do not create a fake active enrolment to allow an early support request.

Nina provides information and reviews delivery. The adviser owns assessment/recommendation; the authorised approver owns the decision; SRS owns the confirmed academic operational effect; service owners own implementation. General lecturers, integration operators and board members do not gain access to the private evidence by receiving an instruction.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A21-01 | t-24 to t-8 | Open request and collect evidence in restricted service. | Owned case and accessible evidence route. |
| A21-02 | t-8 to t-3 | Assess and approve explicit scope/dates. | Versioned decision, or an explained return/review task. |
| A21-03 | t-3 to t-1 | SRS accepts outcome and distributes minimum instructions. | Per-target applied status; no clinical case dump. |
| A21-04 | t+1 to t+30 | Confirm usable materials and actual exam arrangements. | Operational implementation and owned discrepancy resolution. |
| A21-05 | t+32 | Review needs and future-year applicability. | New decision if necessary; no automatic rollover. |
| A21-06 | t+51 | Expire/supersede and reconcile recipient state. | History preserved and future assessments checked for gaps. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and minimum payload | Key / authority | Applied-state evidence / failure path |
|---|---|---|---|
| A21-I01 / F-SIS-WELL-01 | SRS → Wellbeing on authorised context request/change: identity/link, course/assessment context and permitted declarations. | Context version + purpose; authorised support access. | Source context received; uncertain identity remains a case task, not a forced merge. |
| A21-I02 / F-WELL-SIS-01 | Wellbeing → SRS on approved decision: case/decision version, scoped instruction, dates, review point and visibility. | Decision/outcome version; named approver. | Accepted operational effect/receipt; reject unapproved or mismatched input without losing specialist case evidence. |
| A21-I03 / F-SIS-VLE-02, F-SIS-AM-02, F-SIS-EXAMS-01 | SRS → necessary consumers on outcome/change: target-specific operational instructions and applicable student/assessment scope. | Outcome version + target; SRS distribution authority. | Applied instruction/version; main path excludes unwarranted attendance treatment. Retry/reconcile safely; downstream services receive no direct Wellbeing evidence feed. |
| A21-I04 / F-SIS-EWP-01; GI-20 | SRS/case owner → authorised student/status view: approved effect, recipient readiness and action/contact route. | Outcome/status version + audience; scoped publishing authority. | Accessible visible status; delivery is distinct from approval and from actual implementation. |

AJ-24 owns the examination entry and allocation created using A21-I03's instruction; it returns delivery evidence to that distribution process. AJ-25 receives no adjustment information by default: adjustments are applied when the assessment is sat, so the board has nothing to decide about them. A board-level exception needs its own documented justification. F-WELL-SIS-02 belongs to exceptional circumstances and is not repurposed here.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A21-AC01 | Approve the specified support and demonstrate delivery. | Correct effective version and usable materials/150-minute exam, not only “sent” status. |
| A21-AC02 | Recommendation lacks approval, evidence or person linkage. | Return/pending state with owner; no assumed final adjustment or fake enrolment. |
| A21-AC03 | Send entire evidence bundle to a lecturer/consumer. | Disclosure denied; only necessary operational effect available. |
| A21-AC04 | Consumer fails or acknowledgement is lost. | Approval retained; reconcile applied state and retry without duplicate instruction or booking. |
| A21-AC05 | Apply this outcome as attendance exemption or blanket extension. | Scope violation blocked; a different treatment requires its own decision. |
| A21-AC06 | Supersede/expire while an older event is replayed. | Current dated state wins; past arrangements preserved, future gaps assigned. |
| A21-AC07 | Nina needs accessible assistance or disputes the decision. | Equivalent submission/review route, scoped helper access and attributable human authority. |
| A21-AC08 | Treat an exceptional-circumstances claim as an ongoing adjustment. | Separate case/decision route required; no manufactured assessment result. |
| A21-AC09 | Nina has a summer reassessment at t+44, or the t+32 review is late. | The first version still applies at t+44; a late review raises an owned task before t+51, and no assessment falls between versions. |

## Traceability, implementation and review

BP-04-004/006 and BP-05-002 in the [process inventory](../../business-processes/process-inventory.md); ADJ-001–006, VLE-003, ATT-003 and GOV-008 in [core requirements](../../requirements/functional-requirements.md); ESP-007–012 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-20 addresses accessible communication/representatives.

The [capability matrix](../current-capabilities.md) records an implemented adjustments baseline but no independent professional review of its case workflow. Open decisions for support, assessment/exams, academic accessibility, privacy and integration owners: approval/provisional routes, visibility, expiry and delivery escalation. Closing evidence contains the approved operational version, target receipts, review/expiry decisions and references to restricted source evidence.
