# AJ-33 — Thesis, viva, corrections and award

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Research fixture](research-and-partnership-fixture.md) · [Common award services](aj-29-awards-graduation-and-alumni.md)

**Perspective:** Morgan, an external and an internal examiner with an independent chair, Research Registry and repository staff. **Boundary:** examination readiness through immutable thesis submission, ratified outcome, verified corrections/deposit and separate research award conferral. **Timeline:** tR+148 to tR+178; employment reconciliation continues to tR+184. tR = 22 September 2031 = t+52.

## The story

### Readiness and independent appointment — tR+148 to tR+154

Morgan's team recommends examination readiness. Registry checks candidature, required milestones, financial/access arrangements for the post-funded period and the applicable examination policy. A supervisor's recommendation does not appoint examiners or decide the result.

An external examiner from another institution, an internal examiner who has not supervised Morgan and an independent chair are nominated with expertise, eligibility and conflicts. The designated authority approves the panel after resolving an identified conflict through replacement. A suggested name remains pending until its appointment is approved. The distribution list is scoped to that panel and the permitted administrative roles, not everybody involved in the original grant.

### Submission fixes what will be examined — tR+156

Morgan submits thesis `THESIS-MORGAN-001@1`, with its actual content digest, declarations and receipt. The service records the immutable submitted version and links it to the examination case. A later upload cannot replace it unnoticed. Any permitted pre-examination correction creates an explicit successor with authority and acknowledgement by the affected examiners.

Only the appointed panel receives access. The thesis may rely on research permissions and evidence from AJ-31, but their existence is not inferred from a successful upload. If a required declaration or permission remains unresolved, the relevant examination gate stays owned and visible.

### Reports and viva precede the academic outcome — tR+160 to tR+166

Each examiner submits an attributable report against the same thesis version. The chair confirms required reports and arrangements before the viva at tR+164. Approved accessibility arrangements change delivery where needed, without changing academic criteria or exposing private support evidence.

The panel's main decision is pass subject to specified corrections. Registry records the exact correction list, responsible verifier, deadline tR+176 and permitted review route. The deadline already allows for the 2034/35 closure (tR+169 to tR+171), in which no verification is scheduled. Authorised ratification occurs at tR+165 and publication at tR+166. The outcome is locked; the published decision is not yet a conferred degree. A disagreement or appeal follows a governed research amendment route with authority equivalent to the original decision, reusing AJ-27's controls without inventing a taught exam board.

### Verify the corrections against the decided requirements — tR+172 to tR+174

Morgan submits a revised thesis and response identifying each required change. The original examined version, revised version and response remain linked. The designated examiners verify every requirement at tR+174. “Uploaded” cannot stand in for “accepted”; an incomplete correction returns with reasons and an owned deadline decision.

If the deadline is missed, Registry applies the supplied policy for extension or further decision under authority. A timer cannot confer the award or fail the candidate automatically. Different examination outcomes, including further examination or no award, use separately supplied rules and must not be forced through the main corrections path.

### Deposit, completion and conferral are separate gates — tR+175 to tR+178

The repository receives the final approved version with access, rights and embargo instructions. It returns a verified deposit reference and matching digest at tR+175. The approved 12-calendar-month public embargo does not make the deposit absent: authorised storage and permitted examination access remain demonstrable. A missing or mismatched deposit blocks completion.

Research Registry records candidature completion at tR+176 only after the ratified outcome, verified corrections and deposit requirements are satisfied. The designated award authority explicitly confers the research award at tR+177. AJ-29's common document/ceremony services issue the correct research documents at tR+178. No taught classification, fictitious taught exam-board record or HEAR is created.

### Close academic relationships without deleting evidence

Supervision and academic milestone relationships are end-dated according to the recorded completion/conferral decisions. CRIS receives the authorised outcome and profile status. A replayed earlier active-candidature event cannot reopen it. Thesis versions, examiner decisions and deposit evidence remain governed records under AJ-38.

Morgan's second teaching appointment is still valid. IAM closes or changes the appropriate student services but retains employee rights through tR+184 as AJ-32 requires. A ceremony invitation is separately optional and does not change the award date. An archive or notification failure remains an operational task rather than undoing academic conferral.

## Starting pack and authority

