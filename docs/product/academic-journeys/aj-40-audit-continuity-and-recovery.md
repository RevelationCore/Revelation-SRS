# AJ-40 — Proving continuity through change

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Continuity fixture](flexible-learning-and-service-fixture.md) · [Records governance](aj-38-records-rights-and-retention.md)

**Perspective:** an institutional auditor, Registry's accountable owner, a platform operator and security/records reviewers. **Boundary:** reconstruction of an academic decision through an isolated upgrade/recovery rehearsal and an explicit operational acceptance decision. **Timeline:** tX+30 to tX+34, equivalent to t+134 to t+138; tX = 20 September 2032 = t+104.

## The story

### Reconstruct what people could know at the time — tX+30

The auditor selects Priya's established clerical-correction branch from [AJ-27](aj-27-appeals-and-record-corrections.md) and its reporting effects in [AJ-34](aj-34-reporting-and-statutory-returns.md). At t+49 the analyst identified a recorded 26 that disagreed with the assessor's source value of 62. Registry amended the authorised record at +50; the signed reporting correction followed at +51. These are separate from Priya's appeal/replacement-attempt branch and must not be collapsed into one contradictory history.

The review assembles the original result/decision, evidence identifying the error, delegated correction authority, successor record, publication and reporting snapshots. A query for what was recorded before the amendment returns the original state; a later view can show the corrected fact with its effective date and the later recording date. A current value of 62 cannot prove that every earlier consumer already knew it. Snapshot s2 and correction snapshot s3 retain their own lineage.

The auditor also checks the applicable curriculum and assessment-rule versions, rather than replaying the case under the latest rules. Missing historical evidence becomes an owned finding. Neither a convincing current screen nor a new narrative description can substitute for the original decision record.

### Agree the rehearsal boundary and evidence inventory — tX+30

The platform team opens `CONTINUITY-NBU-2033-001` under `CONTINUITY-REHEARSAL@1`. All work occurs in an isolated synthetic environment with external sends disabled. The exercise inventories database versions, documents and digests, audit coverage, role/tenant configuration, command receipts, inbox/outbox state, pending tasks and workflow history where relevant. A checksum confirms the bytes compared; it does not prove that their original academic content was correct.

The inventory includes a separate pending synthetic review, `AUDIT-REVIEW-PENDING-001`, with definition version 1, an assigned reviewer, unresolved task revision and deadline. It is an operational review fixture, not a new academic event in Priya's history. A second synthetic tenant deliberately reuses a local person identifier to test isolation; tenant scope must distinguish it from Northbridge's record.

Registry, security, records and platform owners agree proposed exercise targets of a 15-minute recovery point and four-hour recovery time. The measurement starts, ends and required consistency checks are specified before the run. These are fictional objectives awaiting review, not assertions about existing production performance. Missing credentials, keys, retained documents or compatible backups prevent the relevant recovery gate from being marked ready.

### An upgrade preserves pending human work — tX+31

The team introduces review-definition version 2 for new instances while the existing pending instance remains pinned to version 1. Its decision context, task revision, reviewer permissions and deadline remain unchanged. A separate migration variant requires an explicit compatibility plan and approval; the operator cannot silently move open tasks to the new definition or mark them approved to clear an error.

For a process using live Temporal execution, the rehearsal must include compatible workflow code/history and the application's command, receipt and event-outbox evidence. A saved human decision whose delivery timed out is reconciled through its original command and task revision; it must not produce a second approval effect. An old task revision is rejected after a legitimate successor has replaced it. Timers escalate or mark attention as configured; they never grant academic approval.

Other business cases and workflow families retain their actual execution model. The [capability matrix](../current-capabilities.md) documents selected Temporal coverage and remaining gaps; this exercise cannot assume every process runs there or that Worker Versioning is implemented. If compatible execution cannot be demonstrated, the upgrade is held with an owner rather than claiming that a definition edit alone migrated live work.

### Restore a consistent system, not just a database — tX+32

The operator restores the selected synthetic recovery point into a fenced environment. The evidence manifest checks alignment between the database, retained documents, applicable workflow histories, operation receipts and message state. Restoring only SRS while leaving a workflow engine or external receiver ahead can replay actions that already happened. That mismatch must be reconciled before outbound work resumes.

Current security revocations, processing restrictions, retention dispositions and holds are separately reconciled from their authoritative evidence. An older backup cannot resurrect access that was revoked afterwards or make disposed information available again. If the current restriction/disposition ledger is unavailable, affected reads and outbound processing stay blocked pending records/security review. Retained archival evidence and prohibited operational reuse have different permissions.

A service-disruption variant records user impact and a permitted contingency route through [AJ-37](aj-37-publication-and-communications.md). Deadline relief or an academic exception requires the responsible domain owner's decision; infrastructure recovery does not authorise blanket extensions. Urgent welfare/safety responses continue through their designated responders rather than waiting for a database restore.

### Reconcile effects that survived outside the backup — tX+32 to tX+33

The exercise supplies a receiver receipt for an instruction applied after the chosen backup point. The restored outbox would otherwise send it again. Operators query and reconcile the original operation through [AJ-39](aj-39-integration-failure-and-reconciliation.md), preserving the applied external effect and the source decision's provenance. Payment variants use inert Payroll/Finance stubs; no live money or regulatory submission is sent.

Each domain receives a reconciliation report: authoritative source records, expected effects, observed receipts, mismatches, actions and unresolved owners. An older source decision recovered from backup cannot override a newer confirmed result, an expired entitlement or the epoch-2 curriculum authority. Reverse provider recovery follows AJ-05's fresh-authority rules rather than reviving epoch 1.

