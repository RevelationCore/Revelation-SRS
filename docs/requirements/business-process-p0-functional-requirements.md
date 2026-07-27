# P0 Business Process Functional Requirements

> Status: Proposed for product, architecture and SME approval
> Version: 0.1
> Date: 2026-07-26
> Source baseline: BP-001–BP-063 version 0.1 and P0 items in the Revelation change backlog

These requirements refine existing functional requirements; they do not supersede them until approved through product and architecture governance.

Priority is **M** (Must Have). Verification uses:

- **T** — automated test;
- **D** — design/schema/contract inspection;
- **R** — controlled operational or SME review.

## 1. CAS and Student sponsor compliance (BPC)

| ID | Requirement | Source | Existing alignment | Verify |
|---|---|---|---|---|
| BPC-001 | The SRS shall create a unique, tenant-scoped CAS case before any CAS assignment request is authorised. | BPR-W02, BPR-D03; BP-005 | ENR-007, UKV-001 | T/D |
| BPC-002 | A CAS case shall record the sponsor, applicant, course, locations, intended dates and the exact Student sponsor guidance version used for the decision. | BPR-D03; BP-005 | UKV-005 | T/D |
| BPC-003 | The SRS shall record each required eligibility check as `passed`, `failed`, `not applicable` or `pending`, with evidence reference, assessor and decision time. | BPR-W02, BPR-D03; BP-005 | UKV-001, UKV-005 | T/R |
| BPC-004 | The SRS shall prevent CAS assignment while a mandatory eligibility check is pending/failed or the approver lacks delegated authority. | BPR-W02; BP-005 | PLT-SEC-002 | T |
| BPC-005 | The assigned CAS record shall preserve the exact outbound data, CAS number, actor, assignment time and UKVI/SMS receipt without overwriting the approved case. | BPR-D03, BPR-I03; BP-005 | UKV-001, PLT-AUD-001 | T/D |
| BPC-006 | A correction or withdrawal shall create a linked version/report with reason and authority; it shall not destructively edit the prior CAS/SMS evidence. | BPR-W02, BPR-I03; BP-005, BP-052 | UKV-005, PLT-TMP-003 | T |
| BPC-007 | Sponsor compliance cases shall separate the academic-status decision, sponsorship decision and SMS reporting action, each with its own authority and effective time. | BPR-W07, BPR-I03; BP-028, BP-052 | UKV-002, UKV-004 | T/D |
| BPC-008 | The SRS shall retain the exact SMS report, guidance version, evidence snapshot, submission deadline, receipt and any corrective report. | BPR-W02, BPR-I03; BP-052 | UKV-005 | T/R |
| BPC-009 | Partner, placement, study-abroad, remote and PGR variants shall record the actual sponsor, teaching/research location and evidence policy applied. | BPR-W02; BP-005, BP-052 | UKV-002 | T/R |

## 2. Engagement intervention and support privacy (ESP)

| ID | Requirement | Source | Existing alignment | Verify |
|---|---|---|---|---|
| ESP-001 | The SRS shall store expected engagement events separately from observed attendance or other engagement evidence. | BPR-D08; BP-027 | ATT-001 | T/D |
| ESP-002 | Each engagement observation shall record source, method, event time, received time, mode, status and correction provenance. | BPR-D08; BP-027 | ATT-001, PLT-TMP-001 | T |
| ESP-003 | The SRS shall not infer a final academic-status or sponsor-reporting outcome directly from one attendance record, threshold or predictive flag. | BPR-W07; BP-027–BP-028 | ATT-001, UKV-004 | T |
| ESP-004 | A non-engagement alert shall create a distinct intervention case recording policy version, evidence window, triage, contact attempts, responses, actions and review deadline. | BPR-W07, BPR-D08; BP-028 | PLT-WFL-001 | T/D |
| ESP-005 | Bad, missing or disputed source evidence shall suspend adverse workflow automation and create a data-reconciliation task. | BPR-W07; BP-027–BP-028 | PLT-INT-005 | T |
| ESP-006 | Welfare/safeguarding escalation shall be recorded as a restricted referral and shall not expose confidential context in general engagement views. | BPR-W07; BP-028 | PLT-SEC-002 | T/R |
| ESP-007 | The SRS shall receive only the approved operational support outcome required for delivery; diagnostic/clinical evidence shall remain in the authorised specialist system. | BPR-W08, BPR-D09; BP-030–BP-032 | ADJ-001, ADJ-006 | T/D |
| ESP-008 | A support outcome shall record scope, operational instruction, effective interval, review date, visibility classification, source decision and supersession/withdrawal state. | BPR-D09; BP-030–BP-032 | ADJ-002, EXC-002 | T/D |
| ESP-009 | The SRS shall derive a minimum-necessary, target-specific payload for each authorised support consumer. | BPR-W08, BPR-I07; BP-032, BP-034 | ADJ-003–ADJ-004 | T |
| ESP-010 | Distribution shall maintain one item per target with outcome version, contract version, correlation key, status, attempts, acknowledgement and last error. | BPR-D09, BPR-I07; BP-032 | PLT-INT-005 | T/D |
| ESP-011 | Support-outcome correction or withdrawal shall issue an idempotent target-specific delta and reconcile the final target state. | BPR-W08, BPR-I07; BP-032 | ADJ-003 | T |
| ESP-012 | A target failure shall not revoke or duplicate the authoritative approved outcome and shall remain visible to an accountable operational owner. | BPR-W08; BP-032 | PLT-INT-005 | T/R |

