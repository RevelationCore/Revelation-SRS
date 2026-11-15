# AJ-15 — A small course becomes a longer pathway

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Short-course fixture](flexible-learning-and-service-fixture.md) · [Recognition assessment](aj-08-part-time-entry-and-prior-learning.md)

**Perspective:** Dev, the continuing-education team, Finance, a credential issuer and an academic recognition assessor. **Boundary:** standalone booking through verified completion/credential, then a separate decision about a future award route. **Timeline:** tX-12 to tX+22; planned target entry tX+52. tX = 20 September 2032 = t+104.

## The story

### The product says what the learner can earn — tX-12

Dev wants a short course in applied evidence methods before committing to a longer qualification. The public listing identifies approved module SC701, 10 credits at level 7, assessment requirements, delivery dates, entry requirements, the fictional £300 price and the award body's credential. It distinguishes assessed credit from a separate non-assessed workshop certificate.

The team records a booking and verifies the learner's identity sufficiently for the service and later credential. An existing person record is reused through the governed identity route. Dev is a standalone learner, not automatically an admitted postgraduate certificate student. The description says later recognition is subject to academic approval; “stackable” cannot promise unconditional admission or double use of the same credit.

### Payment confirmation and learning readiness are separate — tX-11 to tX-9

Finance creates the authorised charge and payment operation. The payment service times out after receiving the instruction. Staff query that operation before requesting any retry; the returned receipt shows one £300 payment. A booking screen saying “submitted” would not establish settlement, and a second payment request with a new identifier could charge Dev twice.

Continuing education confirms the place after the required academic and financial readiness checks. IAM and the learning service apply the limited course role and dates. No full award-student entitlement or unrelated student-finance confirmation follows. A sponsor-funded variant needs a separately verified sponsor obligation rather than treating a purchase-order reference as cash received.

In a separate cancellation-before-start branch, the supplied policy permits a full £300 refund. Finance authorises it against the original charge and reconciles the refund receipt once. That branch does not coexist with the main completed-course history. A payment dispute or later withdrawal follows its own terms and authority.

### Participation earns credit only through assessment — tX-8 to tX-3

Dev studies the agreed material, receives the approved learning support and submits the assessed portfolio at tX-3. The tutor verifies the work and records feedback against SC701's outcomes. Attendance or a video completion indicator cannot substitute for the assessed requirement.

The assessor proposes 64 against a pass threshold of 50. Independent moderation at tX-2 checks the standard and the designated short-course academic authority ratifies at tX-1. This uses the controlled assessment pattern in [AJ-24](aj-24-assessment-and-results.md), with the short course's supplied rules and delegation. It does not require pretending that Dev attended Sam's undergraduate board. A failed or incomplete assessment leaves the credit unearned even if payment has settled.

### The credential reflects the actual confirmed achievement — tX

The authorised issuer creates `CRED-DEV-SC701-001@1`, referring to the verified identity, module version, level, 10 credits, confirmed result and issue date. Its verification reference must resolve to the issuer's current permitted status; a decorative badge alone proves little. The source result and issued artefact are archived with their own receipts.

Dev receives an accessible copy and an explanation of how to verify it after course access ends. Public verification exposes only the approved minimum; it is not a public student-record search. A name or result correction follows the appropriate governed amendment route, links a replacement to the superseded credential and updates verification status. The original issue history remains. No actual signed credential or production verification endpoint exists merely because this narrative names one.

### A later award application asks a new question — tX+18 to tX+20

Dev later applies for the 60-credit postgraduate certificate NBU-APGC, planned to start at tX+52. Admissions checks the target programme's entry requirements independently. The recognition assessor retrieves the authoritative SC701 result and credential, verifies provenance and currency, and compares it with the target's exact SC701 requirement.

Under `STACK-2033@1`, recognised credit must be no more than five years old, at the required level and used once within the target award. At most 20 credits may be recognised and at least 40 must be newly earned on the target route. A certificate for the separate non-assessed workshop supplies no credit. Evidence from a differently named provider would require its own equivalence decision, not this internal exact-match route.

### Recognition creates a remaining plan, not another award — tX+22

After separate admission approval, the academic recognition authority accepts Dev's 10 SC701 credits into the target plan. The resulting requirement ledger has 10 recognised and 50 remaining: SC702 (10), SC710 (20) and SC720 (20). Those 50 future credits exceed the minimum of 40 newly earned credits if Dev later completes them. The source learning remains identifiable; no second SC701 assessment or duplicate credit is created.

