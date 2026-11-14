# AJ-12 — One course across institutional boundaries

Status: **Proposed narrative v0.7**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Partner fixture](research-and-partnership-fixture.md) · [Assessment](aj-24-assessment-and-results.md)

**Perspective:** Noah, Riverside College's registrar, Northbridge's partnership manager and the academic board. **Boundary:** approved collaborative responsibilities through reconciled registrations, assessed evidence and correctly authorised award decisions. **Timeline:** tX-20 to tX+41 for entry and first results; a later completion snapshot is separately supplied. tX = 20 September 2032 = t+104.

## The story

### An agreement defines who can decide — tX-20 to tX-12

Northbridge and Riverside approve `AGR-NBU-RIV-2032@1`, renewing the agreement under which a separately defined master's route was validated in 2030. Recruitment for the 2032 intake has run under the earlier agreement; the renewal governs delivery from 2032/33, and no 2032 entrant can start unless it is approved. The agreement identifies curriculum ownership, admissions authority, teaching, assessment, moderation, appeals, records access, student support, fees and award responsibility. Riverside teaches; Northbridge is the sole awarding institution in the main path.

The partners reconcile their teaching and administrative calendars rather than copying Northbridge dates into every system. A contractual change or partnership termination applies the relevant measures of Northbridge's student protection plan `SPP-NBU@1` and has an explicit records plan. This agreement does not itself register Noah or grant Riverside staff unrestricted access to the Northbridge tenant.

### Noah joins one linked academic record — tX-8 to tX+1

Riverside receives Noah's application under the agreed delegation and supplies verified evidence and the authorised admissions recommendation/outcome. Northbridge applies the agreed acceptance boundary and creates the canonical award-bearing enrolment after the appropriate registration gates. The partner record `RIV-NOAH-001` remains a source alias linked to `PERSON-NOAH-001`, not a second unrelated person.

Noah receives clear information about teaching location, awarding body, terms, fees and where to raise support or academic concerns. The university account and local learning access are separately provisioned. A partner identifier conflict goes to restricted review; the import does not merge students on name alone or cross tenant boundaries.

### Approved definitions travel with their meaning — tX-4 to tX+4

The curriculum manifest maps local module `RIV-STAT1` to approved level-7 module `PART710@1.0`, with 20 credits, level, assessment pattern and the fixture's 50-pass rule. The academic version and its dated delivery offering are distinct. Riverside cannot change a weighting, prerequisite or outcome because its local platform permits editing.

The agreed roster payload identifies confirmed registrations, period and delivery groups. Noah's learning access is checked against the correct offering. If a local term starts later than Northbridge's, the calendar mapping records that fact; an apparent early absence does not become an engagement breach. A curriculum amendment uses the same approval/version controls as AJ-01/02 and its partnership-specific consultation.

### A mark is more than a number — tX+28 to tX+34

Riverside sends an assessed mark of 64 with the source assessment, attempt, scale, marker and version. The first message uses an obsolete local module alias. The receiving service quarantines it and assigns the mapping owner, rather than guessing a similar Statistics code or applying it to another attempt.

After the authorised mapping correction, the original source event is reconciled and accepted once. If the source used a different grading scheme, an approved conversion rule with retained original value would be required; this fixture instead uses the agreed 0–100 scale. The 64 is not yet a ratified result. Moderation checks the actual evidence and retains any justified changes.

### The awarding authority considers the evidence — tX+36 to tX+41

Northbridge freezes the scoped board pack, obtains required external scrutiny, resolves conflicts and ratifies at tX+40. Publication follows at tX+41 under separate authority. Noah receives the official module result and next actions through the agreed student-facing route. Riverside's earlier provisional display cannot be relabelled as the university's final decision.

A missing partner result creates an owned gap and, where policy permits, a candidate-scoped deferral. It does not force a fabricated zero for Noah or halt unrelated candidates without reason. Corrections after ratification use AJ-27 and reconcile both institutions' records and any relevant reporting snapshot.

### Completion and partnership changes preserve commitments

A later completion scene supplies the full 180-credit approved route and actual ratified outcomes before the single Northbridge award is recommended and conferred through AJ-29. One 20-credit module pass cannot establish degree eligibility. Documents identify the correct awarding body and approved delivery context without inventing a second award.

A joint/dual-award variant requires a different agreement specifying each institution's requirements, credit recognition and independent authority. It cannot reuse this single-award decision twice. If the partnership ends while Noah is studying, `SPP-NBU@1` and AJ-04's closure controls establish a funded completion/transfer route and continued access to evidence. Exporting a spreadsheet is not proof that records or obligations have transferred.

