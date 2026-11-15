# AJ-39 — A hand-off fails during peak activity

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Operations fixture](flexible-learning-and-service-fixture.md) · [Provider switch](aj-05-curriculum-provider-switch.md)

**Perspective:** an integration operator, the affected service owner, Registry and a student waiting for a usable service. **Boundary:** authorised source decision through diagnosed delivery failure, safe recovery and verified receiver state. **Timeline:** Nina's receipt-loss branch t+29 to t+30, with routing rehearsal t+31; separate ordering test t+52 and provider-authority test t+120. Use t = 23 September 2030.

## The story

### Notice the failed service effect, not just the queue — t+29

Nina's approved timed-exam arrangement is valid, but the examination service's application receipt has not returned. The case appears in the operations queue with source decision, required consumer, last attempt and upcoming assessment impact. The operator opens a linked incident and names the examination owner. The underlying approval remains valid; Nina is not asked to repeat her support assessment.

The payload contains the necessary operational instruction, not the private support evidence. For the fixture's 120-minute exam, 25% additional time means 150 minutes. The service must establish that exact arrangement is applied before it declares exam readiness. A broker's delivery acknowledgement cannot answer that question. The student-facing update identifies the pending service action without exposing technical logs or sensitive evidence.

### Trace the original decision across the boundary — t+29

The operator follows the tenant, source version, destination, contract, correlation and operation identifiers. They compare the approved decision with the queued instruction and the receiver's recorded state. A contract rejection, unavailable endpoint, uncertain identity alias, lost receipt and stale source revision have different owners and remedies.

No operator changes a mark, registration, adjustment scope or provider authority to make a failed message acceptable. An invalid alias goes to its data steward; a schema incompatibility goes to the adapter owner; a revoked authorisation returns to the domain owner. Diagnostic logs and quarantine references contain only what is necessary to identify and safely replay the operation. Access to restricted source evidence requires a separate authorised purpose.

### Recover the acknowledgement before repeating the effect — t+29 to t+30

In the main branch, a status query shows that the examination service already applied the exact arrangement. The receiver supplies an attributable application reference, and the operator reconciles the outstanding target item to it. Readiness is verified before Nina sits EX-NINA-SCI440-01 in week t+30; within-week timestamps establish that ordering. No second seat, extra-time allocation or support decision is created.

If the effect is genuinely absent, the operator retries the original authorised operation after checking its continuing applicability. The same key and content return the prior receipt or apply once. The same key with different content is quarantined; a legitimate changed decision requires its own successor version. If the receiver cannot support deduplication or queried state, the owner arranges an auditable manual reconciliation before further action rather than claiming exactly-once execution from a transport promise.

An unresolved failure near the exam triggers escalation to the examination and accessibility owners. Any manual arrangement needs explicit authority and verified delivery; an accepted operational exception records the remaining risk and next action, not a fabricated application receipt. The academic/support approval is not rolled back because one consumer failed.

### Run both routing patterns against the same expectations — t+31

The isolated rehearsal replays the t+29 branch. It first runs through the modular monolith's integration layer and then repeats from a separate identical starting snapshot through an optional institutional ESB. Each run has its own exercise identity and inert endpoints, so it cannot send a second live instruction. The operator compares final business records, target receipts, duplicates prevented, unresolved items and access scope, not just the number of delivered messages.

The ESB may route, validate and retry under its contract. It does not own academic decisions, turn an unapproved request into a completed fact or replace a domain receipt with its own successful-send status. Both patterns must preserve the same receiver application semantics. Farah's missing VLE membership in [AJ-36](aj-36-access-and-service-support.md) is an additional registration-target fixture for this pattern, not a new enrolment workflow.

### Later delivery must respect both version and effective date — t+52

AJ-21 already issued Nina's stage-2 adjustment version after review at +32, effective from +52; the first version runs through +51. The ordering test delivers a late first-year message after the new version. The receiver retains the old version for historical exams but cannot reactivate it for current or future assessment merely because it arrived last.

Conversely, an early stage-2 message must not remove the first year's still-valid summer arrangements. The comparison includes authority, source revision and effective period, not arrival time alone. An attendance variant sends only the authorised schedule/adjustment effects through the native module boundary. An external attendance provider needs a separately agreed confirmed-outcome adapter; neither route creates a new raw-attendance feed into core.

### Old publisher messages cannot regain authority — t+120

The separate provider-switch test consumes AJ-05's authorised cutover from `internal-cm/epoch-1` to `external-cm/epoch-2`. A late epoch-1 publication is rejected or quarantined even if its numeric revision is higher. An exact duplicate of an already accepted historic operation can identify its existing receipt, but cannot create a fresh authoritative release.

