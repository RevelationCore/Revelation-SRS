# AJ-25 — Evidence becomes a ratified academic decision

Status: **Proposed narrative v0.5**, 13 November 2026 · [Document status](README.md#status-of-these-documents) · [Shared continuation](taught-student-fixture.md) · [Progression](aj-26-progression-and-reassessment.md)

**Perspective:** the Registry board secretary, an external examiner, the chair and students awaiting results. **Boundary:** controlled assessment evidence through an authorised board, locked decisions and separately authorised publication. Award conferral is AJ-29. **Timeline:** t+36 to t+40, t+88 to t+92 and t+140 to t+144; Ben's supplementary board is t+150 with publication t+151. Use the [original t](README.md#timeline-convention).

## The story

### Registry prepares a reproducible pack — t+36

The secretary assembles results from AJ-24, the applicable curriculum/rule versions, candidate profiles and relevant approved case outcomes. Each source is identified at the cut-off time. The board pack has a version and content digest, so everyone knows which evidence is being considered.

Sam's first-stage profile has six passed 20-credit modules. The displayed recommendation is to progress under the fixture rule, not a decision already made. A different candidate with unresolved evidence is clearly marked. The pack contains no reasonable-adjustment information by default: Nina's adjustment was applied when she sat her exam, and the board has no decision to make about it. An exceptional-circumstances variant must supply a genuine authorised AJ-22 outcome, not infer one from a support flag.

### The external examiner has time to scrutinise — t+37

The external examiner receives scoped access to the pack, the sampled work and the calculations. They ask whether marking of the shared `SCI440` Statistics exam is consistent between Environmental Data Science students and the other programmes that take it. Their role in this story is independent standards scrutiny; they are not automatically the external adviser from the earlier course-approval panel.

The secretary records the questions, responses and required assurance. If a mark-source correction arrives after the pack was issued, it creates a replacement or labelled addendum. Reviewers acknowledge the changed evidence before deciding. The original pack remains recoverable. Resending a link to an unversioned live report would not satisfy this control.

### The meeting has authority to decide — t+38 to t+39

The chair checks attendance, conflicts, required external input and quorum against `BOARD-EDS-2030@1`. A conflicted member is excluded from the relevant decision and the quorum is recalculated. The secretary records the collective decision; an administrative role does not substitute for the board's authority.

At t+39 the board ratifies Sam's first-stage outcomes and progression decision against the exact pack. Missing evidence does not force the whole cohort to receive a fictional result. Where the configured policy permits candidate-scoped decisions, complete unaffected candidates can be ratified and the unresolved candidate explicitly deferred. A global failure such as missing quorum still blocks ratification for the relevant meeting/scope.

### Publication is another controlled step — t+40

Registry authorises release at the scheduled time. Sam sees the ratified marks, progression result and next actions together. The portal cannot expose an unapproved live calculation as the official result. A failed notification has an operational owner; it does not undo the academic decision or warrant ratifying it again.

A correction after ratification needs a formally authorised amendment with the original record retained. A marker, chair or operator cannot unlock the result casually to make a discrepancy disappear. AJ-27 owns the expanded correction/appeal process, still to be written; this story defines the boundary and required hand-off evidence.

### The final board treats Sam and Ben differently — t+140 to t+144

At the final board, Sam's complete profile supports 360 credits and the fixture classification score of 65.41. The board ratifies the final outcomes and recommends the upper-second award. The awards authority will confer it in AJ-29.

Before this board, the external examiner asks whether the ethics hurdle is enforced independently of the project aggregate. The secretary points to Ben's case as the evidence. Ben's project aggregate is 63 but the ethics component is 35. The board records the failed hurdle and the permitted component reassessment. It cannot waive the non-waivable ethics rule by calling the aggregate a pass. Ben receives an explanation and an owned next step through AJ-26, not Sam's graduation invitation. After the permitted later attempt, a supplementary board considers the new evidence without rewriting the first decision.

## Starting pack and roles

Supply the exact assessment snapshots, registration/credit histories, pinned rule manifest, membership/delegations, declared conflicts, required external review and applicable exceptional-circumstances and integrity outcomes. Reasonable-adjustment information is excluded by default. First-stage and final-stage snapshots are separate; do not expose future marks in the early board. A reproduction must regenerate the same profile from its stated sources.

Registry prepares and publishes under authority; the chair/board make and ratify academic decisions; the external examiner provides required scrutiny; students receive only their permitted outcomes. Integration operators can recover publication, not substitute academic decisions. Approval-panel membership from AJ-01 grants no exam-board role by itself.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A25-01 | t+36 | Freeze board scope, source set and rule manifest. | Versioned pack with completeness/recommendation status. |
| A25-02 | t+37 to t+38 | External scrutiny and responses; version any late changes. | Required assurance on the exact evidence to be decided. |
| A25-03 | t+39 | Check quorum/conflicts and ratify. | Locked candidate decisions or explicit scoped deferrals. |
| A25-04 | t+40 | Authorise publication and reconcile recipients. | Student-visible official outcomes and next actions. |
| A25-05 | t+88 to t+92 | Repeat for stage 2 with new period evidence. | Stage-2 ratification at t+91, publication t+92. |
| A25-06 | t+140 to t+144 | Final board: Sam award recommendation, Ben reassessment. | Ratify t+143, publish t+144; two distinct authorised outcomes. |
| A25-07 | t+150 to t+151 | Supplementary board considers Ben's permitted attempt. | New ratified outcome and publication; previous failure retained. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A25-I01 / F-SIS-EXAMBOARD-01 | SRS → board on pack issue: candidate profiles, source/rule manifest, calculations, approved exceptional-circumstances and integrity outcomes (no adjustment information by default) and unresolved items. | Board + pack version; authorised preparation. | Issued pack/digest and review access; replacement/addendum preserves predecessor and renewed review. |
| A25-I02 / F-SIS-EXTEX-01, F-EXTEX-EXAMBOARD-01 | SRS → external examiner: permitted pack/sample access; examiner → board: review questions, assurance and source-pack reference. | Reviewer + pack version + review action; appointed examiner. | Attributable assurance/response; unanswered required concerns prevent the relevant gate. |
| A25-I03 / F-EXAMBOARD-SIS-01 | Board → SRS on ratification: decisions, scope, pack/version, authority, quorum/conflict record and rationale. | Board decision operation + candidate/scope revision; chair/board authority. | Atomic ratification/lock receipt; retries cannot create a second decision, stale pack decisions rejected. |
| A25-I04 / F-SIS-EWP-01; ABR-013 | SRS → portal/communications after release authority: ratified outcome/version, permitted explanation and next-action reference. | Outcome + release version + channel; separate publisher authority. | Applied portal state and delivery evidence; failed delivery leaves the ratified fact intact. |
| A25-I05 / BP-06-001/003; GI-22 | Ratified SRS outcome → progression/awards process: decision type, candidate, result/rule references and scoped recommendation. | Ratified decision + consumer; receiving domain authority. | AJ-26 action plan or AJ-29 eligibility case receipt; recommendation does not mean conferral. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A25-AC01 | Reconstruct Sam's pack and complete the first board. | Same source/rule results; ratified progression at t+39, official release t+40. |
| A25-AC02 | Quorum fails, conflict is unresolved or required external input missing. | Appropriate ratification gate blocked with owner/reason. |
| A25-AC03 | Source data changes after pack issue. | New pack/addendum and required review; no silent mutation of decided evidence. |
| A25-AC04 | Ben's aggregate passes but ethics fails. | No project credit/award; authorised reassessment outcome, not condonement. |
| A25-AC05 | Publish before authority or replay ratification after timeout. | Premature publication blocked; replay returns the original decision receipt. |
| A25-AC06 | One candidate's evidence is incomplete. | Explicit scoped deferral under policy; neither fake zero nor unratified result shown as final. |
| A25-AC07 | Late mark correction after ratification. | Governed AJ-27 amendment hand-off; locked original retained. |
| A25-AC08 | Student/examiner requests unrelated candidate or clinical evidence. | Scoped access and minimised pack enforce privacy; access is attributable. |
| A25-AC09 | Pack generation includes Nina's reasonable-adjustment record. | Excluded by default; inclusion needs a documented, board-specific justification and is logged. |

## Traceability, implementation and review

BP-05-007/008/009/011 and BP-06-001/003 in the [process inventory](../../business-processes/process-inventory.md); GOV-001–007, GOV-010 and ASS-005 in [core requirements](../../requirements/functional-requirements.md); ABR-007–017 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md).

The [capability matrix](../current-capabilities.md) marks boards partial and notes that pack hash/rule-manifest fields are not yet populated by pack generation. Open decisions for the board chair, Registry, external examining, academic regulations and privacy owners: quorum, independent review, candidate-scoped deferral, publication and correction authority. Closing evidence is the immutable pack/decision/lock/publication chain and accepted downstream action references.