## Starting pack and authority

Supply `PARTNER-2032@1`, the signed synthetic agreement and its 2030 predecessor, `SPP-NBU@1`, approved curriculum/assessment manifest, delegated admissions roles, local-to-canonical mappings, calendars, actual registrations and verified mark evidence. Later award scenes require the whole result profile. Partner staff attest their owned evidence; Northbridge academic authorities retain the specified moderation/ratification/award decisions; service owners reconcile delivery. GI-06 interfaces are proposed contract boundaries, not an assumed common database.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A12-01 | tX-20 to tX-12 | Agree responsibilities, calendars and student commitments. | Approved collaborative-provision scope and controls. |
| A12-02 | tX-8 to tX+1 | Reconcile admissions, identity and registration. | One linked canonical enrolment and separate usable services. |
| A12-03 | tX-4 to tX+4 | Verify curriculum/offering and roster mappings. | Correct learning context; no unauthorised local academic change. |
| A12-04 | tX+28 to tX+34 | Quarantine bad alias, correct mapping and moderate evidence. | One accepted 64 against the right attempt; still unratified. |
| A12-05 | tX+36 to tX+41 | Prepare board, ratify and publish official result. | Authoritative outcome reconciled across both institutions. |
| A12-06 | Later completion/closure snapshot | Verify whole award or govern partnership change. | Proper award authority or funded remaining-study plan. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A12-I01 / GI-06; A16-I01 | Partner → Northbridge: delegated admission outcome, verified evidence and source aliases. | Partner application/decision version; agreement-scoped authority. | Accepted linkage or restricted quarantine; no duplicate/cross-tenant merge. |
| A12-I02 / GI-06; A01-I03 accepted release | Approved curriculum owner → partner delivery: exact manifest, local mappings, applicability and approved amendments. | Release + agreement/destination version. | Applied matching definitions; partner cannot publish unapproved local edits into core. |
| A12-I03 / GI-06; A20-I01 | Confirmed registration owner ↔ partner learning services: dated membership, offering and calendar context. | Registration/roster version + target. | Applied access/roster; unknown alias remains owned. |
| A12-I04 / GI-06; A24-I02 | Partner assessment source → Northbridge: mark, original scale, attempt, marker and source version. | Source mark + attempt + version. | Accepted/quarantined evidence; correction retains source value and replay identity. |
| A12-I05 / A25-I04; A27-I04; GI-06 | Northbridge → partner/student-facing services: published ratified result or authorised amendment. | Outcome/publication version + recipient. | Applied official status and correction receipt; provisional partner view cannot override it. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A12-AC01 | Partner lacks delegated authority for an admission decision. | Acceptance gate blocked or routed for required Northbridge approval. |
| A12-AC02 | Same student is imported twice or alias matches ambiguously. | Reuse verified link or restricted review; no automatic destructive merge. |
| A12-AC03 | Local academic definition differs from approved manifest. | Impact/approval route required; no silent change to Noah's binding. |
| A12-AC04 | Mark 64 arrives with obsolete module alias. | Quarantine then approved mapping recovery; apply once to the correct attempt. |
| A12-AC05 | Scale differs or local provisional result is displayed. | Approved conversion/status distinction required; no inferred ratification. |
| A12-AC06 | Ratified result is later corrected. | Governed successor and both institutions' receipt reconciliation. |
| A12-AC07 | Request an award from only one module or duplicate a single award for two institutions. | Complete profile and correct independent award authority required. |
| A12-AC08 | Partnership ends with active or interrupted students. | Funded completion/transfer and retained evidence; no record deletion or stranded learners. |

## Traceability, implementation and review

BP-01-007, BP-03-001/006, BP-05-003–005/009 and BP-06-003 in the [process inventory](../../business-processes/process-inventory.md); CAT-005/007, REG-002, ASS-005 and GOV-003/004 in [core requirements](../../requirements/functional-requirements.md); XIC-001–007 and ABR-012–017 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-06 is the explicit partner-agreement/data-contract gap.

The [capability matrix](../current-capabilities.md) does not establish a complete collaborative-provision adapter or multi-institution award route. Review owners, unassigned: partnership quality, both registries, admissions, assessment/external examining, Finance and privacy. Closing evidence is the agreement-scoped decision chain, mapped versions, source marks and reconciled official outcomes.