## 3. Assessment, boards and ratified outcomes (ABR)

| ID | Requirement | Source | Existing alignment | Verify |
|---|---|---|---|---|
| ABR-001 | The SRS shall represent assessment pattern, candidate attempt, raw mark, confirmed mark, calculated result, ratified outcome and published outcome as distinguishable states/records. | BPR-W09, BPR-D10–D11; BP-033–BP-041 | ASS-001–ASS-008, GOV-003 | T/D |
| ABR-002 | Every candidate attempt shall bind to the effective assessment-pattern and rule versions used to determine its result. | BPR-D10; BP-034–BP-037 | ASS-007–ASS-008 | T |
| ABR-003 | Raw mark intake shall record source, marker/authority, received time, scale, absence/non-submission code and prior attempt without overwriting another attempt. | BPR-D10; BP-035 | ASS-001, ASS-006 | T |
| ABR-004 | Moderation shall freeze a mark-set version and record method, sample, moderator, changes, reasons and sign-off. | BPR-W09, BPR-D10; BP-036 | ASS-004 | T/D |
| ABR-005 | Result calculation shall retain inputs, rule versions, intermediate values, rounding and final explanation sufficient for independent reproduction. | BPR-W09, BPR-D10; BP-037 | ASS-002, ASS-007 | T |
| ABR-006 | Missing mandatory evidence shall produce an incomplete/deferred result and shall not be represented as failure unless an authorised rule expressly requires it. | BPR-W09; BP-037 | ASS-007 | T/R |
| ABR-007 | An Exam Board instance shall record scope, meeting, membership, conflicts, quorum, chair, decision authority and external-examiner status. | BPR-D11; BP-039–BP-041 | GOV-005 | T/D |
| ABR-008 | Each board pack shall reference an immutable, reproducible source snapshot, cut-off transaction time, rule versions, generation time and pack hash/version. | BPR-W09, BPR-D11; BP-039 | GOV-001 | T/D |
| ABR-009 | Late data shall create a versioned replacement/addendum; it shall not silently alter a pack already issued to the board. | BPR-W09; BP-039 | GOV-001 | T |
| ABR-010 | Ratification shall be prevented unless quorum, authority, required sign-off and configured completeness controls pass. | BPR-W09; BP-040–BP-041 | GOV-003, GOV-005 | T |
| ABR-011 | Ratification shall create an immutable lock linked to the exact pack and decisions, including any authorised discretion and reason. | BPR-W09, BPR-D11; BP-041 | ASS-005, GOV-003–GOV-004 | T/D |
| ABR-012 | Consumers shall receive an explicit outcome status/version and shall not treat raw, moderated or merely calculated results as ratified. | BPR-I08; BP-035–BP-041 | EWP-001, VLE-002 | Contract test |
| ABR-013 | Publication shall occur only at an authorised release time and shall record per-channel delivery without changing the ratified academic fact. | BPR-W09; BP-041 | GOV-003 | T |
| ABR-014 | A correction shall open an amendment case linked to the exact ratified version and classify the error, evidence, impact and required authority. | BPR-W10, BPR-D13; BP-043 | ASS-005, GOV-007 | T/D |
| ABR-015 | The correction authority shall be at least equivalent to the original decision authority unless regulations explicitly delegate the correction type. | BPR-W10; BP-043 | GOV-007 | T/R |
| ABR-016 | An approved correction shall append a bitemporal outcome version, preserve the superseded outcome and create per-consumer republication work. | BPR-W10, BPR-D13; BP-043 | PLT-TMP-001–003 | T |
| ABR-017 | The amendment case shall not be closed until every affected consumer acknowledges the correction or has an accepted owned exception. | BPR-W10; BP-043 | PLT-INT-005 | T/R |

## 4. Regulatory and statutory submissions (RSS)

