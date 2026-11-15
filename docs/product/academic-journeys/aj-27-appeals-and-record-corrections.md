# AJ-27 — Challenging an outcome and correcting the record

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Extension fixture](change-and-exceptions-fixture.md) · [Board decisions](aj-25-exam-board-and-ratification.md)

**Perspective:** Priya, an appeals officer, an independent reviewer and Registry. **Boundary:** challenge or discovered error against a published decision through authorised disposition, amendment and recipient reconciliation. **Timeline:** t+40 to t+51; the clerical branch runs t+49 to t+51; a separately supplied post-award branch can occur after t+146. Use the [shared timeline](README.md#timeline-convention).

## The story

### Priya challenges the process — t+40 to t+41

Priya receives her stage-1 result and believes a documented circumstance determination was omitted from the board's evidence. She submits `APPEAL-PRIYA-001`, naming the published decision and explaining the alleged procedural omission. The appeals officer acknowledges receipt, explains the review route and calculates the deadline from the actual release timestamp under `APPEAL-2030@1`.

Submitting an appeal does not erase the result, lift every restriction or suspend every deadline. The officer separately records any authorised interim study arrangements and their expiry. A complaint about an unhelpful service follows its own route; it cannot silently change an academic mark.

### Independence and admissibility come first — t+41 to t+42

The officer checks scope, timing and evidence. A reviewer involved in the original decision declares the conflict and is replaced. Priya can add a permitted statement and see the process status. A disagreement with academic judgement alone is outside this fixture's appeal grounds; an out-of-time submission needs a reasoned admissibility decision rather than automatic acceptance.

The independent reviewer receives the exact issued pack, the determination's version and delivery history. The source owner confirms that an approved, relevant determination existed before the board cut-off but was omitted. Private underlying evidence remains restricted; an appeal does not justify broad disclosure to every participant.

### An upheld appeal returns the decision to its owner — t+43 to t+46

At t+43 the reviewer upholds the procedural ground and remits the affected decision for reconsideration. The reviewer does not assign extra marks. The original ratified outcome remains identifiable as under reconsideration until the properly authorised replacement is made.

The board secretary prepares a corrected pack/addendum, records the required review and checks the authority for an extraordinary reconsideration at t+45. The board authorises a replacement first attempt for the affected assessment under the supplied circumstance policy. At t+46 Registry publishes the replacement decision and action plan. It does not report a pass or progression before that attempt has been completed and ratified. Her replacement attempt is at t+48, moderated at t+49 and ratified by a supplementary board at t+50, with publication at t+51, before stage 2 starts at t+52. Scheduling and result use AJ-22/24/26 contracts with her own evidence. Because ratification falls after the stage-2 selection window closes at t+50, Priya drafts her choices within the window. Under `SELECTION-LATE-2030@1` they are held unconfirmed, reserve no seat and are confirmed at t+51 once her progression is published, with prerequisites and capacity checked on that date. If the attempt or its ratification slips, her stage-2 registration waits on an authorised decision under `PROGRESSION-EDS-2030@1`, not an assumed pass.

### A clerical error takes a different route — t+49 to t+50, separate branch

In an isolated copy of Priya's fixture, AJ-34's field-lineage reconciliation at t+49 finds that the assessor's authenticated source gives 62, but the ratified record contains 26. The reporting analyst refers the discrepancy rather than patching the extract. Registry opens an administrative correction against that exact record; it does not reuse the appeal outcome. The verified discrepancy, impact and applicable delegated authority are recorded. A correction command expecting the old version is rejected if another authorised amendment has already replaced it.

The authorised amendment records 26 → 62, recalculates the affected module/profile and obtains the required ratification and publication authority at t+50. Other results are supplied explicitly before any progression or award is recalculated. The original mark and decision remain reconstructible. Correcting the academic fact and sending its consequences are separate, retryable steps.

### The correction must reach everyone who relied on it — t+46 to t+51

Registry identifies affected portal results, study plans, reporting snapshots and, in a post-award variant, issued documents. Each owner receives the relevant authoritative revision and returns applied-state evidence. In the clerical branch the same reconciliation runs at t+50 to t+51 and includes AJ-34's correction submission. A failed portal update remains an owned discrepancy; it does not undo the amendment or justify editing the locked original again.

AJ-34 handles reporting amendments and AJ-29 handles replacement award documents after the appropriate award authority. The appeals officer explains the outcome and remaining review route. AJ-38 retains the case and disclosure evidence under the relevant schedule and any active hold.

## Starting pack and authority

Supply Priya's original ratified decision/pack, publication timestamp, appeal grounds and evidence, independent reviewer assignments and `APPEAL-2030@1`. The omission branch supplies the pre-existing determination and its cut-off history. The clerical branch instead supplies source mark 62, recorded 26 and delegated correction policy; the branches cannot share an assumed decision. Appeals staff determine admissibility, independent reviewers determine the appeal, academic authorities reconsider results, and Registry publishes and reconciles.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A27-01 | t+40 to t+41 | Receive challenge against the exact published version. | Receipt, calculated deadline and separate interim arrangements if authorised. |
| A27-02 | t+41 to t+42 | Check admissibility, conflicts and evidence scope. | Independent review or reasoned non-admission. |
| A27-03 | t+43 | Determine the procedural ground. | Remit for reconsideration; no mark invented. |
| A27-04 | t+44 to t+46 | Reconstitute evidence, decide and publish. | Authorised replacement decision linked to its predecessor; attempt dated t+48, ratification t+50, publication t+51. |
| A27-05 | t+49 to t+50, alternative | Verify 62 versus 26 and authorise correction. | Versioned correction and recalculation, separate from appeal. |
| A27-06 | t+46 to t+51 | Reconcile affected consumers and close case tasks. | Applied revisions or owned exceptions; retained appeal/correction history. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A27-I01 / F-EWP-SIS-01; GI-16 | Student → appeals process: challenged decision/version, grounds, evidence references and requested remedy. | Submission revision; own-record or authorised representative. | Case/admissibility receipt; duplicate request does not open competing amendments. |
| A27-I02 / GI-16; GOV-007 | Appeals reviewer → academic reconsideration owner: reasoned disposition, scope and required reconsideration. | Appeal decision version; independent appointed reviewer. | Owned reconsideration reference; no direct mark update from appeal outcome. |
| A27-I03 / A25-I01, A25-I03; ABR-014 | Reconsideration/correction owner → board/authorised amendment service: exact old version, evidence, proposed change and authority. | Case + amendment operation + expected version. | Locked predecessor and authoritative successor; stale basis requires renewed review. |
| A27-I04 / ABR-016, ABR-017; GI-22 | Amendment service → affected owners: before/after references, effective/recorded times and required consequence. | Amendment + destination; domain-specific receiving authority. | Portal/plan/report/document applied receipt; failures retain owner and retry without duplicate amendment. |
| A27-I05 / F-SIS-EDRMS-01, F-SIS-EWP-01 | Case/records owners → archive and student: permitted decision bundle and accessible explanation. | Case publication/issue version + target. | Archive and delivery evidence; specialist documents remain restricted. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A27-AC01 | Submit timely procedural grounds with an omitted determination. | Independent review of exact evidence and decision version. |
| A27-AC02 | Reviewer has a conflict or appeal lacks admissible grounds. | Reassign reviewer or give reasoned non-admission; no silent case disappearance. |
| A27-AC03 | Uphold omission and remit the decision. | Academic reconsideration required; reviewer cannot manufacture a pass or mark. |
| A27-AC04 | Verify source 62 against recorded 26 in correction branch. | Authorised successor records 62; 26 and original ratification remain recoverable. |
| A27-AC05 | Amendment expects an already superseded version. | Reject stale operation and reassess impact; no overwrite of newer authority. |
| A27-AC06 | Consumer fails after amendment commits. | Academic correction remains valid; owned idempotent reconciliation. |
| A27-AC07 | Treat a service complaint or rights request as permission to change marks. | Route to appropriate authority; academic locks remain enforced. |
| A27-AC08 | Correction affects a submitted return or issued award. | AJ-34/AJ-29 governed downstream amendment, original versions retained. |

## Traceability, implementation and review

BP-05-011 and BP-08-002/005 in the [process inventory](../../business-processes/process-inventory.md); GOV-004, GOV-007 and EDR-001 in [core requirements](../../requirements/functional-requirements.md); ABR-014–017 and IGA-005/006 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-16 covers appeal/complaint actors and contracts.

The [capability matrix](../current-capabilities.md) records partial post-ratification correction, including incomplete population of source-version references. It does not establish the whole independent appeal route. Review owners, unassigned: academic regulations, appeals, board chair, Registry, privacy and reporting. Closing evidence is the exact challenged record, independent disposition, authorised successor, published explanation and affected-consumer receipts.