Reconciliation compares current accepted manifests, student bindings and destination states. The operator preserves future-release dates and existing cohort rules. Recovery follows the approved rollback or corrective-release route; it never reinstates the former writer by editing a queue item. The incident closes only when each required target has an applied receipt, reconciled snapshot or explicitly owned exception, and the affected service owner verifies usability.

## Starting pack and authority

Supply `EXCHANGE-REHEARSAL@1`, Nina's existing adjustment versions and exam scope, receiver snapshots/response stubs, contract registrations, authority epochs and retry/escalation policy. Additional registration/payment fixtures consume Farah's or Morgan's original authorisations rather than inventing new ones. Domain owners decide facts; integration operators recover transport; receivers attest application; service owners accept operational recovery. An outbox message is not an academic approval.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A39-01 | t+29 | Identify missing applied receipt and service urgency. | Owned incident; valid adjustment remains intact. |
| A39-02 | t+29 | Correlate source, contract, identity, target and authority. | Failure classified with the correct repair owner. |
| A39-03 | t+29 to t+30, before the exam | Query applied state, reconcile or retry original operation safely. | One 150-minute arrangement or an explicit unresolved service action. |
| A39-04 | t+31 | Repeat isolated internal and ESB runs from equivalent snapshots. | Comparable business effects and application evidence. |
| A39-05 | t+52 | Deliver adjustment versions in misleading order. | Effective-period correctness and retained historical arrangements. |
| A39-06 | t+120 | Test former-provider publication after authorised cutover. | One current authority and reconciled accepted releases/bindings. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A39-I01 / F-SIS-EXAMS-01; A21-I03 | SRS → examination service: approved timed-assessment arrangement and scoped exam identity. | Adjustment decision + exam/target + version. | Target confirms 150 minutes; transport receipt alone remains pending. |
| A39-I02 / XIC-003–005; GI-22 | Operator ↔ receiver: authorised status query, original-operation retry and reconciliation. | Original domain operation + target; technical recovery permission. | Applied reference or owned failure; changed content cannot reuse a key. |
| A39-I03 / F-SIS-ITSM-01, F-ITSM-SIS-01; GI-24 | Operations ↔ service desk/domain owner: minimum incident context, impact and resolution evidence. | Incident + affected target item. | Explicit owner, urgency and usable-service confirmation; no academic mutation. |
| A39-I04 / PLT-INT-004–006; GI-22 | Domain adapter ↔ optional ESB ↔ target: unchanged authorised contract envelope and application response. | Same scoped business operation within each separate test run. | Equivalent target state; ESB is a routing variant, not a new reference-model academic flow. |
| A39-I05 / F-CM-SIS-01; GI-23 | Authorised curriculum publisher → SRS/consumers: accepted release and provider epoch. | Release + authority epoch + destination. | Current writer enforced, old messages quarantined and existing bindings preserved. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A39-AC01 | Transport succeeds but application receipt is missing. | Query the receiver; do not declare the arrangement delivered. |
| A39-AC02 | Receiver already applied Nina's 25% on a 120-minute exam. | Reconcile one 150-minute arrangement; no duplicate booking or approval. |
| A39-AC03 | Retry identical operation, then change its content under the same key. | Identical replay deduplicated; conflict quarantined with source owner. |
| A39-AC04 | Receiver cannot establish whether an effect occurred. | Owned manual reconciliation before unsafe repeat; no invented exactly-once guarantee. |
| A39-AC05 | Required target remains unavailable near the exam. | Escalate verified alternative delivery; retain source approval and explicit pending state. |
| A39-AC06 | Run internal and ESB variants from separate equal fixtures. | Same authorised business effects; routing does not add approvals or side effects. |
| A39-AC07 | Stage-1 event arrives after stage 2, or future version arrives early. | Apply authority and effective periods; preserve history and avoid summer-support gaps. |
| A39-AC08 | Former publisher sends a new release after epoch-2 cutover. | Reject/quarantine fresh effect; duplicate historic receipt cannot restore writer authority. |

## Traceability, implementation and review

PLT-INT-001–006, PLT-WFL-001–006 and ITSM-001/002 in [core requirements](../../requirements/functional-requirements.md); XIC-001–008 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-22 covers durable command/task boundaries; GI-23 covers identifiers and GI-24 service disruption. ESB is optional and has no separate assigned flow in the reference model.

The [capability matrix](../current-capabilities.md) records partial integration operations: existing attempts do not establish the complete proposed target/application-acknowledgement model. Selected workflow families have live Temporal execution; this narrative neither extends that coverage nor routes every domain through Temporal. Review owners, unassigned: integration/platform, examination/accessibility, Registry, curriculum, service desk, security and endpoint owners. Closing evidence is reconciled receiver state and preserved authority, not an empty retry queue.