| ID | Requirement | Source | Existing alignment | Verify |
|---|---|---|---|---|
| RSS-001 | Each statutory collection shall record regulator/funder, provider scope, specification/schema version, reference period, deadlines and accountable signatory. | BPR-W12, BPR-D16; BP-050–BP-056 | HES-001, OFS-001 | T/D |
| RSS-002 | A submission version shall bind to an immutable source cut-off and reproducible population snapshot. | BPR-W12, BPR-D16; BP-050, BP-053–BP-056 | HES-001 | T |
| RSS-003 | Every submitted field/metric shall be traceable to authoritative source facts and versioned transformation/code mappings. | BPR-W12, BPR-D16; BP-050–BP-057 | HES-002 | T/D |
| RSS-004 | Validation shall preserve rule identifier/version, severity, affected records, disposition, owner and resolution. | BPR-D16; BP-050, BP-057 | HES-002 | T |
| RSS-005 | Submission shall require recorded sign-off and shall retain exact payload/hash, channel, submission time, receipt and regulator status. | BPR-W12, BPR-D16; BP-050, BP-053–BP-056 | HES-003 | T/D |
| RSS-006 | SFC, Medr and Department for the Economy exchanges shall use explicit contracts and national code sets; England-only codes shall not be silently reused. | BPR-I10; BP-054–BP-056 | PLT-INT-006 | Contract test/R |
| RSS-007 | HESA-derived national outputs shall record and reconcile to the accepted HESA submission version on which they depend. | BPR-I10; BP-054–BP-056 | HES-003 | T |
| RSS-008 | A quality issue shall identify whether the defect lies in source fact, mapping/transformation, timing or regulator rule interpretation. | BPR-W12, BPR-D16; BP-057 | HES-005, ANA-004 | T |
| RSS-009 | When a source fact is wrong, correction shall occur through the authoritative domain process before regeneration; extract-only patching shall be prohibited. | BPR-W12; BP-057 | PLT-TMP-003 | T/R |
| RSS-010 | A valid submission-only exception shall retain its rationale and authority without changing a correct source fact. | BPR-W12; BP-057 | HES-005 | T/R |
| RSS-011 | Resubmission shall retain before/after versions, changed fields/population, approval, response and cross-return impact assessment. | BPR-W12, BPR-D16; BP-057 | HES-005 | T |
| RSS-012 | Student-finance exchanges shall retain scheme (`SFE`, `SFW`, `SAAS`, `SFNI`), domicile/course applicability, event/effective date, response and reconciliation state. | BPR-I11; BP-051 | SLC-001–SLC-003 | T/Contract test |

## 5. Identity, individual rights, retention and audit (IGA)

| ID | Requirement | Source | Existing alignment | Verify |
|---|---|---|---|---|
| IGA-001 | A probable duplicate shall open a restricted identity-resolution case and shall prevent automatic destructive merge. | BPR-W13, BPR-D17; BP-058 | SID-001 | T |
| IGA-002 | Identity resolution shall record candidate identities, match basis, evidence, decision, authority and outcome of merge, link, separation or insufficient evidence. | BPR-D17; BP-058 | SID-001, SID-005 | T/D |
| IGA-003 | A merge shall preserve all source identifiers and provenance, nominate a survivor, prevent cross-tenant merging and remain logically reversible. | BPR-W13, BPR-D17; BP-058 | PLT-MT-001, PLT-AUD-001 | T |
| IGA-004 | The SRS shall create idempotent redirect/reconciliation work for every known identity consumer and shall not create a second person when replaying it. | BPR-I12; BP-058 | PLT-INT-005 | T/Contract test |
| IGA-005 | A core-fact correction shall distinguish correction of historic inaccuracy from a new current change and record both valid and transaction time. | BPR-D17; BP-059 | SID-003, PLT-TMP-001 | T |
| IGA-006 | Academic judgement shall not be changed through general personal/enrolment correction; it shall use the governed academic amendment process. | BPR-W13; BP-059, BP-043 | ASS-005 | T |
| IGA-007 | A rights request shall record requester, verified identity, scope, received date, statutory deadline, correspondence, decision and delivery/closure. | BPR-W13, BPR-D18; BP-060–BP-061 | PLT-AUD-005 | T/D |
| IGA-008 | A subject-access search manifest shall identify every searched system, query scope, search time, result set and responsible reviewer. | BPR-W13, BPR-D18; BP-060 | PLT-AUD-005 | T/R |
| IGA-009 | Disclosure review shall record third-party data, exemptions/restrictions, privilege, redactions and reason without modifying source records. | BPR-W13; BP-060 | PLT-SEC-002 | T/R |
| IGA-010 | Rectification, restriction and erasure shall be decided separately for each datum/processing purpose and retain lawful basis, exception and reason. | BPR-W13, BPR-D18; BP-061 | SID-007 | T/R |
| IGA-011 | An approved restriction shall create an enforceable processing marker interpreted by APIs, workflows, extracts and integrations while permitting authorised storage. | BPR-W13, BPR-D18, BPR-I12; BP-061 | PLT-SEC-002 | T/Contract test |
| IGA-012 | Approved correction, erasure or restriction shall create per-recipient propagation items with acknowledgement or owned exception. | BPR-I12; BP-061 | PLT-INT-005 | T |
| IGA-013 | Every governed record class shall have purpose, authority, retention trigger, period, disposition and accountable owner. | BPR-W13, BPR-D18; BP-062 | EDR-001–EDR-002 | D/R |
| IGA-014 | A legal/investigation/complaint/archive hold shall suspend disposition, record scope/authority and require an owner and review date. | BPR-W13, BPR-D18; BP-062 | PLT-AUD-001 | T |
| IGA-015 | Disposal shall cover authoritative, derived, search/index and governed backup locations and produce a certificate that does not retain disposed content. | BPR-W13, BPR-D18, BPR-I12; BP-062 | PLT-TMP-003 | T/R |
| IGA-016 | Access/material-change audit records shall be tamper-evident and capture tenant, actor, role, purpose, object, action, time and correlation plus before/after references where applicable. | BPR-D19; BP-063 | PLT-AUD-001–004 | T/D |
| IGA-017 | Audit reviewers shall be unable to alter source audit records and shall record scope, authority, queries, findings, evidence preservation and remediation. | BPR-W13, BPR-D19; BP-063 | PLT-AUD-004–005 | T |
| IGA-018 | Missing expected audit coverage shall create a security/control incident rather than a reconstructed or fabricated audit record. | BPR-W13; BP-063 | PLT-AUD-001 | T/R |

