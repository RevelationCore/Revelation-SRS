# AJ-34 — Turning lived events into accountable returns

Status: **Proposed narrative v0.7**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Extension fixture](change-and-exceptions-fixture.md) · [Record corrections](aj-27-appeals-and-record-corrections.md)

**Perspective:** a Registry reporting analyst, source-data owners and the accountable signatory. **Boundary:** a defined collection through reproducible extraction, validation, approval, submission response and controlled amendment. **Timeline:** a fictional rehearsal at t+48 to t+51; separate award-period rehearsal t+144 to t+154. These are [scenario weeks](README.md#timeline-convention), not national deadlines.

## The story

### Define the question before collecting the data — t+48

The analyst opens `COLL-NBU-DEMO-2030-01`, identifying the regulator/funder context, provider scope, reference period, specification version, cut-off and signatory. The main fixture uses an isolated HESA-style receiver and a supplied synthetic field specification, not an asserted live HESA schema or submission channel.

The population is derived from the collection's eligibility rules. Sam's progression, Leah's later result, Omar's interruption and an applicant's deferral are different facts with different effective dates. They cannot all be reported as active study because their person records exist. Jo has not yet started at this cut-off and is included only if the particular collection explicitly requires that applicant context.

### Freeze the sources and retain field lineage — t+48

Snapshot `COLL-NBU-DEMO-2030-01/s1` binds to an actual extraction timestamp. Each field identifies its source object/version and transformation/code mapping. A rerun against those sources yields the same population and values. A newly recorded correction can change the next snapshot without rewriting what the first extract knew.

The warehouse returns a discrepancy: Omar appears active after his interruption because a status mapping ignored effective dates. The analyst compares the authoritative status and mapping. Registry's fact is correct, so the mapping owner fixes the transformation and records its version; the rerun is snapshot `s2`. No one withdraws Omar in core merely to make the extract validate.

### Resolve errors where they belong — t+49

Validation retains rule identifiers, severity, record scope and resolution ownership. A true source error returns to Registry or the academic correction process. In the administrative-error branch of AJ-27, field-lineage reconciliation shows that Priya's ratified module result of 26 does not match its authenticated assessor source of 62. The analyst refers it to Registry, which opens the correction; a reporting analyst cannot patch the output while leaving the locked academic record wrong.

A validation rule may also flag a valid unusual record. The analyst documents a permitted submission-only exception and obtains the required authority; the correct source fact remains unchanged. Missing mandatory values stay unresolved, rather than being supplied with plausible guesses. Every fixed mapping or source revision creates a fresh snapshot and revalidation result.

### Sign off exactly what will be sent — t+50

The signatory reviews the frozen population, unresolved/accepted issues, reconciliations and payload digest. Approval binds to that exact version. Changing a record or mapping afterwards invalidates the sign-off for the changed payload. The submitter cannot substitute an unreviewed live extract when the workflow resumes. Priya's open correction is listed as a known issue. Being the current record does not on its own permit sending the 26. The signatory approves `s2` under the known-issue rule in `REPORTING-DEMO@1`: the synthetic specification permits amendment after submission, Registry is named as correction owner, and a correction submission is committed for t+51 within the amendment window. `s2` is sent as `sub1` with the recorded 26 unchanged. Without that permission, submission would wait for the amendment.

The receiver acknowledges transport first, then validates the submission. The analyst distinguishes “sent”, “received”, “rejected” and “accepted”. A timeout after submission triggers a status query or supported replay of the same operation; a second independently numbered return is not created simply to clear an error badge.

### Corrections become a new submission — t+51

Registry's amendment of Priya's mark is ratified and published at t+50, after `sub1` was sent. Snapshot `s3` and submission `sub2` at t+51 retain their predecessor links, changed fields/population, reason and renewed authority. A late response for `sub1` cannot overwrite `sub2`'s accepted state.

Where an output depends on an accepted HESA version, its source submission is pinned and cross-return impact reviewed. A correction does not silently refresh every dependent return. The analyst records which have been regenerated, await a permitted submission window or need a separate signatory decision. Recipients' confirmed states and owned exceptions close the reporting work.

### Each external obligation has its own context

Student-finance notifications use the applicable scheme, eligibility, event and confirmation type; registration at t-2 is not evidence of attendance. Sponsor reporting requires the separate human sponsor decision and evidence snapshot, never an attendance score alone. The story uses the existing owners and does not create competing SLC or UKVI submissions inside a generic annual collection.

An England, Scotland, Wales or Northern Ireland variant supplies its own collection specification, code sets, authority and supported channel. A generic regulator code is not proof that the corresponding national format is implemented. Missing specifications remain an explicit contract gap. No real return is sent by this narrative.

At the later award-period rehearsal, Sam's recommendation, conferral and issued documents have different dates. Ben remains on reassessment until his later decisions. A t+144 snapshot cannot claim either a t+145 conferral already recorded or Ben's t+152 award. A later snapshot includes those facts only when its period and specification require them.

## Starting pack and authority

Supply `REPORTING-DEMO@1`, synthetic schemas/code maps, eligibility rules, source snapshots, signatory delegations, receiver stubs and reconciliation controls. The correction branch supplies before/after academic authority rather than invented marks. Source owners correct facts, mapping owners correct transformations, the signatory approves exact submissions, and operators recover transport. Reporting access does not grant authority over admissions, marks or sponsor decisions.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A34-01 | t+48 | Configure scope/specification and freeze cut-off. | Reproducible population and source manifest. |
| A34-02 | t+48 to t+49 | Validate fields and investigate Omar's mapping discrepancy. | Owned mapping correction; academic fact unchanged. |
| A34-03 | t+49 | Fix mapping, refer Priya's source discrepancy and record authorised exceptions. | Fresh validated snapshot `s2` with field lineage; source query owned by Registry. |
| A34-04 | t+50 | Sign exact payload and submit to isolated receiver. | Attributable sign-off, payload and transport receipt. |
| A34-05 | t+50 to t+51 | Reconcile receiver validation and acceptance. | External state distinguished from sending; failures owned. |
| A34-06 | t+51, correction branch | Create approved successor submission from Priya's amendment and assess dependent outputs. | Versioned amendment chain and reconciliation. |
| A34-07 | t+144 to t+154 | Repeat with dated award/reassessment facts. | No future conferral or pending result reported as already known. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A34-I01 / F-SIS-DW-01, F-DW-SIS-01 | SRS ↔ warehouse: permitted dated extracts and returned reconciliation issues. | Snapshot + transformation version; source/warehouse owners. | Reproducible load and owned discrepancy; warehouse cannot amend core facts. |
| A34-I02 / RSS-003/004; GI-18 | Source/mapping owners → collection: exact facts, lineage, validated mappings and issue dispositions. | Snapshot + field/rule version; respective authority. | Complete lineage and validation report; missing mandatory evidence blocks sign-off. |
| A34-I03 / F-SIS-HESA-01, F-HESA-SIS-01 | Authorised reporting service ↔ isolated receiver: signed exact payload, response, validation and identifier references. | Collection + submission version; signatory-bound authority. | Distinct transport/acceptance evidence; query before duplicate submission after timeout. |
| A34-I04 / RSS-011; A27-I04 | Amendment owner → reporting: authoritative source revision; reporting → receiver: renewed signed submission and predecessor reference. | Amendment + collection/submission version. | Before/after diff, response and dependent-return reconciliation; stale responses scoped to old submission. |
| A34-I05 / F-SIS-SLC-01, F-SLC-SIS-01, F-SIS-UKVI-01, F-UKVI-SIS-01; GI-19 | Source process → relevant funding/sponsor owner and supported receiver: eligible dated decision, scheme/authority and response. | Obligation type + source decision version; separately designated signatory. | Reuse AJ-16 funding exchange; [AJ-09](aj-09-international-postgraduate-entry.md) supplies sponsor context. Missing applicability or live contract remains pending. |

National collection variants under GI-18 use separate declared contracts; the reference model supplies no universal regulator API. They do not inherit England-only mappings by default.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A34-AC01 | Rebuild an unchanged collection snapshot. | Same population, values and transformation provenance. |
| A34-AC02 | Mapping treats Omar as active after interruption. | Correct effective-date transformation; no alteration of a correct Registry decision. |
| A34-AC03 | A ratified source mark is wrong. | AJ-27 correction before regenerated output; extract-only patch blocked. |
| A34-AC04 | Payload changes after sign-off. | Existing approval cannot authorise changed content; revalidate and obtain new sign-off. |
| A34-AC05 | Submission times out or receiver rejects it. | Query/reconcile exact operation; sent is not accepted and no duplicate return created. |
| A34-AC06 | Correct a previously accepted submission. | New signed version, retained predecessor and cross-return impact review. |
| A34-AC07 | Use a late sub1 response after sub2 is accepted. | Response updates only its own submission; latest accepted state preserved. |
| A34-AC08 | National schema, scheme eligibility or sponsor authority is absent. | Relevant submission blocked with contract/authority owner; generic codes do not prove compatibility. |
| A34-AC09 | t+144 snapshot requests future conferral or Ben's final award. | Future facts absent; pending status represented according to the supplied specification. |

## Traceability, implementation and review

BP-07-001–008 in the [process inventory](../../business-processes/process-inventory.md); ENR-005/006 and GOV-007 in [core requirements](../../requirements/functional-requirements.md); RSS-001–012 and XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-18/GI-19 cover national specifications and supported external channels.

The [capability matrix](../current-capabilities.md) records partial collection/sign-off support, including missing field-lineage routing and national format/bridge gaps. Review owners, unassigned: Registry reporting, Finance/sponsor compliance, national collection specialists, data owners and integration/privacy teams. Closing evidence is the immutable source/field manifest, signed payload, actual receiver status and amended/dependent-return reconciliation. Institutional deployment requires current approved specifications; this fiction supplies no regulatory advice.
