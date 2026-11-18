# BP-04-004 Review Pack: Manage a Reasonable Adjustment Case

> Status: Submitted for independent professional review, 2026-11-18; reviewers awaiting nomination
> Process: [BP-04-004 Manage a reasonable adjustment case](bp-04-004-manage-a-reasonable-adjustment-case.md)
> Decision: [Phase 5 D-44](../../decisions/phase-5-gap-closure-decisions.md#d-44-the-independent-professional-review-of-the-adjustments-workflow-bp-04-004)
> Prepared by: the project. It has not been reviewed, and nothing here is approved.

This pack is for the independent professional review of the reasonable-adjustment case workflow. It asks for two reviewers: a disability-service practitioner, for the process and its outcomes, and a data protection officer, for the evidence, retention and disclosure controls. The software cannot provide this review. It sets out what is built, the tests that show each control works, how to walk through it with the demo, and the decisions the reviewers are asked to make.

## What is built, and where

| Control | Where it is built | What it does |
|---|---|---|
| Case state machine | `modules/wellbeing` (adjustment cases) | A case moves referral received → under assessment → determination made → under review (panel) → approved, rejected or closed. Only legal transitions are accepted; an illegal one returns 409. Every version of the case is kept. |
| Approval needs a determination | `modules/wellbeing` approval route | A case cannot be approved without a recommending assessment or an upheld or modified panel decision (409). |
| Separate roles | `packages/domain` permissions, `modules/wellbeing` | Advisors record and assess; panel decisions, approval and rejection need `panel-decision:write` (panel chair or registry administrator); mental-health session notes are limited to mental-health advisors and auditors. |
| Evidence store | `packages/documents` | Evidence is stored with a SHA-256 checksum, every download is logged, and deletion is a soft delete with a reason. A student can download only their own case's evidence. |
| Student self-service | `apps/portal` (Adjustments), `modules/wellbeing` | A student requests support and uploads evidence for their own case only. A first request opens a disability support case automatically. |
| Minimum outcome to core | `apps/api` (reasonable adjustments) | Core SRS receives only the approved adjustment: its type, scope, amount and dates, and `source_case_id` linking back to the case. Case notes and evidence stay in the wellbeing module (ADR-017). |
| Distribution to targets | `apps/api` (adjustment distributions) | Each approved adjustment is instructed to each target: the VLE, attendance and exams. A target is connected (event), manual (a staff task) or file, or not used, set per tenant. Targets confirm applied or failed, and an expired adjustment is withdrawn from each target and confirmed. |
| Exam arrangements | `apps/api` (exam entries) | Exam entries carry each candidate's in-force adjustments, with combined extra time computed per exam (for example 120 minutes + 25% = 150). |

## Tests that show each control

| Control | Tests |
|---|---|
| State machine and versions | `modules/wellbeing/test/stage4-adjustment-workflow.int.test.ts`: "rejects a transition out of a closed case", "bitemporal: all versions are preserved", "start-assessment a second time is idempotent" |
| Approval precondition | same file, "approve requires a determination (precondition)": 409 with neither a recommending assessment nor an upheld panel decision |
| Roles | `modules/wellbeing/test/stage7-security-privacy-audit.int.test.ts`: advisors cannot record panel decisions, approve or reject; session-note access by role |
| Evidence | stage 4 file: upload returns a checksum, byte-for-byte download, another student cannot download, deleted evidence no longer appears |
| Self-service | stage 4 file: a student can create and read only their own case, and cannot start an assessment |
| Minimum outcome and link | `apps/api/test/adjustments.int.test.ts`: `sourceCaseId` stored from the hand-off; outcome documents limited to the owning student |
| Distribution and withdrawal | `apps/api/test/adjustment-target-fulfilment.int.test.ts`, `adjustment-distribution-instructions.int.test.ts`: modes, the manual queue, failures kept with a reason, removal tasks on expiry, overdue digests with no student details |
| Exam arrangements | `apps/api/test/exam-entry-adjustments.int.test.ts`: combined extra time, no invented minutes, withdrawal before and after the exam is sat |

## Walk through it with the demo

1. In the portal, sign in as a demo student, open Adjustments and request support, attaching evidence.
2. In the admin app, open Governance → Adjustment cases. Start the assessment and record a recommending assessment.
3. As a panel chair, approve the case, choosing the SRS adjustment type and amount.
4. Open the student's record: the approved adjustment is on the Wellbeing tab with a link to its case.
5. Open Operations → Integration tasks to see the manual attendance task, and the exam board's exam entries for the extra time.
6. Expire the adjustment and see the withdrawal tasks.

## Decisions for the reviewers

| Question | How the software behaves now | Reviewer response |
|---|---|---|
| Who may approve a case: a named delegated authority, or only the panel? | A panel chair or a registry administrator (`panel-decision:write`) approves; nothing stops the person who assessed the case also approving it. | |
| When must a case go to a panel rather than be approved on an assessment? | Either a recommending assessment or a panel decision is enough to approve. | |
| How long is case evidence kept, and who may see it? | Kept until deleted by staff, with downloads logged; the wellbeing module has retention administration, but this process sets no period. | |
| What is the minimum content of an approved outcome sent to core and to targets? | Type, scope, amount, dates and the case link; no diagnosis or notes. | |
| The default fulfilment mode for each target | VLE connected, attendance manual, exams file. | |
| How is a refusal recorded, and must it give a reason code? The Equality Act 2010 Schedule 13 duty does not extend to adjusting a competence standard (paragraph 4); the EHRC code of practice should be considered (paragraph 7). | A rejection records a free-text rationale on the case; there is no reason code. | |
| `forceApprove` lets approval go ahead when the student has no active module registrations. Should it be allowed, and by whom? | Allowed to the approver. | |
| Northern Ireland: the Equality Act 2010 largely does not extend there. Which disability framework applies to NI students? | The same workflow is used for every student. | |
| Exceptional-circumstances notes are held as free text in core SRS. Is that acceptable under ADR-017, or should they stay in the wellbeing module? | Notes are kept on the core EC record. | |

## What this pack does not cover

- National variants beyond the Northern Ireland question above.
- The wellbeing module's own event stream: the case process publishes no domain events (see BP-04-004's change history).
- Load and accessibility testing of the case screens.

Sources: [Equality Act 2010, Schedule 13](https://www.legislation.gov.uk/ukpga/2010/15/schedule/13); [Explanatory notes to Schedule 13](https://www.legislation.gov.uk/ukpga/2010/15/notes/division/3/16/30).