The adviser checks future offerings, timetable, fees and the planned start. Registration still needs the target year's checks. Dev receives the recognition decision and review route, plus a clear explanation that the postgraduate certificate remains unearned. A later award would need the full confirmed result profile and [AJ-29's separate conferral](aj-29-awards-graduation-and-alumni.md).

If Dev declines the offer, the standalone credential remains valid under its own terms. The award application can close without erasing completed learning, recharging the short course or implying that Dev withdrew from a programme they never registered on.

## Starting pack and authority

Supply `SHORT-2032@1`, `STACK-2033@1`, both approved curriculum specifications, synthetic booking/payment responses, assessed work and verified result/credential when available. Continuing education owns booking, Finance owns charges/refunds, academics own assessment and recognition, Admissions owns target entry and the authorised issuer owns credential publication/verification. IAM owns dated access; it does not decide credit or admission.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A15-01 | tX-12 | Verify accurate product/credit description and learner identity. | Standalone booking with explicit recognition limits. |
| A15-02 | tX-11 to tX-9 | Reconcile payment timeout and confirm readiness. | One £300 payment and scoped course access. |
| A15-03 | tX-8 to tX-1 | Study, assess at -3, moderate -2 and ratify -1. | Confirmed 64 and 10 level-7 credits. |
| A15-04 | tX | Authorise, issue and archive verifiable credential. | Attributable credential and separate delivery/archive evidence. |
| A15-05 | tX+18 to tX+20 | Assess later admission and verify recognition evidence. | Separate target-entry and recognition decisions prepared. |
| A15-06 | tX+22 | Authorise recognition and remaining plan for entry +52. | 10 recognised plus 50 remaining; no registration or award inferred. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A15-I01 / GI-09, GI-23 | Booking service ↔ learner registry: identity link, approved course/version and booking status. | Booking + person-link decision; authorised identity owner. | One learner/booking; ambiguous identity remains restricted review. |
| A15-I02 / GI-09, GI-11 | Finance ↔ payment service: charge/payment or separately approved refund. | Charge + payment/refund operation; Finance authority. | Queried settlement/refund receipt; no duplicate effect after timeout. |
| A15-I03 / F-SIS-IAM-01, F-SIS-VLE-01; GI-09 extension | Confirmed learner registration → learning/access services: module, role and dates. | Learner registration + target version. | Scoped applied access; short-course contract does not imply full degree enrolment. |
| A15-I04 / GI-09; F-SIS-EDRMS-01, F-EDRMS-SIS-01 | Academic result/issuer ↔ credential service/archive: confirmed achievement, issue and verification status. | Credential + issue version; academic/issuer authorities separated. | Issued/archived artefact with status; replacement retains predecessor. |
| A15-I05 / GI-04, GI-09 | Recognition authority → target record: verified source credit, allocation and remaining plan. | Decision + source credit + target requirement. | 10 credits allocated once; distinct admission and later registration gates. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A15-AC01 | Learner books a non-assessed workshop. | Participation certificate may issue; no academic credit or automatic stacking. |
| A15-AC02 | Payment request times out after processing. | Query/reuse original operation; exactly one £300 payment. |
| A15-AC03 | Cancel before start in the separate refund branch. | Authorised £300 refund once, linked to original charge; no completion credential. |
| A15-AC04 | Payment and attendance exist but assessment is incomplete. | Credit and assessed credential remain blocked. |
| A15-AC05 | Ratified 64 is supplied for SC701. | 10-credit credential issued with exact definition/result provenance. |
| A15-AC06 | Credential is corrected or replaced. | Old issue remains traceable; verification shows its superseded status. |
| A15-AC07 | Evidence is too old, at the wrong level or allocated twice within the award. | Recognition rejected or returned under supplied policy; no duplicate credit. |
| A15-AC08 | Approve Dev's target admission and 10-credit recognition. | 50 remain, satisfying the 40-new-credit minimum only if later earned; no award inferred. |

## Traceability, implementation and review

BP-03-002–006 and the award/identity processes in the [process inventory](../../business-processes/process-inventory.md); Finance, IAM and EDR-001/002 in [core requirements](../../requirements/functional-requirements.md); IGA-001–006 and XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-04/GI-09/GI-11 require explicit recognition, booking, credential and payment contracts.

The [capability matrix](../current-capabilities.md) does not establish a complete short-course commerce, credential-verification or stacking service. Review owners, unassigned: continuing education, academic standards, Admissions, Finance, credential/records owners, IAM and privacy. Closing evidence connects the single settled charge, confirmed source credit, issued credential and separately approved remaining award plan.