Supply `PGR-EXAM-2034@1`, actual progress and candidature evidence, panel appointments, synthetic thesis files/digests, reports, decisions and repository stubs as their scenes occur. Do not preload correction acceptance into the viva snapshot. Panel/chair authorities determine examination outcomes, designated examiners verify corrections, repository staff attest deposit, Registry records completion and the awards authority confers. These use core PGR cases under ADR-023, not a separate workflow engine or taught-result workaround.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A33-01 | tR+148 to tR+154 | Verify readiness and appoint independent panel. | Scoped appointments and resolved conflicts. |
| A33-02 | tR+156 | Receive immutable thesis/declarations and distribute. | Versioned submission receipt and authorised panel access. |
| A33-03 | tR+160 to tR+166 | Receive reports, hold viva, ratify and publish. | Locked corrections outcome, deadline and review route. |
| A33-04 | tR+172 to tR+174 | Receive and verify revised thesis/response. | Every correction accepted or explicitly unresolved. |
| A33-05 | tR+175 to tR+178 | Verify deposit, complete candidature, confer and issue. | Separate deposit/completion/award/document records. |
| A33-06 | tR+176 to tR+184 | Reconcile CRIS, relationships and distinct access roles. | Academic history retained; valid employment preserved. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A33-I01 / BP-05-010; GI-12 | Candidate → examination case: thesis version/digest, declarations and submission action. | Submission operation + version; own-record candidate. | Immutable receipt; changed content cannot reuse the old version. |
| A33-I02 / BP-05-010; ADR-023 | Panel/chair → examination case: appointments, reports, viva decision and ratification authority. | Case stage/action + evidence version. | Locked attributable outcome; conflict or missing report blocks the required gate. |
| A33-I03 / GI-12 | Candidate/verifiers ↔ correction case and repository: revised version, accepted requirements, deposit/embargo metadata. | Correction/deposit operation + version; separate verifier and repository authority. | Verified corrections and matching deposit receipt; failed deposit remains pending. |
| A33-I04 / BP-06-006; A29-I02/I03 | Registry/award authority → core and document issuer: completed candidature, examination/deposit references and separate conferral command. | Completion or conferral operation; distinct authorities. | One research award and correct issued documents; no taught classification/HEAR. |
| A33-I05 / F-SIS-CRIS-01; A32-I05 | SRS → CRIS/access owners: authorised completion, relationship end-dates and scoped student effects. | Completion/publication version + target. | Applied profile/entitlements; employment survives independently, stale active state rejected. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A33-AC01 | Examiner conflict or missing appointment approval. | Distribution/decision gate blocked for the affected scope. |
| A33-AC02 | Replace submitted thesis content under the same version. | Reject mutation; require authorised successor and reviewer acknowledgement. |
| A33-AC03 | Required report is absent before viva/decision. | Relevant gate stays pending; no invented examiner assurance. |
| A33-AC04 | Ratify pass subject to corrections. | Locked outcome with requirements; no automatic completion or award. |
| A33-AC05 | Revised thesis uploaded but one correction unverified. | Correction/completion gate remains unresolved with owner and deadline. |
| A33-AC06 | Deposit absent, digest wrong or embargo applies. | Missing/wrong deposit blocks; a verified embargoed deposit can satisfy its separate requirement. |
| A33-AC07 | Replay conferral after response loss. | Existing research award receipt; no duplicate degree or taught-record placeholder. |
| A33-AC08 | Complete candidature during active teaching employment. | Academic relationships end appropriately; employment and retained evidence remain. |

## Traceability, implementation and review

BP-05-010/011, BP-06-006 and BP-08-005 in the [process inventory](../../business-processes/process-inventory.md); HRP-003/004 and EDR-001/002 in [core requirements](../../requirements/functional-requirements.md); [ADR-023](../../decisions/ADR-023-pgr-supervision-and-examination-authority.md); GI-12/GI-15/GI-17 cover repository, award verification and records contracts.

The [capability matrix](../current-capabilities.md) records PGR examination/completion APIs and administrative views, with remaining examiner-facing portal gaps. This narrative does not claim a live repository integration or an executed institutional examination. Review owners, unassigned: PGR Registry, independent examiners/chair, research regulations, repository/library, awards, accessibility and privacy. Closing evidence connects the immutable thesis to the locked decision, verified corrections/deposit and separate conferred award.