## 6. Cross-system exchange controls (XIC)

| ID | Requirement | Source | Existing alignment | Verify |
|---|---|---|---|---|
| XIC-001 | Every regulated or record-changing exchange shall identify tenant, contract/schema version, source record/version, target, correlation and idempotency key. | BPR-I03, I07–I08, I10–I12 | PLT-INT-004–006 | Contract test |
| XIC-002 | Retries with the same idempotency key and authoritative version shall not create duplicate business records or repeated side effects. | All P0 integrations | PLT-INT-005 | T |
| XIC-003 | Each target item shall record queued, sent, acknowledged, rejected, quarantined, reconciled or accepted-exception state. | BPR-I07, I10–I12 | PLT-INT-005 | T/D |
| XIC-004 | Transport delivery shall not be treated as business application; the target acknowledgement or snapshot reconciliation shall determine applied state. | All P0 integrations | PLT-INT-005 | Contract test |
| XIC-005 | Reconciliation shall compare an authoritative versioned snapshot/high-water mark and create corrective work without duplicating the academic record. | All P0 integrations | PLT-INT-005 | T |
| XIC-006 | Dead-letter/quarantine records shall contain no more sensitive data than required to diagnose and replay the exchange. | BPR-I03, I07, I12 | PLT-SEC-005 | D/R |
| XIC-007 | A failed target shall not roll back a separately authorised academic, support, identity or rights decision unless the governing process explicitly requires atomicity. | BPR-I07–I08, I12 | PLT-WFL-001 | T |
| XIC-008 | Contract/event names shall describe authoritative completed facts; request, provisional and approved states shall not share one event subject. | BPR-I08; BP-033–BP-043 | PLT-INT-001 | D/Contract test |

## P0 backlog coverage

| Backlog item | Requirement coverage |
|---|---|
| BPR-W02 / BPR-D03 / BPR-I03 | BPC-001–BPC-009, XIC-001–XIC-007 |
| BPR-W07 / BPR-D08 | ESP-001–ESP-006 |
| BPR-W08 / BPR-D09 / BPR-I07 | ESP-007–ESP-012, XIC-001–XIC-007 |
| BPR-W09 / BPR-D10 / BPR-D11 / BPR-I08 | ABR-001–ABR-013, XIC-008 |
| BPR-W10 / BPR-D13 | ABR-014–ABR-017 |
| BPR-W12 / BPR-D16 / BPR-I10 / BPR-I11 | RSS-001–RSS-012 |
| BPR-W13 / BPR-D17–D19 / BPR-I12 | IGA-001–IGA-018 |

## Approval dependencies

1. Relevant SMEs approve the source process boundaries and authorities.
2. Architecture reviews ADR-016–ADR-022.
3. Product governance assigns these requirements to releases and reconciles overlap with existing requirements.
4. Data protection, security and records owners approve ESP, IGA and XIC controls.
5. Four-nation regulatory owners approve RSS applicability and contract scope.

