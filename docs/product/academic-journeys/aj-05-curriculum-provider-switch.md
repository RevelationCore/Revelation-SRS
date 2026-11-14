# AJ-05 — Changing the curriculum-management provider

Status: **Proposed narrative v0.7**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Switch fixture](research-and-partnership-fixture.md) · [Accepted curriculum](README.md#shared-scenario-northbridge-entry-cohort-2030)

**Perspective:** the curriculum owner, integration lead, Registry and authorised migration reviewers. **Boundary:** a governed provider switch through reconciled authority transfer, preserved history and a demonstrable rollback decision. **Timeline:** t+112 to t+122; the reverse-direction rehearsal uses an isolated copy of the same snapshot. Use the [original t](README.md#timeline-convention).

## The story

### An optional module is not an optional source of truth — t+112

Northbridge decides to replace its internal curriculum-authoring module with a fictional external product. The core SRS must continue accepting the same approved-release semantics. Disabling an internal feature flag cannot migrate definitions, open proposals or approvals, and it cannot make two publishers authoritative at once.

The lead opens `CM-MIGRATION-2032-01`, names the scope, owners, freeze window, acceptance criteria and rollback route. The chosen fixture already contains the original EDS release, Jo's part-time route, the accepted future 2033 release and the explicit part-time closure instruction. None can disappear because the external product initially displays only current recruitment.

### Inventory meaning as well as rows — t+112 to t+114

The team inventories stable object identities, academic versions, provider aliases, releases, student bindings, historic approvals, conditions and public/consumer receipts. It includes accepted but not yet academically effective content: `SCI440@2.0` and the 2033 course must survive the switch without becoming current for 2030 students.

An open proposal is returned for rework. Its exact revision, comments, workflow definition, pending tasks and authority are recorded. The team decides individually whether each open case finishes under restricted old-provider operation, is cancelled, or is exported and restarted under a documented migration policy. A signature for the old content is not translated into blanket approval in the new tool.

### Rehearse the mapping without changing live authority — t+115 to t+118

The rehearsal and freeze window (t+115 to t+119) overlaps the 2032/33 closure (t+117 to t+119) by design: it is an approved quiet-period change window, with the curriculum owner, integration lead and Registry cutover approver named and on call, and no curriculum approval scheduled in it. A dry-run imports definitions and provenance into an isolated target. Reviewers compare identifiers, credits, outcomes, prerequisite rules, dates, closure scope and actual content digests. They reconstruct Sam's version-1 course and Jo's remaining plan, and verify that the future version stays future. Missing evidence is a failed check, not an invitation to generate substitute minutes.

The target adapter submits a sample complete release to the same acceptance boundary. An incomplete dependency set is rejected atomically. A changed digest under a reused release identity is quarantined. Publication receipts and consumer effects are reconciled, rather than judging success from matching object counts alone.

### Freeze publication, not ordinary student work — t+119

The curriculum owner freezes publication at an explicit source sequence/watermark. In-flight releases are drained or quarantined with their outcomes recorded. Student operations continue against already accepted data; the freeze is not a reason to stop ordinary result access or module registration.

The final delta is reconciled and the cutover approvers sign the exact inventory and evidence. An unresolved in-flight release or changed preview prevents authority transfer. Retained old tasks receive an explicit permitted disposition and cannot publish after the scope moves unless routed through the new authoritative owner.

### Transfer one authority and test it — t+120 to t+122

The authorised switch changes `internal-cm/epoch-1` to `external-cm/epoch-2` atomically for the scope. Old publication credentials, scheduled publication jobs and new internal authoring/workflow starts are disabled for that scope; permitted historical access remains. A delayed epoch-1 release is rejected or quarantined even if its credential once worked.

The new provider's authorised test release passes the canonical checks and yields one application receipt. Existing SRS identities, versions and student bindings remain stable; original approval provenance still names the internal provider. Public and admissions channels reconcile the intended release/closure states. No student is moved to the newest academic rules because the publisher changed.

### Rollback depends on what has happened

Before the new authority has published consumed changes, the approved rollback restores the reconciled prior service using a fresh authority epoch and retained audit. It does not reuse a retired token that could revive old messages. If the target has already published consumed content, rollback first inventories those effects and prepares approved corrective releases. Restoring an old database backup would erase accepted decisions and is not the permitted recovery.

A separate reverse rehearsal starts from the external-provider snapshot and switches to the internal module with `internal-cm/epoch-3`. It performs the same inventory, open-case decisions, acceptance checks and history reconstruction. The demonstration proves provider independence only if both directions preserve the contract; two toggles on a settings page do not suffice.

## Starting pack and authority

Supply `CM-SWITCH-2032@1`, actual accepted manifests/digests and receipts, provider registrations, scoped credentials in the isolated environment, open cases, in-flight ledger, mapping rules and receiver stubs. No production switch is authorised by this document. The curriculum owner owns publication authority; academic approvers retain content decisions; the integration lead executes approved migration operations; Registry verifies student/rule bindings; reviewers authorise cutover/rollback based on evidence.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A05-01 | t+112 to t+114 | Inventory definitions, history, bindings and open work. | Complete scope and explicit proposal dispositions. |
| A05-02 | t+115 to t+118 | Rehearse mappings and canonical acceptance. | Equivalence/receipt evidence or owned blocking gaps. |
| A05-03 | t+119 | Freeze publication, drain/quarantine and reconcile final delta. | Signed watermark and exact cutover evidence. |
| A05-04 | t+120 | Transfer authority to a new provider epoch. | One writer; old publication paths fenced. |
| A05-05 | t+120 to t+122 | Verify release, consumers and historical reconstruction. | Stable student bindings and reconciled destinations. |
| A05-06 | Isolated rollback/reverse branches | Reconcile effects and switch back under new authority. | Safe pre-/post-consumption recovery and reverse-direction evidence. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A05-I01 / CM-MIG-001/002; GI-21 | Source owner → migration review: complete version/provenance/binding/open-case inventory. | Migration + inventory revision; source custodian. | Reviewed manifest and exceptions; unknown history blocks equivalence claims. |
| A05-I02 / CM-MIG-004/005 | Export/import owners ↔ isolated target: mapped objects, original provenance and explicit open-case dispositions. | Source version + mapping revision + target. | Dry-run differences and reconciled import; no approval invented during conversion. |
| A05-I03 / CM-MIG-003/006 | Authorised cutover command → provider registry/publication boundary: scope, watermark and new authority epoch. | Cutover operation + expected authority version. | Atomic one-writer receipt; stale authority rejected even after retries. |
| A05-I04 / F-CM-SIS-01; A01-I03 | New provider → SRS: approved exact release under canonical semantics. | Provider epoch + release + digest. | Atomic accepted receipt or quarantine; IDs/bindings remain stable. |
| A05-I05 / CM-MIG-008/009; GI-22 | Recovery owner → affected services: approved rollback/corrective releases and reverse-switch scope. | Recovery decision + operation/target. | Reconciled consumed effects and new authority receipt; no blind snapshot restore. |

AJ-39/40 remain unexpanded operational/audit stories. Their required exchange history and reconstruction inputs are defined here, not claimed to be a complete incident or disaster-recovery procedure. An optional ESB transports messages without owning academic or publisher authority.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A05-AC01 | Switch with current, future and closed-intake definitions. | All retained with applicability and closure scope; student bindings unchanged. |
| A05-AC02 | Open proposal lacks explicit disposition or approval evidence. | Migration gate blocked; no fabricated new approval. |
| A05-AC03 | Target omits dependency or changes content under reused identity. | Atomic rejection/quarantine, not partial catalogue acceptance. |
| A05-AC04 | Publish after freeze beyond the accepted watermark. | Governed drain/reconcile decision required before cutover. |
| A05-AC05 | Old provider sends a delayed release after authority transfer. | Rejected/quarantined by epoch; one authoritative writer remains. |
| A05-AC06 | Roll back before any new changes are consumed. | Reconciled restoration under fresh authority; retired token never reused. |
| A05-AC07 | Roll back after downstream consumption. | Impact reconciliation and authorised corrective releases; no destructive backup restore. |
| A05-AC08 | Repeat external-to-internal rehearsal. | Same acceptance, provenance and historical-binding guarantees in reverse. |

## Traceability, implementation and review

BP-03-001 and BP-08-006 in the [process inventory](../../business-processes/process-inventory.md); CAT-005/007/009 in [core requirements](../../requirements/functional-requirements.md); CM-ARCH-001–008, CM-MIG-001–010 and CM-VER-008 in [curriculum requirements](../../requirements/curriculum-management-system.md); XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md).

The [capability matrix](../current-capabilities.md) records catalogue and exchange foundations as partial; it does not establish this bidirectional governed migration. Review owners, unassigned: curriculum, Registry, integration/security, records, vendor and operational acceptance owners. Closing evidence includes exact inventories, case dispositions, mapping/reconstruction results, fenced authority, consumer receipts and a rehearsed recovery decision.