The auditor repeats the before/after reconstruction, pending-task and cross-tenant checks. Existing audit hash-chain/seal coverage is verified only over records actually covered by it. Historic unsealed records remain explicitly unsealed; an after-the-fact digest cannot establish integrity before its creation. Missing audit continuity is reported even when current business totals happen to match.

### Acceptance is a decision supported by measured evidence — tX+34

The exercise records elapsed recovery time, the latest consistently recovered point and any lost or reconstructed work, with the measurement basis and unresolved differences. It compares them with the proposed targets; a service answering HTTP requests is not enough to stop the recovery clock if decision history or required effects remain unreconciled.

Registry signs off academic consistency, security and records owners confirm their controls, and platform/service owners assess operational readiness. A blocker keeps the affected scope closed; an accepted residual exception names its authority, limits, compensating action and review date. Conditional acceptance is not a claim that every acceptance case passed. The auditor remains independent of the operator's work.

The closing pack identifies what was demonstrated and what still needs implementation or institutional approval. It retains the exact exercise inputs, comparison outputs and decisions for another reviewer to reproduce. This document specifies that pack; it does not supply measurements or claim that Revelation has already completed a disaster-recovery rehearsal.

## Starting pack and authority

Supply `CONTINUITY-REHEARSAL@1`, Priya's distinct before/after correction evidence, exact rules, synthetic backups/documents, workflow/command histories for the tested runtime, the pending review fixture, two-tenant probes and isolated external receipts. Include authoritative current holds, restrictions, revocations and dispositions. Registry owns academic consistency, domain owners own external effects, records/security own restrictions, platform staff perform recovery and the designated operational authority decides release. Operators cannot self-certify missing academic history.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A40-01 | tX+30 | Reconstruct Priya's correction and the facts known at each cut-off. | Original/amended decisions and reporting snapshots remain distinguishable. |
| A40-02 | tX+30 | Inventory isolated recovery scope, pending review and tenant probes. | Approved exercise plan and explicit measurement targets. |
| A40-03 | tX+31 | Upgrade new definitions while preserving existing work/runtime evidence. | Pending tasks and decisions retained or owned compatibility blocker. |
| A40-04 | tX+32 | Restore consistent state and reconcile current restrictions. | Fenced recovery; no stale access or prohibited reuse. |
| A40-05 | tX+32 to tX+33 | Reconcile surviving external effects, authority and audit coverage. | No duplicate effects; explicit differences and unsealed history. |
| A40-06 | tX+34 | Measure, review and decide scoped operational acceptance. | Attributable acceptance/hold with findings, not an assumed pass. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A40-I01 / BP-08-006; PLT-TMP-001–003 | Authorised records/domain owners → auditor: historic facts, rules, decisions and applied-effect references. | Audit scope + valid/recorded cut-offs + source versions. | Reproducible reconstruction or explicit missing evidence; no fabricated history. |
| A40-I02 / GI-22; PLT-WFL-001–006 | Workflow/runtime owner ↔ recovery environment: definitions, pending task revisions, histories and command receipts. | Instance + definition/task/command versions. | Existing human work preserved; duplicate decisions and unauthorised migration blocked. |
| A40-I03 / GI-17, GI-24; IGA-011–015 | Security/records owners → recovery gate: current revocations, restrictions, holds and disposition scope. | Control decision + effective version. | Enforced controls after restore; missing current evidence blocks affected processing. |
| A40-I04 / XIC-002–005; A39-I02 | Recovery operator ↔ isolated external receivers: original-operation state and reconciled receipts. | Original operation + tenant/target. | Surviving effects retained once; no unsafe resend from restored outbox. |
| A40-I05 / BP-08-006; EDR-001/002 | Exercise owners/reviewers → governed archive: manifest, measurements, differences and acceptance/hold decisions. | Exercise + pack/decision version. | Verifiable archived pack and independent sign-off, with unresolved findings retained. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A40-AC01 | Query Priya's record before and after the authorised correction. | Original 26 and successor 62 appear at their correct recorded cut-offs, with authority/provenance. |
| A40-AC02 | Required historic approval or audit segment is absent. | Owned finding; no regenerated approval or claim of pre-seal integrity. |
| A40-AC03 | Introduce definition version 2 while a version-1 task is pending. | Existing context/deadline preserved; migration requires explicit compatibility and authority. |
| A40-AC04 | A saved decision times out or a stale task revision is replayed. | Original receipt/command reconciled once; stale decision cannot approve a successor task. |
| A40-AC05 | Restore a database without matching documents/runtime/effect evidence. | Recovery remains fenced; missing consistency blocks operational acceptance. |
| A40-AC06 | Backup predates a security revocation, restriction or disposition. | Apply current controls before access/sends; unavailable evidence keeps affected processing blocked. |
| A40-AC07 | Receiver already applied an operation, or another tenant shares its local identifier. | Reconcile once within tenant scope; no duplicate effect or cross-tenant access. |
| A40-AC08 | Service starts but recovery targets or required consistency checks fail. | Record measured failure and scoped hold/authorised exception; no unsupported continuity claim. |

## Traceability, implementation and review

BP-08-005/006 in the [process inventory](../../business-processes/process-inventory.md); PLT-AUD, PLT-TMP, PLT-WFL, PLT-MT and PLT-INT requirements in [core requirements](../../requirements/functional-requirements.md); IGA and XIC requirements in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-17/GI-22/GI-24 identify cross-service records, runtime and continuity responsibilities beyond a single database restore.

The [capability matrix](../current-capabilities.md) records audit and selected live Temporal capabilities with explicit limitations. It does not establish the full recovery protocol or these measured targets. Review owners, unassigned: independent audit, Registry, domain/service owners, platform/runtime, security, records/privacy and institutional continuity. Closing evidence must show preserved decisions, pending work, isolation and reconciled effects, with a separate operational acceptance decision.
